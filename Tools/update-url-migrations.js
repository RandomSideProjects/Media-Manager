#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function parseArgs(argv) {
  const dirs = [];
  let range = 'HEAD~1..HEAD';
  let migrationsFile = 'Sources/url-migrations.json';

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      return { help: true, dirs, range, migrationsFile };
    }
    if (a === '--range') {
      range = String(argv[i + 1] || '').trim();
      i += 1;
      continue;
    }
    if (a === '--migrations-file') {
      migrationsFile = String(argv[i + 1] || '').trim();
      i += 1;
      continue;
    }
    if (a.startsWith('-')) continue;
    dirs.push(a);
  }

  return { help: false, dirs, range, migrationsFile };
}

function usage() {
  return [
    'update-url-migrations.js',
    '',
    'Usage:',
    '  node Tools/update-url-migrations.js [--range A..B] [--migrations-file path] <dir> [dir...]',
    '',
    'Examples:',
    '  node Tools/update-url-migrations.js Sources/Files/Anime',
    '  node Tools/update-url-migrations.js --range HEAD~1..HEAD Sources/Files/Anime Sources/Files/Manga',
    ''
  ].join('\n');
}

function execGit(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trimEnd();
}

function gitRefExists(ref) {
  try {
    execGit(`git rev-parse --verify ${JSON.stringify(ref)}`);
    return true;
  } catch {
    return false;
  }
}

function normalizeLabel(value, fallback) {
  const v = String(value || '').trim();
  if (v) return v;
  return String(fallback || '').trim() || 'unknown';
}

function coerceSrc(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  return trimmed;
}

function listChildrenArrays(obj) {
  if (!obj || typeof obj !== 'object') return [];
  const out = [];
  for (const key of ['episodes', 'items', 'entries', 'volumes', 'sources', 'parts', '__separatedParts']) {
    if (Array.isArray(obj[key]) && obj[key].length) out.push({ key, arr: obj[key] });
  }
  return out;
}

function collectSrcMap(json) {
  const map = new Map();

  function add(key, url) {
    const u = coerceSrc(url);
    if (!u) return;
    map.set(String(key), u);
  }

  function addEntry(prefix, entry, indexFallback) {
    if (!entry || typeof entry !== 'object') return;
    const entryLabel = normalizeLabel(entry.title ?? entry.name ?? entry.id, `item_${indexFallback}`);

    if (typeof entry.src === 'string') {
      add(`${prefix}::${entryLabel}`, entry.src);
    }

    for (const { key: arrayKey, arr } of listChildrenArrays(entry)) {
      // Avoid re-walking primary lists.
      if (arrayKey === 'episodes' || arrayKey === 'volumes') continue;
      for (let i = 0; i < arr.length; i++) {
        const part = arr[i];
        if (!part || typeof part !== 'object') continue;
        const partLabel = normalizeLabel(part.title ?? part.name ?? part.id, `${arrayKey}_${i + 1}`);
        if (typeof part.src === 'string') {
          add(`${prefix}::${entryLabel}::${partLabel}`, part.src);
        }
      }
    }
  }

  if (json && typeof json === 'object') {
    if (Array.isArray(json.categories) && json.categories.length) {
      for (let c = 0; c < json.categories.length; c++) {
        const cat = json.categories[c];
        const catLabel = normalizeLabel(cat && (cat.category ?? cat.title ?? cat.name), `category_${c + 1}`);

        const candidates = listChildrenArrays(cat);
        const list =
          candidates.find(x => x.key === 'episodes')?.arr ??
          candidates.find(x => x.key === 'items')?.arr ??
          candidates.find(x => x.key === 'entries')?.arr ??
          [];

        for (let i = 0; i < list.length; i++) {
          addEntry(catLabel, list[i], i + 1);
        }
      }
    } else {
      // Fallback for older schemas: top-level lists.
      for (const { key, arr } of listChildrenArrays(json)) {
        if (key === 'sources' || key === 'parts' || key === '__separatedParts') continue;
        const catLabel = normalizeLabel(key, key);
        for (let i = 0; i < arr.length; i++) {
          addEntry(catLabel, arr[i], i + 1);
        }
      }
    }
  }

  return map;
}

function loadJsonFromGit(commitish, filePath) {
  const spec = `${commitish}:${filePath}`;
  try {
    const raw = execGit(`git show ${JSON.stringify(spec)}`);
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function loadJsonFromDisk(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function loadMigrationsPayload(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return { mappings: parsed };
    if (parsed && Array.isArray(parsed.mappings)) return { mappings: parsed.mappings };
  } catch {}
  return { mappings: [] };
}

function stableJsonStringify(obj) {
  return JSON.stringify(obj, null, 2) + '\n';
}

function main() {
  const { help, dirs, range, migrationsFile } = parseArgs(process.argv.slice(2));
  if (help || !dirs.length) {
    process.stdout.write(usage());
    process.exit(help ? 0 : 2);
  }

  const normalizedDirs = dirs
    .map(d => String(d || '').trim().replace(/\\/g, '/').replace(/\/+$/, ''))
    .filter(Boolean);

  const m = String(range || '').trim().match(/^(.+?)(?:\.{2,3})(.+)$/);
  if (!m) {
    console.error(`[url-migrations] Invalid --range "${range}". Expected "A..B".`);
    process.exit(2);
  }
  const fromRef = m[1].trim();
  const toRef = m[2].trim();

  if (!gitRefExists(toRef)) {
    console.error(`[url-migrations] Git ref not found: ${toRef}`);
    process.exit(2);
  }
  if (!gitRefExists(fromRef)) {
    console.log(`[url-migrations] Git ref not found (${fromRef}); skipping (likely initial commit).`);
    return;
  }

  let diffRaw = '';
  try {
    diffRaw = execGit(`git diff --name-only ${JSON.stringify(fromRef)} ${JSON.stringify(toRef)}`);
  } catch (e) {
    console.log('[url-migrations] Could not compute git diff; skipping.');
    return;
  }

  const diffNames = diffRaw
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);

  const changedJsonFiles = diffNames.filter((f) => {
    if (!f.toLowerCase().endsWith('.json')) return false;
    const ff = f.replace(/\\/g, '/');
    return normalizedDirs.some(d => ff === d || ff.startsWith(d + '/'));
  });

  if (!changedJsonFiles.length) {
    console.log('[url-migrations] No changed JSON files in', normalizedDirs.join(', '));
    return;
  }

  const migrationsPath = migrationsFile || 'Sources/url-migrations.json';
  const payload = loadMigrationsPayload(migrationsPath);
  const mappings = Array.isArray(payload.mappings) ? payload.mappings.filter(Boolean) : [];
  const existingPairs = new Set(
    mappings
      .filter(m => m && typeof m === 'object')
      .map(m => `${String(m.old || '').trim()} -> ${String(m.new || '').trim()}`)
  );

  const newlyAdded = [];

  for (const filePath of changedJsonFiles) {
    const oldJson = loadJsonFromGit(fromRef, filePath);
    const newJson = loadJsonFromDisk(filePath);
    if (!oldJson || !newJson) continue;

    const oldMap = collectSrcMap(oldJson);
    const newMap = collectSrcMap(newJson);

    for (const [key, oldUrl] of oldMap.entries()) {
      const newUrl = newMap.get(key);
      if (!newUrl) continue;
      if (oldUrl === newUrl) continue;
      const oldTrim = String(oldUrl || '').trim();
      const newTrim = String(newUrl || '').trim();
      if (!oldTrim || !newTrim || oldTrim === newTrim) continue;

      const pairKey = `${oldTrim} -> ${newTrim}`;
      if (existingPairs.has(pairKey)) continue;

      existingPairs.add(pairKey);
      const record = { old: oldTrim, new: newTrim };
      mappings.push(record);
      newlyAdded.push({ filePath, key, old: oldTrim, new: newTrim });
    }
  }

  if (!newlyAdded.length) {
    console.log('[url-migrations] No src URL changes detected.');
    return;
  }

  const nextPayload = { mappings };
  const nextText = stableJsonStringify(nextPayload);

  let prevText = '';
  try {
    prevText = fs.existsSync(migrationsPath) ? fs.readFileSync(migrationsPath, 'utf8') : '';
  } catch {}

  if (prevText === nextText) {
    console.log('[url-migrations] No file change after update (already up to date).');
    return;
  }

  fs.mkdirSync(path.dirname(migrationsPath), { recursive: true });
  fs.writeFileSync(migrationsPath, nextText);

  console.log(`[url-migrations] Added ${newlyAdded.length} mapping(s) to ${migrationsPath}:`);
  for (const item of newlyAdded.slice(0, 50)) {
    console.log(`- ${item.filePath} :: ${item.key}`);
  }
  if (newlyAdded.length > 50) {
    console.log(`- ... (${newlyAdded.length - 50} more)`);
  }
}

main();
