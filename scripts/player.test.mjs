import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

// player.js is a browser script, but the Toodrive URL helpers are pure.
// Load the whole file in a VM with minimal browser stubs so the candidate
// order is exercised against the real code, not a copy.
const ROOT = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(ROOT, "player.js"), "utf8");

function loadPlayer() {
  const noop = () => {};
  const sandbox = {
    console, URL, Map, Set, JSON, Math, Date, RegExp, Promise,
    Number, String, Boolean, Array, Object, TextEncoder, TextDecoder,
    Uint8Array, setTimeout, clearTimeout, setInterval, clearInterval,
    window: { addEventListener: noop, removeEventListener: noop },
    document: { addEventListener: noop, removeEventListener: noop },
    // Named-element globals are absent outside a real page; the top-level
    // control guards treat missing elements as "nothing to bind".
    cbzPrevBtn: undefined,
    cbzNextBtn: undefined,
    cbzImageWrap: undefined,
    nextBtn: undefined,
    backBtn: undefined,
    video: undefined,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(
    `${source}\n;globalThis.__playerTest = { toodrivePlayerCandidates, normalizeToodrivePlayerUrl };`,
    sandbox,
    { filename: "player.js" },
  );
  return sandbox.__playerTest;
}

const player = loadPlayer();
// Results cross a VM realm boundary, so copy arrays into host arrays before
// strict comparison (prototypes differ across realms).
const candidates = (url) => [...player.toodrivePlayerCandidates(url)];

test("tries the current Toodrive host before the legacy modal host", () => {
  assert.deepEqual(
    candidates("https://uhidontkno--toodrive-serve.modal.run/dl/abc/raw"),
    [
      "https://toodrive.xpbliss.fyi/dl/abc/raw",
      "https://uhidontkno--toodrive-serve.modal.run/dl/abc/raw",
    ],
  );
  assert.deepEqual(
    candidates("https://toodrive.xpbliss.fyi/dl/abc/raw"),
    [
      "https://toodrive.xpbliss.fyi/dl/abc/raw",
      "https://uhidontkno--toodrive-serve.modal.run/dl/abc/raw",
    ],
  );
});

test("normalizes retired and loopback Toodrive hosts to the current host", () => {
  assert.equal(
    player.normalizeToodrivePlayerUrl("https://td.alexspac.es/dl/abc/raw"),
    "https://toodrive.xpbliss.fyi/dl/abc/raw",
  );
  assert.equal(
    player.normalizeToodrivePlayerUrl("http://localhost:16169/dl/abc/raw"),
    "https://toodrive.xpbliss.fyi/dl/abc/raw",
  );
});

test("leaves non-Toodrive URLs untouched", () => {
  assert.deepEqual(
    candidates("https://example.com/video.mp4"),
    ["https://example.com/video.mp4"],
  );
});
