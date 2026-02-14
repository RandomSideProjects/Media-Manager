#!/usr/bin/env python3
"""Start an HTTP server rooted at the script directory."""

from __future__ import annotations

import argparse
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Serve the script's directory over HTTP.")
    parser.add_argument(
        "--host",
        default="0.0.0.0",
        help="Host to bind the server to.",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=80,
        help="Port number to listen on.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    parent_dir = Path(__file__).resolve().parent.parent
    os.chdir(parent_dir)
    server_address = (args.host, args.port)
    handler_class = SimpleHTTPRequestHandler

    with ThreadingHTTPServer(server_address, handler_class) as server:
        print(
            f"Serving {parent_dir} at http://{args.host}:{args.port} "
            "(press Ctrl+C to stop)"
        )
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down server.")


if __name__ == "__main__":
    main()
