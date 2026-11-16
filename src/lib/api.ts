// Where the app gets its data, in order of preference:
//   1. the Venture Atlas server that served this page (running `npm run dev` / `npm start` on this machine, or reached
//      through `tailscale serve`),
//   2. one of your own servers saved in Settings (laptop, Raspberry Pi…), reached over Tailscale,
//   3. the copy of the data this device saved the last time it reached a server,
//   4. the snapshot built into the app.
// Only 1 and 2 are "live": research, the review queue, fields and notes need a server.

export type Server = { base: string; name: string }
export type Source = { kind: 'live'; server: Server } | { kind: 'saved'; at: string } | { kind: 'snapshot'; at: string }
export type AtlasData = { taxonomy: unknown; companies: unknown[]; events: unknown[]; meta: Record<string, unknown> }

const SERVERS_KEY = 'atlas-servers'
const DATA_CACHE = 'atlas-data-v1', DATA_KEY = 'atlas-last-data'

let base = '' // '' = same origin as the page

export const apiUrl = (p: string) => base + p

export async function api(url: string, init?: RequestInit) {
  const r = await fetch(apiUrl(url), init && { ...init, headers: { 'Content-Type': 'application/json' } })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || `${r.status} ${r.statusText}`)
  return j
}

// ---- saved servers ----
export function getServers(): string[] {
  try { const v = JSON.parse(localStorage.getItem(SERVERS_KEY) || '[]'); return Array.isArray(v) ? v.filter((s) => typeof s === 'string') : [] } catch { return [] }
}
export function setServers(list: string[]) {
  try { localStorage.setItem(SERVERS_KEY, JSON.stringify([...new Set(list)])) } catch { /* private mode: kept for this session only */ }
}
/** Turns what the user typed ("rpi", "rpi.tail1234.ts.net", "https://rpi.tail1234.ts.net/") into an origin. Throws if it is not an address. */
export function normalizeServer(input: string): string {
  let s = input.trim()
  if (!s) throw new Error('Enter an address')
  if (!/^[a-z]+:\/\//i.test(s)) s = 'https://' + s
  const u = new URL(s)
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Use an https:// address')
  return u.origin
}
/** A page served over https may not call plain http addresses (the browser blocks it), except localhost. */
export const blockedAsMixed = (origin: string) => location.protocol === 'https:' && origin.startsWith('http:') && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)

// ---- finding a server ----
export async function probe(b: string, ms = 3500): Promise<Server | null> {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), ms)
  try {
    const r = await fetch(b + '/api/health', { signal: ctl.signal, cache: 'no-store' })
    if (!r.ok) return null
    const j = await r.json()
    if (j?.app !== 'venture-atlas') return null
    // Label it by its Tailscale machine name when there is one (the OS hostname is often just "Mac" or "raspberrypi").
    const host = new URL(b || location.href).hostname
    return { base: b, name: host.endsWith('.ts.net') ? host.split('.')[0] : b ? host : String(j.name || host) }
  } catch { return null } finally { clearTimeout(timer) }
}

/** Tries the page's own origin and every saved server at once; the first one in that order that answers wins. */
export async function connect(): Promise<Server | null> {
  const candidates = ['', ...getServers().filter((s) => s !== location.origin)]
  const results = await Promise.all(candidates.map((c) => probe(c)))
  const hit = results.find((r): r is Server => r != null) ?? null
  base = hit ? hit.base : ''
  return hit
}

// ---- offline copies ----
// The Cache API (not localStorage) because the data is a few MB, more than localStorage reliably holds.
export async function saveCopy(d: AtlasData) {
  try {
    const c = await caches.open(DATA_CACHE)
    await c.put(DATA_KEY, new Response(JSON.stringify({ at: new Date().toISOString(), data: d }), { headers: { 'Content-Type': 'application/json' } }))
  } catch { /* no Cache API (plain http on another machine): nothing saved */ }
}
export async function loadCopy(): Promise<{ at: string; data: AtlasData } | null> {
  try { const r = await (await caches.open(DATA_CACHE)).match(DATA_KEY); return r ? await r.json() : null } catch { return null }
}
export async function loadSnapshot(): Promise<{ at: string; data: AtlasData } | null> {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}snapshot.json`)
    if (!r.ok) return null
    const s = await r.json()
    return { at: s.builtAt, data: { taxonomy: s.taxonomy, companies: s.companies, events: s.events, meta: s.meta ?? {} } }
  } catch { return null }
}
