export async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok && res.status !== 0) throw new Error(`${res.status} ${res.statusText}`)
  return await res.json()
}

export function normalizeSourceParam(raw) {
  const v = (raw ?? '').toString().trim()
  if (!v) return ''
  // already a URL or path
  if (/^https?:\/\//i.test(v) || v.startsWith('./') || v.startsWith('/') || v.toLowerCase().endsWith('.json')) return v
  // treat as relative under Sources/Files
  return `./Sources/Files/${v}.json`
}
