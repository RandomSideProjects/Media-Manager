#!/usr/bin/env node

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outputRoot = join(sourceRoot, "Maintenance", "tauri-dist");

await rm(outputRoot, { recursive: true, force: true });
await mkdir(join(outputRoot, "Assets"), { recursive: true });

let html = await readFile(join(sourceRoot, "Maintenance", "index.html"), "utf8");
html = html
  .replaceAll("../Assets/", "Assets/")
  .replaceAll("../index.html", "index.html")
  .replaceAll("../Creator/index.html", "index.html");

await writeFile(join(outputRoot, "index.html"), html, "utf8");
await cp(join(sourceRoot, "Maintenance", "styles.css"), join(outputRoot, "styles.css"));
await cp(join(sourceRoot, "Maintenance", "app.js"), join(outputRoot, "app.js"));
await cp(join(sourceRoot, "Assets", "Favicon.png"), join(outputRoot, "Assets", "Favicon.png"));

console.log(`Prepared Tauri frontend at ${outputRoot}`);
