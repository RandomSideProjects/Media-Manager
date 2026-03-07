#!/usr/bin/env python3
"""copyparty-localhost-u2c-proxy.py

A small localhost HTTP server which accepts the same upload request shape that
Media-Manager Creator uses for Copyparty direct uploads:
- POST (multipart/form-data)
- file field name: `f`
- optional header: `pw` (copyparty password)
- optional header: `accept: json`

This server then uploads the received file to a *real* Copyparty destination URL
(using u2c.py for chunked/resumable uploads) and responds with JSON:
  {"fileurl": "https://...", "files": [{"url": "https://..."}]}

Usage:
  python3 copyparty-localhost-u2c-proxy.py \
    --dest "https://cpr.xpbliss.fyi/pub/MM/Some.json/ShowName/" \
    --u2c "/Users/alex/.openclaw/workspace/u2c.py" \
    --port 2636

Then in Creator set Copyparty folder URL to:
  http://127.0.0.1:2636/

and enable the Copyparty direct upload toggle.

Notes:
- This is intended for local/trusted use.
- The `--dest` URL controls where uploads go on the Copyparty instance.
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, HTTPServer


URL_RE = re.compile(r"https?://[^\s]+")


def run_u2c(u2c_path: str, dest_url: str, pw: str, file_path: str) -> str:
    cmd = [sys.executable, u2c_path]
    if pw:
        cmd += ["-a", pw]
    cmd += ["-ud", "--spd", dest_url, file_path]

    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
    assert p.stdout is not None

    found = None
    for line in p.stdout:
        m = URL_RE.search(line)
        if m:
            found = m.group(0)
            # u2c may print multiple urls; the first is the one we want
            break

    # drain
    if p.stdout:
        for _ in p.stdout:
            pass

    rc = p.wait()
    if rc != 0:
        raise RuntimeError(f"u2c.py exited with {rc}")
    if not found:
        raise RuntimeError("Could not parse uploaded URL from u2c.py output")
    return found


def _parse_content_type(header_value: str):
    raw = (header_value or '').strip()
    parts = [p.strip() for p in raw.split(';')]
    ctype = parts[0].lower() if parts else ''
    params = {}
    for p in parts[1:]:
        if '=' in p:
            k, v = p.split('=', 1)
            k = k.strip().lower()
            v = v.strip().strip('"')
            params[k] = v
    return ctype, params


def _parse_multipart(body: bytes, boundary: bytes):
    # Returns list of (headers_dict, content_bytes)
    if not boundary:
        raise ValueError('Missing multipart boundary')
    sep = b'--' + boundary
    end = b'--' + boundary + b'--'

    # body may start with CRLF; normalize split
    parts = body.split(sep)
    out = []
    for part in parts:
        part = part.strip(b'\r\n')
        if not part or part == b'--' or part == end:
            continue
        # each part: headers \r\n\r\n content
        header_blob, _, content = part.partition(b'\r\n\r\n')
        if not _:
            continue
        headers = {}
        for line in header_blob.split(b'\r\n'):
            if b':' not in line:
                continue
            k, v = line.split(b':', 1)
            headers[k.decode('utf-8', 'ignore').strip().lower()] = v.decode('utf-8', 'ignore').strip()
        # strip trailing CRLF
        content = content.rstrip(b'\r\n')
        out.append((headers, content))
    return out


def _parse_content_disposition(value: str):
    # returns (disposition, params)
    raw = (value or '').strip()
    parts = [p.strip() for p in raw.split(';')]
    disp = parts[0].lower() if parts else ''
    params = {}
    for p in parts[1:]:
        if '=' in p:
            k, v = p.split('=', 1)
            params[k.strip().lower()] = v.strip().strip('"')
    return disp, params


class Handler(BaseHTTPRequestHandler):
    server_version = "cp-u2c-proxy/1.1"

    def _send(self, code: int, body: bytes, content_type: str = "application/json"):
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        # allow browser fetch/xhr
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "pw, accept, content-type")
        self.send_header("Access-Control-Max-Age", "600")
        self.end_headers()

    def do_POST(self):
        try:
            ctype, params = _parse_content_type(self.headers.get('content-type') or '')
            if ctype != 'multipart/form-data':
                raise ValueError('Expected multipart/form-data')
            boundary = (params.get('boundary') or '').encode('utf-8')
            if not boundary:
                raise ValueError('Missing multipart boundary')

            try:
                length = int(self.headers.get('content-length') or '0')
            except Exception:
                length = 0
            if length <= 0:
                raise ValueError('Missing Content-Length')

            body = self.rfile.read(length)
            parts = _parse_multipart(body, boundary)

            file_part = None
            filename = 'upload.bin'
            for headers, content in parts:
                disp, dparams = _parse_content_disposition(headers.get('content-disposition', ''))
                if disp != 'form-data':
                    continue
                if dparams.get('name') == 'f':
                    file_part = content
                    fn = dparams.get('filename')
                    if fn:
                        filename = os.path.basename(fn)
                    break

            if file_part is None:
                raise ValueError("Missing form field 'f'")

            pw = (self.headers.get('pw') or '').strip()

            tmpdir = tempfile.mkdtemp(prefix='cp-u2c-proxy-')
            try:
                tmp_path = os.path.join(tmpdir, filename)
                with open(tmp_path, 'wb') as out:
                    out.write(file_part)

                url = run_u2c(self.server.u2c_path, self.server.dest_url, pw, tmp_path)

                payload = {
                    'ok': True,
                    'fileurl': url,
                    'files': [{'url': url, 'name': filename}],
                }
                self._send(200, json.dumps(payload).encode('utf-8'))
            finally:
                try:
                    shutil.rmtree(tmpdir)
                except Exception:
                    pass

        except Exception as e:
            payload = {'ok': False, 'error': str(e)}
            self._send(400, json.dumps(payload).encode('utf-8'))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dest", required=True, help="Copyparty destination folder URL")
    ap.add_argument("--u2c", required=True, help="Path to u2c.py")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=2636)
    args = ap.parse_args(argv)

    class _S(HTTPServer):
        def __init__(self, *a, **kw):
            super().__init__(*a, **kw)
            self.dest_url = args.dest
            self.u2c_path = args.u2c

    httpd = _S((args.host, args.port), Handler)
    print(f"Listening on http://{args.host}:{args.port}/")
    print(f"Uploading to: {args.dest}")
    print(f"Using u2c.py: {args.u2c}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nBye")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
