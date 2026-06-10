"use strict";

// Variables (top)
const UPLOADER_CATBOX_BACKEND_URL = 'https://mm.littlehacker303.workers.dev/catbox/user/api.php';
const CUSTOM_CATBOX_LIMIT = 104857600;
const DIRECT_CATBOX_UPLOAD_URL = 'https://catbox.moe/user/api.php';
const DEFAULT_CATBOX_USERHASH = '2cdcc7754c86c2871ed2bde9d';
const RANDOM_CATBOX_USERHASHES = `
b5e8d39aac630a69c00846257
2865a61a05f4cc4886350c5fd
279bc1d10cc16a268303bf0fe
d031f60ef784c33d0bba61e9c
16c6f7b88b999f7776f8ded71
aa4902ced4a3fcb0b5957ff17
9d5de0db7305d06927133adf6
7e1b01757a1eccb9a49f7a687
11834bcd2d19cb2b4f71f0b39
cd63322e49bbaab1c1babd33c
154b52b72cd304a99316b171b
e6a99c99ce92f172ba5818926
3214924ad63f3369efcdb10dd
0c4383b1c0730b8a80c2e5b32
1eb945b55a2836dc18a8e0305
7b0b4f7451bb0f9fb6185ec49
3b9a792168e206f21b6f480ba
1b31c012bd0b0b7993c5d1629
88b96e587c93b3dd3d205f3e4
e5d70ba45d2f69a9d3dd43ef2
e505bb573c8cfc018832f9fe7
8ef3af4e381f09d6a1ee11123
ea8690534b9a3e332ce143f92
551e4c5fa4b901d81f9f936ef
f931ffcaef5db88de20b97a46
c2d9291dd6b10b4bed7fd7db7
93b867d51644aa1fda9556db4
f0388e4f542fd7808090262f1
be9d09d7f3a67ec7d46d2ce86
2ee93bb8492b8e8662c8cd153
d3683393318a520c75c226e6b
fd850e2e3405330bbd8d52975
d43ef43272edd7e2370756cdd
01fdf3d7e4d75b495afefa94a
e6c949b2bbce0fc60a247b19d
7888b9fdb50be0dd9ab08fcaa
26a32491247290d327e1ce04e
964b38ebc173fef2b2b2c0bc0
3291dc8d4c37358f7ca8edd9c
17eacdd507fd3857093433c40
75bec934cdb621bb13d762799
a3556791f0ef25f58c7c0df81
01ea37abc628d36a07f57736a
9944ff071b053f0491c7b4ed8
f0376640248783d2a1b967e71
8efcf8a7ddec2e2197fc74dfe
6b566583856b0ec9ee9f9b201
f1ad15335d8c36bf8e1340291
7c707aac93a4e390f89a41d34
04c3d12fae49d85045c1aec3a
91f2a0c64885ff310647f56f0
72dacf9a0cb4425743e404b8e
98ed16ca4820f3573e54dcd14
b579bb48f6047a1e6ed6a05e2
a3c05d9a6657f26dc8552ecdb
35f1695d28b08f66c21c955e3
7bff48e439db706a27cbe1a96
482b79c0bf5c863ff2475d37b
141cdb49aec56e9e24b3c6bed
6c0b49c14e62c2ad1230108c4
f6f86ac0484947accb93ef4c7
794bb38dedd6ba0dcd3b09e22
f6c49e68795b1112038772497
aaa367d30ab2f2c16871d931c
3a729b48f57e35c816dddfd8a
e201f082e84dd453ed556b1c0
3b8d981562bec1ef9efe0af2a
f433cee6f5a6d6d13a4963741
76aa750b32001481f6eba7ee2
ad2173e6872ada163aa53f069
dae59a86023c147838579b7da
2b8a470fa87674e163080d24f
57785ac5106c06e426d83e95a
c35e90f6f3147e4fee3f79558
1a97cf906a67eb1529b25e821
4e1e96547c3e7789bca474f5f
4e3987d6c59f5aaa76c3fb5ab
7338679229afa3573fca86841
7d63d70f3e68a5222ae421a76
a5e0e6fd82a25de58a15f0af3
1aa5ee46c3d4de6734e327609
0c5b38bb0577814552b1e3cc0
6bd1f102b75915d466cbc36b7
97f7a934348ce71d214e12581
a6bb4f99bdc3fb5e9f3db9417
caf14a3a9f883c4be7f1ebe6f
300efd09b6ea87de82547cb4e
44c0e4ec1d0d7f78562a93b64
5212171143b8b3e5b801b6289
76c410bbe1ec7a36f4ff2475f
f47988a69fa48f9df05e97aa1
834e17f9464b240937105e5fa
af77410d4bbd512a2bf022f30
7b8c5ceeaab9bf12caf7b16bf
003c919e60d482b908d5b1189
f5dca62065f37750378809c70
2454824eb56e848628125240d
05626bf617c29eaf83a8ce9d8
5e85f517fa14d9a1c973b950e
fabf7f33e61c680f72ee8642b
78e880ece4508adc2657fef04
103ec5014547c41c7a728ab07
ff17f38ac80cc46b9e79df2e9
921a3bd073e5ee47ba8812eb4
00c9289831bb222d2e82ef991
b98877abbbaa284a4ce772032
b6c9df6c1d44d1af66d9fee1a
062dc63e040883c16e00bd0e1
70b30237d7c3d2b2404c31c2b
92ed1a124ce6053f2093bcdea
ab535f128650efad3cb0a20f8
5d3334f308f437ae564e10080
f834aee57994721fa617eb0d8
dbb6405836ca72a3bb7b6488a
57ec019798ae9e8920e5684fa
546dc1c7366b4c0c276f4e57c
3cd42da41c187a14d6b8a2891
648610a1082b3c26e5fd7dd56
73523c5c4cf7719bec76521c7
aecf8394a7a3fce1c13bedb27
14cca31ebadfb69e518e846ed
361d75ec122e7792f2866aead
4de49460d25392c1f7f07af30
a8ce3d513d7d0c2b419b1e4e7
f7d78a0a76428a784330bdf21
2520555d2452e923d57f8f2e1
a102b5fc9223b0c02c98152bc
b0fc4d52be6c10ebe30b825c9
056f88715f2b3ca3fa08956da
6296b919cd6d02b994f1f5e92
5e045be3635eb2e098d2da10d
29089b7f9b507e00175372b48
8f9637b939faa8564a3309ca1
6c2b89831ddc103c9dba2c0ee
db53d0e9a9c7ffda2c55b08f5
c0704dee77ee961c404102691
ea4ee6b59ec70b2ed6abfee25
4ef55065c8e401cc4c1411dc6
4a0cb8aeafd495c1b3547d46b
2b51c089aa5683d0e4c9e2f00
3f7237876c7a61b1c60e9d78b
c2d41880809d6ec95b8d92ee4
36edc70b152bb185810c65e79
e2874a3780ef4b66a7d7d9cdd
f3a9f4b160edec30e29109db2
9facee4f0c9b2b0e0deac71bb
aae3c1de074f026804d83c897
acfdf9c240ee05a3a9a6740ac
7674b7776be958f3857d6f24e
75784f6801fbc673236b8e7cf
5434900cee7ede1324c9a2dd5
babc6cfe4a003e5964765fb89
725d6564d104fd8673260cd71
447e09597644a49a733421d38
c611f71c284dc4df9916f2979
a206ae604d74f42066b4b3b3f
d1ab7029a5c52b8d366e53cbb
bae96c713be4abaf9432cf408
29f9c9467bf8a4b2107db7a71
01b5a0dc0472d0af125a8dbc9
9b72396f94533f3bb2670a52a
e9f76fd70730ae4432c8ffd03
02065337cccf72bd35e1879c6
047a9995d630296479c585b9f
92f945bead4ccdf0776e0a68b
ed07c91dbc63dc47bed0ef76d
f934f9160dfa809365485ba6c
f69de69a7c4a4f714ab52d476
2132d9415212b1d8102da0b02
c60430fc562c6e3d6597ea98c
ab352dba3b3a985725f776241
2a139d5898c4245e6298c22a3
3e4eb23949d26a466133945a3
d88748560b41265ff5bbaf8f5
83c4d757fc49fe79b9e8c0fb9
2e5e7aa8f683642735eb10d3d
27dd2e47cffeb5dd21fea2dc5
caec5c30179652e88ad458e6d
d1455cea9ee1c1ca1ed8f0325
11c456038c1a39313ec66dbab
121553f476d05d057befcfe72
238f6a8cbfee70fb358f1f06e
ee488c385f7361d82da0c1183
546f8e8f70e8186d490a5d2c0
f7a7ca73069c1903fda8cc5b7
f0e9e67adc14ce469b5307f40
3dc9d269681a34ac34f23d325
3bb46378ba093a96f004fc27c
8df9a3242df0a7c3308caaa45
e2a83f90970403e57e91f2b8a
5aaaad23378fbda4da2ea76ae
a95ffb0c5516b50674b7ae839
bf64be6e7fc74de04db130f9f
122fdb75c3037a254227eb171
f759737af36e430df4992bf5f
95ec8767c682b8da52838b19b
97cd815cf7370cda7412ce476
fe1a062d12ac4fc2af4bceaa3
f681e9df84e8c951de41ca61c
c8b69777f415dddcdcdba8439
`.trim().split(/\s+/).filter(Boolean);

function getUploadServerApi() {
  return (typeof window !== 'undefined' && window.MMUploadServer) ? window.MMUploadServer : null;
}

function isUsableUploadUrl(raw) {
  if (typeof raw !== 'string') return false;
  const trimmed = raw.trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  if (lower === 'undefined' || lower === 'null') return false;
  try {
    const parsed = new URL(trimmed, (typeof location !== 'undefined' && location && location.href) ? location.href : undefined);
    return /^https?:$/i.test(parsed.protocol);
  } catch {
    return false;
  }
}

function sanitizeUploadUrl(raw, fallback = '') {
  return isUsableUploadUrl(raw) ? raw.trim() : fallback;
}

function getActiveCatboxDefault() {
  if (typeof window !== 'undefined') {
    const active = typeof window.MM_ACTIVE_CATBOX_UPLOAD_URL === 'string' ? window.MM_ACTIVE_CATBOX_UPLOAD_URL.trim() : '';
    if (isUsableUploadUrl(active)) return active;
  }
  return DIRECT_CATBOX_UPLOAD_URL;
}

function normalizeCatboxUrl(raw) {
  const trimmed = (typeof raw === 'string') ? raw.trim() : '';
  if (!trimmed) {
    return { url: '', code: '' };
  }

  let normalizedUrl = trimmed;
  let code = '';
  try {
    const parsed = new URL(trimmed);
    const hostname = (parsed.hostname || '').toLowerCase();
    if (hostname === 'files.catbox.moe') {
      const path = parsed.pathname.replace(/^\/+/, '');
      normalizedUrl = `https://files.catbox.moe/${path}`;
      code = path.replace(/\.json$/i, '');
    } else {
      const match = parsed.pathname.match(/\/files\/(.+)/i);
      if (match && match[1]) {
        const path = match[1];
        normalizedUrl = `https://files.catbox.moe/${path}`;
        code = path.replace(/\.json$/i, '');
      }
    }
  } catch {
    const match = trimmed.match(/files\.catbox\.moe\/([^\s]+)/i);
    if (match && match[1]) {
      normalizedUrl = `https://files.catbox.moe/${match[1]}`;
      code = match[1].replace(/\.json$/i, '');
    }
  }

  if (!code && normalizedUrl.startsWith('https://files.catbox.moe/')) {
    code = normalizedUrl.replace('https://files.catbox.moe/', '').replace(/\.json$/i, '');
  }

  return { url: normalizedUrl, code };
}

function extractUploadResponseUrl(raw) {
  const text = (typeof raw === 'string') ? raw.trim() : '';
  const normalized = normalizeCatboxUrl(text);
  const candidate = normalized.url || text;
  if (/^https?:\/\//i.test(candidate)) {
    return candidate;
  }
  throw new Error('Catbox did not return a valid URL.');
}

if (typeof window !== 'undefined') {
  window.mm_normalizeCatboxUrl = normalizeCatboxUrl;
}

function pad2(value) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 0) return '00';
  return String(n).padStart(2, '0');
}

function parseSeasonNumber(categoryTitle) {
  const raw = (typeof categoryTitle === 'string') ? categoryTitle.trim() : '';
  if (!raw) return null;
  const match = raw.match(/^season\s*#?\s*(\d{1,3})\s*$/i);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function sanitizeFilenameSegment(value, { fallback = 'Item', maxLen = 80 } = {}) {
  const base = (typeof value === 'string') ? value : String(value || '');
  const normalized = typeof base.normalize === 'function' ? base.normalize('NFKD') : base;
  const filtered = normalized
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const safe = filtered.replace(/[^A-Za-z0-9 _.-]+/g, '').trim();
  const collapsed = safe.replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  const finalValue = collapsed || fallback;
  return finalValue.length > maxLen ? finalValue.slice(0, maxLen) : finalValue;
}

function buildCopypartySourceFolderName(sourceTitle) {
  const base = (typeof sourceTitle === 'string') ? sourceTitle : String(sourceTitle || '');
  const normalized = typeof base.normalize === 'function' ? base.normalize('NFKD') : base;
  const filtered = normalized
    .replace(/['’]/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/[^A-Za-z0-9! ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!filtered) return '';

  const endsWithBang = /!$/.test(filtered);
  const words = filtered
    .replace(/!+$/g, '')
    .split(/\s+/)
    .map((word) => word ? (word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()) : '')
    .filter(Boolean);
  if (!words.length) return '';

  const joined = words.join('');
  return `${joined}${endsWithBang ? '!' : ''}`;
}

function getCurrentSourceTitle() {
  try {
    if (typeof document === 'undefined') return '';
    const input = document.getElementById('dirTitle');
    return input && typeof input.value === 'string' ? input.value.trim() : '';
  } catch {
    return '';
  }
}

function getCopypartySubdir(opts) {
  const options = (opts && typeof opts === 'object') ? opts : {};
  const explicit = typeof options.sourceFolder === 'string' ? options.sourceFolder.trim() : '';
  if (explicit) return explicit;
  return buildCopypartySourceFolderName(getCurrentSourceTitle());
}

function buildCreatorItemFilenameBase({ categoryTitle, itemIndex, sourceTitle } = {}) {
  const season = parseSeasonNumber(categoryTitle);
  const idx = Math.max(1, Math.floor(Number(itemIndex) || 1));
  const indexPart = season ? `S${pad2(season)}E${pad2(idx)}` : pad2(idx);
  const titlePart = sanitizeFilenameSegment(sourceTitle, { fallback: 'Item' });
  return `${indexPart}_${titlePart}`;
}

function randomUploadBase(len = 10) {
  try {
    if (typeof crypto !== 'undefined' && crypto && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID().replace(/-/g, '').slice(0, Math.max(8, len));
    }
  } catch {}
  try {
    if (typeof crypto !== 'undefined' && crypto && typeof crypto.getRandomValues === 'function') {
      const bytes = new Uint8Array(Math.max(8, Math.ceil(len / 2)));
      crypto.getRandomValues(bytes);
      return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, len);
    }
  } catch {}
  return Math.random().toString(16).slice(2, 2 + len);
}

function inferExtensionFromFileName(name) {
  const raw = (typeof name === 'string') ? name : '';
  const idx = raw.lastIndexOf('.');
  if (idx <= 0) return '';
  const ext = raw.slice(idx);
  if (!/^\.[a-z0-9]{1,8}$/i.test(ext)) return '';
  return ext;
}

function withUploadFilename(file, opts) {
  const options = (opts && typeof opts === 'object') ? opts : {};
  if (!(file instanceof File)) return file;

  const ext = inferExtensionFromFileName(file.name);
  const explicitFilenameRaw = (typeof options.filename === 'string' ? options.filename : (typeof options.fileName === 'string' ? options.fileName : '')).trim();
  const filenameBaseRaw = typeof options.filenameBase === 'string' ? options.filenameBase.trim() : '';
  const creatorItem = options && typeof options.creatorItem === 'object' ? options.creatorItem : null;

  const shouldRandomize = options.randomizeFilename !== false;

  let nextName = '';
  if (explicitFilenameRaw) {
    nextName = explicitFilenameRaw;
    if (ext && !/\.[a-z0-9]{1,8}$/i.test(nextName)) nextName = `${nextName}${ext}`;
  } else if (filenameBaseRaw) {
    nextName = `${filenameBaseRaw}${ext}`;
  } else if (creatorItem) {
    nextName = `${buildCreatorItemFilenameBase(creatorItem)}${ext}`;
  } else if (shouldRandomize) {
    nextName = `${randomUploadBase()}${ext}`;
  } else {
    nextName = file.name;
  }

  nextName = sanitizeFilenameSegment(nextName, { fallback: file.name || 'upload' });
  if (ext && !nextName.toLowerCase().endsWith(ext.toLowerCase())) {
    nextName = `${nextName}${ext}`;
  }
  if (nextName === file.name) return file;

  try {
    return new File([file], nextName, { type: file.type || 'application/octet-stream', lastModified: file.lastModified });
  } catch {
    return file;
  }
}

if (typeof window !== 'undefined') {
  window.mm_buildCreatorItemFilenameBase = buildCreatorItemFilenameBase;
}

function readUploadSettings() {
  try {
    if (typeof window !== 'undefined' && window.mm_uploadSettings && typeof window.mm_uploadSettings.load === 'function') {
      return window.mm_uploadSettings.load();
    }
  } catch {}
  try { return JSON.parse(localStorage.getItem('mm_upload_settings') || '{}') || {}; } catch { return {}; }
}

function defaultCatboxUploadUrl() {
  const api = getUploadServerApi();
  if (api && api.directUrl) return api.directUrl;
  return getActiveCatboxDefault();
}

function pickRandomCatboxUserhash() {
  if (!RANDOM_CATBOX_USERHASHES.length) return DEFAULT_CATBOX_USERHASH;
  const index = Math.floor(Math.random() * RANDOM_CATBOX_USERHASHES.length);
  return RANDOM_CATBOX_USERHASHES[index] || DEFAULT_CATBOX_USERHASH;
}

function resolveEffectiveCatboxUserhash(settings) {
  if (settings && typeof settings._resolvedUserhash === 'string' && settings._resolvedUserhash.trim()) {
    return settings._resolvedUserhash.trim();
  }
  if (settings && settings.useRandomCatboxUserhash === true) {
    return pickRandomCatboxUserhash();
  }
  return DEFAULT_CATBOX_USERHASH;
}

function normalizeCatboxMode(value) {
  const api = getUploadServerApi();
  if (api && typeof api.normalizeMode === 'function') {
    return api.normalizeMode(value);
  }
  const trimmed = (typeof value === 'string') ? value.trim().toLowerCase() : 'auto';
  if (trimmed === 'direct') return 'direct';
  if (trimmed === 'proxy') return 'proxy';
  if (trimmed === 'copyparty') return 'copyparty';
  return 'auto';
}

function getCatboxProxyUrl(settings) {
  const api = getUploadServerApi();
  if (api && typeof api.getSettings === 'function') {
    const proxyUrl = api.getSettings().proxyUrl;
    return sanitizeUploadUrl(proxyUrl, UPLOADER_CATBOX_BACKEND_URL);
  }
  const raw = settings && typeof settings.catboxUploadUrl === 'string' ? settings.catboxUploadUrl.trim() : '';
  return sanitizeUploadUrl(raw, UPLOADER_CATBOX_BACKEND_URL);
}

function shouldUseCopypartyForFile(settings, fileSizeBytes, mode) {
  const api = getUploadServerApi();
  if (api && typeof api.shouldUseCopyparty === 'function') {
    return api.shouldUseCopyparty(settings, fileSizeBytes, mode);
  }
  const cp = settings && typeof settings.copypartyUploadUrl === 'string' ? settings.copypartyUploadUrl.trim() : '';
  if (!cp) return false;
  if (normalizeCatboxMode(mode) === 'copyparty') return true;
  const thresholdMbRaw = (settings && Number.isFinite(parseFloat(settings.copypartyThresholdMb))) ? parseFloat(settings.copypartyThresholdMb) : 100;
  const thresholdMb = Math.max(6, Math.min(100, thresholdMbRaw));
  const thresholdBytes = thresholdMb * 1024 * 1024;
  return Number.isFinite(fileSizeBytes) && fileSizeBytes >= thresholdBytes;
}

function resolveCatboxUploadTarget(settings, { fileSizeBytes, allowProxy = true, forceProxy = false } = {}) {
  const api = getUploadServerApi();
  const proxyUrl = getCatboxProxyUrl(settings);
  if (forceProxy) {
    return { kind: 'proxy', url: proxyUrl, fallbackUrl: '' };
  }
  if (api && typeof api.resolveTarget === 'function') {
    const resolved = api.resolveTarget({ settings, fileSizeBytes, allowProxy, forceProxy }) || {};
    const kind = typeof resolved.kind === 'string' ? resolved.kind : 'auto';
    const fallbackBase = allowProxy === false ? '' : proxyUrl;
    let url = sanitizeUploadUrl(resolved.url, '');
    let fallbackUrl = sanitizeUploadUrl(resolved.fallbackUrl, '');
    if (!url) {
      if (kind === 'proxy') url = proxyUrl;
      else if (kind === 'direct') url = DIRECT_CATBOX_UPLOAD_URL;
      else if (kind === 'copyparty') {
        const cpUrl = settings && typeof settings.copypartyUploadUrl === 'string' ? settings.copypartyUploadUrl.trim() : '';
        url = sanitizeUploadUrl(cpUrl, '');
      } else {
        url = DIRECT_CATBOX_UPLOAD_URL;
        fallbackUrl = fallbackUrl || fallbackBase;
      }
    }
    if (!fallbackUrl && kind === 'auto') fallbackUrl = fallbackBase;
    return Object.assign({}, resolved, { kind, url, fallbackUrl });
  }
  const mode = normalizeCatboxMode(settings && settings.catboxOverrideMode);
  const cp = settings && typeof settings.copypartyUploadUrl === 'string' ? settings.copypartyUploadUrl.trim() : '';
  const active = (typeof window !== 'undefined' && typeof window.MM_ACTIVE_CATBOX_UPLOAD_URL === 'string')
    ? sanitizeUploadUrl(window.MM_ACTIVE_CATBOX_UPLOAD_URL.trim(), '')
    : '';

  if (shouldUseCopypartyForFile(settings, fileSizeBytes, mode)) {
    return { kind: 'copyparty', url: cp, fallbackUrl: '' };
  }
  if (mode === 'proxy') {
    return { kind: 'proxy', url: proxyUrl, fallbackUrl: '' };
  }
  if (mode === 'direct') {
    return { kind: 'direct', url: DIRECT_CATBOX_UPLOAD_URL, fallbackUrl: '' };
  }
  if (active && active !== DIRECT_CATBOX_UPLOAD_URL && active !== cp) {
    return { kind: 'auto', url: active, fallbackUrl: '' };
  }
  return {
    kind: 'auto',
    url: DIRECT_CATBOX_UPLOAD_URL,
    fallbackUrl: allowProxy === false ? '' : proxyUrl
  };
}

function updateCatboxRuntime(target) {
  const api = getUploadServerApi();
  if (api && typeof api.applyRuntime === 'function') {
    const current = (typeof window.MM_ACTIVE_CATBOX_UPLOAD_URL === 'string' && window.MM_ACTIVE_CATBOX_UPLOAD_URL.trim())
      ? sanitizeUploadUrl(window.MM_ACTIVE_CATBOX_UPLOAD_URL.trim(), '')
      : '';
    if (target && target.kind === 'copyparty') {
      window.MM_ACTIVE_CATBOX_UPLOAD_URL = current || DIRECT_CATBOX_UPLOAD_URL;
    } else if (target && isUsableUploadUrl(target.url)) {
      window.MM_ACTIVE_CATBOX_UPLOAD_URL = target.url.trim();
    }
    api.applyRuntime({ source: 'uploader-runtime' });
    return;
  }
  if (typeof window === 'undefined') return;
  const current = (typeof window.MM_ACTIVE_CATBOX_UPLOAD_URL === 'string' && window.MM_ACTIVE_CATBOX_UPLOAD_URL.trim())
    ? sanitizeUploadUrl(window.MM_ACTIVE_CATBOX_UPLOAD_URL.trim(), '')
    : '';
  window.MM_DIRECT_CATBOX_UPLOAD_URL = DIRECT_CATBOX_UPLOAD_URL;
  window.MM_PROXY_CATBOX_UPLOAD_URL = getCatboxProxyUrl(readUploadSettings());
  window.MM_DEFAULT_CATBOX_UPLOAD_URL = DIRECT_CATBOX_UPLOAD_URL;
  if (target && target.kind === 'copyparty') {
    window.MM_ACTIVE_CATBOX_UPLOAD_URL = current || DIRECT_CATBOX_UPLOAD_URL;
  } else if (target && isUsableUploadUrl(target.url)) {
    window.MM_ACTIVE_CATBOX_UPLOAD_URL = target.url.trim();
  }
}
async function ensureUploadServerReady(settings, options = {}) {
  const api = getUploadServerApi();
  if (!api) return;
  const mode = normalizeCatboxMode(settings && settings.catboxOverrideMode);
  if (mode === 'auto' && typeof api.ensure === 'function') {
    await api.ensure({
      force: options.force === true,
      fileSizeBytes: options.fileSizeBytes
    });
    return;
  }
  if (typeof api.applyRuntime === 'function') {
    api.applyRuntime({ source: 'uploader-ensure-ready', mode });
  }
}

function assertUploadSizeLimit() {
  // Delegated to backend limits now
}

function isCopypartyConfigured(settings) {
  const cp = settings && typeof settings.copypartyUploadUrl === 'string' ? settings.copypartyUploadUrl.trim() : '';
  return !!cp;
}

function normalizeRemuxMode(value) {
  return String(value || '').trim().toLowerCase() === 'compatible' ? 'compatible' : 'fast';
}

function getRemuxMode(settings, options) {
  if (options && typeof options.remuxMode === 'string') return normalizeRemuxMode(options.remuxMode);
  return normalizeRemuxMode(settings && settings.remuxMode);
}

function getVideoSplitThresholdBytes() {
  if (typeof window !== 'undefined' && Number.isFinite(Number(window.mmVideoSplitThresholdBytes))) {
    return Number(window.mmVideoSplitThresholdBytes);
  }
  return 200 * 1024 * 1024;
}

function isVideoFileForUpload(file) {
  if (!file) return false;
  try {
    if (typeof window !== 'undefined' && typeof window.mmIsVideoFileForFfmpeg === 'function') {
      return window.mmIsVideoFileForFfmpeg(file) === true;
    }
  } catch {}
  const name = String(file.name || '');
  const type = String(file.type || '');
  return /^video\//i.test(type) || /\.(mp4|m4v|mov|webm|mkv|avi|flv|wmv|mpg|mpeg|ts|mts|m2ts|3gp|ogv)$/i.test(name);
}

function buildAutoSplitPlaylistMeta(options) {
  const existing = options && options.playlistMeta && typeof options.playlistMeta === 'object'
    ? Object.assign({}, options.playlistMeta)
    : {};
  const targetEpisodeEl = options && options.targetEpisodeEl ? options.targetEpisodeEl : null;
  if (!existing.directoryTitle) {
    try {
      const input = document.getElementById('dirTitle');
      if (input && typeof input.value === 'string' && input.value.trim()) existing.directoryTitle = input.value.trim();
    } catch {}
  }
  if (targetEpisodeEl) {
    try {
      const category = typeof targetEpisodeEl.closest === 'function' ? targetEpisodeEl.closest('.category') : null;
      const categoryInput = category && typeof category.querySelector === 'function'
        ? category.querySelector('.category-header input[type="text"]')
        : null;
      if (!existing.categoryTitle && categoryInput && typeof categoryInput.value === 'string' && categoryInput.value.trim()) {
        existing.categoryTitle = categoryInput.value.trim();
      }
      if (!Number.isFinite(Number(existing.categoryIndex)) && category && category.parentElement) {
        existing.categoryIndex = Array.from(category.parentElement.querySelectorAll('.category')).indexOf(category) + 1;
      }
      if (!Number.isFinite(Number(existing.episodeIndex)) && targetEpisodeEl.parentElement) {
        existing.episodeIndex = Array.from(targetEpisodeEl.parentElement.querySelectorAll('.episode')).indexOf(targetEpisodeEl) + 1;
      }
      if (!existing.episodeTitle) {
        const titleInput = targetEpisodeEl.querySelector('input[type="text"]');
        if (titleInput && typeof titleInput.value === 'string' && titleInput.value.trim()) {
          existing.episodeTitle = titleInput.value.trim();
        }
      }
    } catch {}
  }
  const creatorItem = options && options.creatorItem && typeof options.creatorItem === 'object' ? options.creatorItem : null;
  if (!existing.categoryTitle && creatorItem && typeof creatorItem.categoryTitle === 'string') {
    existing.categoryTitle = creatorItem.categoryTitle;
  }
  if (!existing.episodeTitle && creatorItem && typeof creatorItem.sourceTitle === 'string' && creatorItem.sourceTitle.trim()) {
    existing.episodeTitle = creatorItem.sourceTitle.trim();
  }
  if (!Number.isFinite(Number(existing.episodeIndex)) && creatorItem && Number.isFinite(Number(creatorItem.itemIndex))) {
    existing.episodeIndex = Number(creatorItem.itemIndex);
  }
  if (!Number.isFinite(Number(existing.categoryIndex))) existing.categoryIndex = 1;
  if (!Number.isFinite(Number(existing.episodeIndex))) existing.episodeIndex = 1;
  return existing;
}

function applySplitUploadMetadata(targetEpisodeEl, splitUpload) {
  if (!targetEpisodeEl || !splitUpload || typeof splitUpload !== 'object') return;
  try { targetEpisodeEl._hiddenSplitParts = splitUpload.parts || []; } catch {}
  try { targetEpisodeEl._hiddenSplitPlaylistUrl = splitUpload.url || ''; } catch {}
  try {
    if (targetEpisodeEl.dataset) {
      if (splitUpload.totalFileSize > 0) targetEpisodeEl.dataset.fileSizeBytes = String(splitUpload.totalFileSize);
      if (splitUpload.totalDuration > 0) targetEpisodeEl.dataset.durationSeconds = String(splitUpload.totalDuration);
    }
  } catch {}
}

async function maybeRemuxVideoForCatboxUpload(file, onProgress, options, settings) {
  if (!file || !options || options.remuxVideo === false) return { file, didRemux: false };
  if (typeof window === 'undefined' || typeof window.mmShouldRemuxVideoFileToMp4 !== 'function' || typeof window.mmRemuxVideoFileToMp4 !== 'function') {
    return { file, didRemux: false };
  }
  let shouldRemux = false;
  try { shouldRemux = window.mmShouldRemuxVideoFileToMp4(file) === true; } catch {}
  if (!shouldRemux) return { file, didRemux: false };

  const result = await window.mmRemuxVideoFileToMp4(file, {
    remuxMode: getRemuxMode(settings, options),
    onProgress: (info) => {
      if (typeof onProgress !== 'function') return;
      const ratio = Math.max(0, Math.min(1, Number(info && info.ratio) || 0));
      try { onProgress(Math.round(ratio * 100), { stage: 'remuxing', phase: 'remux' }); } catch {}
    }
  });
  if (result && result.file) {
    return {
      file: result.file,
      didRemux: result.didRemux === true,
      durationSeconds: result.durationSeconds
    };
  }
  return { file, didRemux: false };
}

async function maybeAutoSplitPreparedVideoForUpload(file, onProgress, options) {
  if (!file || options.disableAutoSplit === true) return null;
  if (!isVideoFileForUpload(file)) return null;
  if (typeof isCopypartyOverrideEnabledForCreator === 'function') {
    try { if (isCopypartyOverrideEnabledForCreator()) return null; } catch {}
  }
  const thresholdBytes = getVideoSplitThresholdBytes();
  if (!Number.isFinite(Number(file.size)) || Number(file.size) <= thresholdBytes) return null;
  if (typeof window === 'undefined' || typeof window.mmUploadOversizeVideoAsCatboxPlaylist !== 'function') return null;

  const splitUpload = await window.mmUploadOversizeVideoAsCatboxPlaylist(file, {
    context: options.context || 'manual',
    signal: options.signal,
    creatorItem: options.creatorItem || null,
    playlistMeta: buildAutoSplitPlaylistMeta(options),
    onProgress: (pct, info) => {
      if (typeof onProgress !== 'function') return;
      try { onProgress(Number(pct), info || {}); } catch {}
    }
  });
  if (splitUpload && typeof options.onSplitUpload === 'function') {
    try { options.onSplitUpload(splitUpload); } catch {}
  }
  if (splitUpload) applySplitUploadMetadata(options.targetEpisodeEl, splitUpload);
  return splitUpload;
}

function assertUploadTargetUrl(uploadUrl) {
  if (!isUsableUploadUrl(uploadUrl)) {
    throw new Error('Upload target URL is invalid or missing.');
  }
}

async function uploadCatboxRequest(uploadFile, settings, uploadUrl, options) {
  const api = getUploadServerApi();
  const requestUrl = sanitizeUploadUrl(uploadUrl, '');
  assertUploadTargetUrl(requestUrl);
  const form = new FormData();
  form.append('reqtype', 'fileupload');
  form.append('fileToUpload', uploadFile);

  let isAnon = (typeof settings.anonymous === 'boolean') ? settings.anonymous : true;
  try {
    const ctx = options.context;
    if (isAnon && ctx === 'batch' && typeof settings.anonymousBatch === 'boolean') isAnon = !!settings.anonymousBatch;
    if (isAnon && ctx === 'manual' && typeof settings.anonymousManual === 'boolean') isAnon = !!settings.anonymousManual;
  } catch {}
  const effectiveUserhash = resolveEffectiveCatboxUserhash(settings);
  if (!isAnon) {
    form.append('userhash', effectiveUserhash);
  }

  const fileSizeBytes = uploadFile && typeof uploadFile.size === 'number' ? uploadFile.size : undefined;
  assertUploadSizeLimit(requestUrl, fileSizeBytes);

  const res = await fetch(requestUrl, {
    method: 'POST',
    body: form
  });
  if (!res.ok) throw new Error(`Upload error (${res.status})`);
  const text = await res.text();
  const uploadedUrl = extractUploadResponseUrl(text);
  if (typeof window !== 'undefined') {
    window.MM_ACTIVE_CATBOX_UPLOAD_URL = requestUrl;
  }
  if (api && typeof api.markResult === 'function') {
    api.markResult({ endpoint: requestUrl, ok: true });
  }
  return uploadedUrl;
}

function uploadCatboxRequestWithProgress(uploadFile, settings, uploadUrl, options, onProgress) {
  const api = getUploadServerApi();
  const signal = options.signal;
  return new Promise((resolve, reject) => {
    const requestUrl = sanitizeUploadUrl(uploadUrl, '');
    try {
      assertUploadTargetUrl(requestUrl);
    } catch (err) {
      reject(err);
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open('POST', requestUrl);
    const form = new FormData();
    form.append('reqtype', 'fileupload');
    form.append('fileToUpload', uploadFile);

    let isAnon = (typeof settings.anonymous === 'boolean') ? settings.anonymous : true;
    try {
      const ctx = options.context;
      if (isAnon && ctx === 'batch' && typeof settings.anonymousBatch === 'boolean') isAnon = !!settings.anonymousBatch;
      if (isAnon && ctx === 'manual' && typeof settings.anonymousManual === 'boolean') isAnon = !!settings.anonymousManual;
    } catch {}
    const effectiveUserhash = resolveEffectiveCatboxUserhash(settings);
    if (!isAnon) {
      form.append('userhash', effectiveUserhash);
    }

    const fileSizeBytes = uploadFile && typeof uploadFile.size === 'number' ? uploadFile.size : undefined;
    assertUploadSizeLimit(requestUrl, fileSizeBytes);

    const createAbortError = () => {
      if (typeof DOMException === 'function') return new DOMException('Upload aborted', 'AbortError');
      const err = new Error('Upload aborted');
      err.name = 'AbortError';
      return err;
    };

    let settled = false;
    const cleanup = () => {
      if (signal && typeof signal.removeEventListener === 'function') {
        try { signal.removeEventListener('abort', onAbort); } catch {}
      }
    };
    const finalizeResolve = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const finalizeReject = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onAbort = () => {
      try { xhr.abort(); } catch {}
      finalizeReject(createAbortError());
    };

    if (signal && typeof signal.addEventListener === 'function') {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    if (xhr.upload && typeof onProgress === 'function') {
      let lastMs = 0;
      let lastLoaded = 0;
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const percent = (e.loaded / e.total) * 100;
          const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
          const dt = lastMs ? Math.max(0.001, (now - lastMs) / 1000) : 0;
          const dBytes = lastMs ? Math.max(0, e.loaded - lastLoaded) : 0;
          const bps = (dt > 0) ? (dBytes / dt) : 0;
          lastMs = now;
          lastLoaded = e.loaded;
          onProgress(percent, { loadedBytes: e.loaded, totalBytes: e.total, bps, phase: 'upload' });
        }
      };
    }

    xhr.onreadystatechange = () => {
      if (xhr.readyState === 4) {
        const ok = xhr.status >= 200 && xhr.status < 300;
        if (ok) {
          const text = (xhr.responseText || '').trim();
          const uploadedUrl = extractUploadResponseUrl(text);
          if (typeof window !== 'undefined') {
            window.MM_ACTIVE_CATBOX_UPLOAD_URL = requestUrl;
          }
          if (api && typeof api.markResult === 'function') {
            api.markResult({ endpoint: requestUrl, ok: true });
          }
          finalizeResolve(uploadedUrl);
        } else {
          finalizeReject(new Error('Upload error: ' + xhr.status));
        }
      }
    };
    xhr.onerror = () => {
      finalizeReject(new Error('Network error'));
    };

    xhr.send(form);
  });
}

// opts: { context?: 'batch'|'manual' }
async function uploadToCatbox(file, opts) {
  const api = getUploadServerApi();
  const options = (opts && typeof opts === 'object') ? opts : {};
  const st = readUploadSettings();
  const settings = st && typeof st === 'object' ? st : {};
  const requestSettings = Object.assign({}, settings, { _resolvedUserhash: resolveEffectiveCatboxUserhash(settings) });
  const prepared = await maybeRemuxVideoForCatboxUpload(file, null, options, settings);
  const splitUpload = await maybeAutoSplitPreparedVideoForUpload(prepared && prepared.file ? prepared.file : file, null, options);
  if (splitUpload && splitUpload.url) return splitUpload.url;
  const uploadFile = withUploadFilename(prepared && prepared.file ? prepared.file : file, options);
  const fileSizeBytes = uploadFile && typeof uploadFile.size === 'number' ? uploadFile.size : undefined;
  await ensureUploadServerReady(settings, { fileSizeBytes, force: options.forceProxy === true });
  const target = resolveCatboxUploadTarget(settings, {
    fileSizeBytes,
    allowProxy: options.allowProxy !== false,
    forceProxy: options.forceProxy === true
  });
  updateCatboxRuntime(target);
  if (target.kind !== 'copyparty') {
    assertUploadTargetUrl(target.url);
  }

  if (target.kind === 'copyparty') {
    const cpUrl = settings && typeof settings.copypartyUploadUrl === 'string' ? settings.copypartyUploadUrl.trim() : '';
    const cpPw = settings && typeof settings.copypartyPw === 'string' ? settings.copypartyPw : '';
    if (!cpUrl) throw new Error('Copyparty upload URL missing in settings');
    if (typeof window.mm_up2k_uploadFile !== 'function') throw new Error('Copyparty up2k client not loaded');
    const subdir = getCopypartySubdir(options);
    const url = await window.mm_up2k_uploadFile({ uploadUrl: cpUrl, pw: cpPw, file: uploadFile, subdir });
    if (api && typeof api.markResult === 'function') {
      api.markResult({ endpoint: cpUrl, ok: true, active: cpUrl, kind: 'copyparty' });
    }
    return String(url);
  }
  try {
    return await uploadCatboxRequest(uploadFile, requestSettings, target.url, options);
  } catch (err) {
    if (api && typeof api.markResult === 'function') {
      api.markResult({ endpoint: target.url, ok: false, error: String(err && err.message ? err.message : err) });
    }
    if (target.kind === 'auto' && target.fallbackUrl && target.fallbackUrl !== target.url) {
      const fallbackTarget = { kind: 'proxy', url: target.fallbackUrl, fallbackUrl: '' };
      updateCatboxRuntime(fallbackTarget);
      return await uploadCatboxRequest(uploadFile, requestSettings, fallbackTarget.url, options);
    }
    throw err;
  }
}

// opts: { context?: 'batch'|'manual' }
async function uploadToCatboxWithProgressPrepared(file, onProgress, opts) {
  const api = getUploadServerApi();
  const options = (opts && typeof opts === 'object') ? opts : {};
  const uploadFile = withUploadFilename(file, options);
  const st = readUploadSettings();
  const settings = st && typeof st === 'object' ? st : { anonymous: true, useRandomCatboxUserhash: false };
  const requestSettings = Object.assign({}, settings, { _resolvedUserhash: resolveEffectiveCatboxUserhash(settings) });
  const fileSizeBytes = uploadFile && typeof uploadFile.size === 'number' ? uploadFile.size : undefined;
  await ensureUploadServerReady(settings, { fileSizeBytes, force: options.forceProxy === true });
  const target = resolveCatboxUploadTarget(settings, {
    fileSizeBytes,
    allowProxy: options.allowProxy !== false,
    forceProxy: options.forceProxy === true
  });
  updateCatboxRuntime(target);
  if (target.kind !== 'copyparty') {
    assertUploadTargetUrl(target.url);
  }

  return new Promise((resolve, reject) => {
    if (target.kind === 'copyparty') {
      const cpUrl = settings && typeof settings.copypartyUploadUrl === 'string' ? settings.copypartyUploadUrl.trim() : '';
      const cpPw = settings && typeof settings.copypartyPw === 'string' ? settings.copypartyPw : '';
      if (!cpUrl) {
        reject(new Error('Copyparty upload URL missing in settings'));
        return;
      }
      if (typeof window.mm_up2k_uploadFile !== 'function') {
        reject(new Error('Copyparty up2k client not loaded'));
        return;
      }

      if (typeof onProgress === 'function') {
        try { onProgress(0, { loadedBytes: 0, totalBytes: fileSizeBytes || 0, bps: 0 }); } catch {}
      }

      const subdir = getCopypartySubdir(options);
      window.mm_up2k_uploadFile({
        uploadUrl: cpUrl,
        pw: cpPw,
        file: uploadFile,
        subdir,
        signal: options.signal,
        onProgress: (percent, info) => {
          if (typeof onProgress !== 'function') return;
          try { onProgress(percent, info); } catch {}
        }
      }).then((url) => {
        if (api && typeof api.markResult === 'function') {
          api.markResult({ endpoint: cpUrl, ok: true, active: cpUrl, kind: 'copyparty' });
        }
        resolve(String(url));
      }).catch(reject);

      return;
    }
    uploadCatboxRequestWithProgress(uploadFile, requestSettings, target.url, options, onProgress)
      .then(resolve)
      .catch(async (err) => {
        if (api && typeof api.markResult === 'function') {
          api.markResult({ endpoint: target.url, ok: false, error: String(err && err.message ? err.message : err) });
        }
        if (target.kind === 'auto' && target.fallbackUrl && target.fallbackUrl !== target.url) {
          try {
            const fallbackTarget = { kind: 'proxy', url: target.fallbackUrl, fallbackUrl: '' };
            updateCatboxRuntime(fallbackTarget);
            const result = await uploadCatboxRequestWithProgress(uploadFile, requestSettings, fallbackTarget.url, options, onProgress);
            resolve(result);
            return;
          } catch (fallbackErr) {
            reject(fallbackErr);
            return;
          }
        }
        reject(err);
      });
  });
}
function uploadToCatboxWithProgress(file, onProgress, opts) {
  const options = (opts && typeof opts === 'object') ? opts : {};
  const st = readUploadSettings();
  const settings = st && typeof st === 'object' ? st : { anonymous: true, useRandomCatboxUserhash: false };
  return (async () => {
    const prepared = await maybeRemuxVideoForCatboxUpload(file, onProgress, options, settings);
    const splitUpload = await maybeAutoSplitPreparedVideoForUpload(prepared && prepared.file ? prepared.file : file, onProgress, options);
    if (splitUpload && splitUpload.url) return splitUpload.url;
    const nextOptions = Object.assign({}, options, { remuxVideo: false });
    return uploadToCatboxWithProgressPrepared(prepared && prepared.file ? prepared.file : file, onProgress, nextOptions);
  })();
}

// Archive.org IAS3 upload logic -- yes, I know im exposing keys client-side, but it's 1am in the morning and im not spending more time on this.
// plz dont upload anything illegal to these keys
// yes, you
// seriously
// 🙏🙏🙏
// ps normalize using emojis in code, very cool.
const ARCHIVE_ORG_ACCESS_KEY = "1hZkfAqBbnVIXS6Y";
const ARCHIVE_ORG_SECRET_KEY = "hoXj3StnmOSSj2rn";

function mmConfirmArchiveInstead(message, options = {}) {
  const escapeHtml = (value) => {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  const title = (options && typeof options.title === 'string' && options.title.trim())
    ? options.title.trim()
    : 'Archive.org Upload';
  const yesLabel = (options && typeof options.yesLabel === 'string' && options.yesLabel.trim())
    ? options.yesLabel.trim()
    : 'Yes, upload to Archive.org';
  const noLabel = (options && typeof options.noLabel === 'string' && options.noLabel.trim())
    ? options.noLabel.trim()
    : 'No';

  let mainMessage = String(message || '');
  let subtitle = (options && typeof options.subtitle === 'string') ? options.subtitle : null;
  if (!subtitle) {
    const idx = mainMessage.indexOf(' Please note');
    if (idx > 0) {
      subtitle = mainMessage.slice(idx + 1).trim();
      mainMessage = mainMessage.slice(0, idx).trim();
    }
  }

  return new Promise((resolve) => {
    let resolved = false;
    const finalize = (value) => {
      if (resolved) return;
      resolved = true;
      resolve(!!value);
    };

    if (typeof window === 'undefined') {
      finalize(false);
      return;
    }

    try {
      const st = readUploadSettings();
      const autoAccept = st && typeof st.autoArchiveOversize === 'boolean' ? st.autoArchiveOversize : false;
      if (autoAccept) {
        finalize(true);
        return;
      }
    } catch {}

    if (typeof window.showStorageNotice !== 'function') {
      try {
        const combined = subtitle ? `${mainMessage}\n\n${subtitle}` : mainMessage;
        finalize(!!window.confirm(String(combined || 'Upload to Archive.org instead?')));
      } catch {
        finalize(false);
      }
      return;
    }

    try {
      const combinedHtml = subtitle
        ? `${escapeHtml(mainMessage)}<div style="margin-top:.35em; font-size:0.92em; opacity:0.9;">${escapeHtml(subtitle)}</div>`
        : null;
      window.showStorageNotice({
        title,
        message: combinedHtml ? '' : String(mainMessage || ''),
        messageHtml: combinedHtml,
        tone: 'warning',
        autoCloseMs: null,
        persistent: true,
        actions: [
          {
            label: yesLabel,
            onClick: () => finalize(true),
            closeOnClick: true
          }
        ],
        dismissLabel: noLabel,
        onClose: () => finalize(false)
      });
    } catch {
      try {
        const combined = subtitle ? `${mainMessage}\n\n${subtitle}` : mainMessage;
        finalize(!!window.confirm(String(combined || 'Upload to Archive.org instead?')));
      } catch {
        finalize(false);
      }
    }
  });
}

function generateArchiveIdentifier() {
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  return `upload-${ts}-${rand}`;
}

function generateArchiveTitle() {
  const rand = Math.random().toString(16).slice(2, 6).toUpperCase();
  return `RSPMM Upload ${rand}`;
}

function uploadToArchiveOrgWithProgress(file, onProgress, opts) {
  const options = (opts && typeof opts === 'object') ? opts : {};
  const signal = options.signal;

  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('Missing file'));
      return;
    }

    const identifier = generateArchiveIdentifier();
    const fileName = (file && file.name) ? String(file.name) : 'upload.bin';

    const headers = {
      "Authorization": `LOW ${ARCHIVE_ORG_ACCESS_KEY}:${ARCHIVE_ORG_SECRET_KEY}`,
      "Content-Type": "application/octet-stream",
      "x-archive-auto-make-bucket": "1",
      "x-archive-meta-title": generateArchiveTitle(),
      "x-archive-meta01-collection": "opensource",
    };

    const putUrl = `https://s3.us.archive.org/${encodeURIComponent(identifier)}/${encodeURIComponent(fileName)}`;

    const xhr = new XMLHttpRequest();
    xhr.open('PUT', putUrl, true);
    for (const [k, v] of Object.entries(headers)) {
      try { xhr.setRequestHeader(k, v); } catch {}
    }

    const createAbortError = () => {
      if (typeof DOMException === 'function') return new DOMException('Upload aborted', 'AbortError');
      const err = new Error('Upload aborted');
      err.name = 'AbortError';
      return err;
    };

    let settled = false;
    const cleanup = () => {
      if (signal && typeof signal.removeEventListener === 'function') {
        try { signal.removeEventListener('abort', onAbort); } catch {}
      }
    };
    const finalizeResolve = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const finalizeReject = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const onAbort = () => {
      try { xhr.abort(); } catch {}
      finalizeReject(createAbortError());
    };

    if (signal && typeof signal.addEventListener === 'function') {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    if (xhr.upload && typeof onProgress === 'function') {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const percent = (e.loaded / e.total) * 100;
          onProgress(percent);
        }
      };
    }

    xhr.onload = () => {
      const ok = xhr.status >= 200 && xhr.status < 300;
      if (!ok) {
        finalizeReject(new Error(`Archive.org upload failed (HTTP ${xhr.status}): ${xhr.responseText || ''}`.trim()));
        return;
      }
      finalizeResolve({
        identifier,
        detailsUrl: `https://archive.org/details/${encodeURIComponent(identifier)}`,
        downloadUrl: `https://archive.org/download/${encodeURIComponent(identifier)}/${encodeURIComponent(fileName)}`,
        putUrl,
      });
    };

    xhr.onerror = () => finalizeReject(new Error('Network error'));
    xhr.send(file);
  });
}

if (typeof window !== 'undefined') {
  window.mmConfirmArchiveInstead = mmConfirmArchiveInstead;
  window.uploadToArchiveOrgWithProgress = uploadToArchiveOrgWithProgress;
}
