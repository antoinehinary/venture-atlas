// Web access owned by this server, so every AI provider gets the same two tools:
//   webSearch(query)  -> [{ title, url, snippet }]
//   fetchPage(url)    -> { ok, url, title, text } with the readable text of the page
// The verification layer uses fetchPage directly, so "the page says X" is always checked against text we fetched ourselves.
import dns from 'node:dns/promises'
import net from 'node:net'
import http from 'node:http'
import https from 'node:https'
import zlib from 'node:zlib'

const UA = 'Mozilla/5.0 (compatible; VentureAtlas/1.0; +https://github.com/)'
const TIMEOUT = 20000

// Aggregators and profile pages are not accepted as evidence: they restate other people's numbers and often disagree.
export const BLOCKED_SOURCES = ['crunchbase.com', 'pitchbook.com', 'tracxn.com', 'cbinsights.com', 'dealroom.co', 'linkedin.com', 'zoominfo.com', 'growjo.com', 'owler.com', 'rocketreach.co', 'craft.co', 'golden.com', 'leadiq.com', 'apollo.io', 'wellfound.com', 'f6s.com', 'x.com', 'twitter.com', 'facebook.com', 'reddit.com', 'quora.com']
export const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, '') } catch { return null } }
export const isBlockedSource = (u) => { const h = hostOf(u); return !h || BLOCKED_SOURCES.some((b) => h === b || h.endsWith('.' + b)) }

/** Where a source sits in the evidence order: the company itself, an investor, the press, or Wikipedia. */
export function sourceTier(url, company) {
  const h = hostOf(url)
  if (!h) return 'unknown'
  if (h.endsWith('wikipedia.org')) return 'wikipedia'
  const own = company?.website && hostOf(company.website)
  if (own && (h === own || h.endsWith('.' + own) || own.endsWith('.' + h))) return 'company'
  if (/(prnewswire|businesswire|globenewswire|newswire|prweb|einpresswire|sec\.gov|europa\.eu|\.gov$|\.mil$|nasa\.gov|esa\.int)/.test(h)) return 'official'
  return 'press'
}

// Every reserved, private, loopback, link-local, carrier-grade NAT (incl. Tailscale 100.64/10), benchmark, multicast and
// future range. net.BlockList also matches IPv4-mapped IPv6 (::ffff:127.0.0.1 and its hex form ::ffff:7f00:1).
const BLOCK = new net.BlockList()
for (const [a, p] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]]) BLOCK.addSubnet(a, p, 'ipv4')
for (const [a, p] of [['::', 128], ['::1', 128], ['64:ff9b::', 96], ['100::', 64], ['2001::', 32], ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8]]) BLOCK.addSubnet(a, p, 'ipv6')
export function isPrivateIp(ip) {
  const v = net.isIP(ip)
  if (v === 4) return BLOCK.check(ip, 'ipv4')
  if (v === 6) {
    // An IPv4-mapped address is judged by the IPv4 it carries: public ones stay allowed, private ones are refused.
    const l = ip.toLowerCase(), m = l.match(/^(?:0{0,4}:){0,5}:?ffff:(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/)
    if (m) { const v4 = m[1] ?? [parseInt(m[2], 16) >> 8, parseInt(m[2], 16) & 255, parseInt(m[3], 16) >> 8, parseInt(m[3], 16) & 255].join('.'); return BLOCK.check(v4, 'ipv4') }
    return BLOCK.check(ip, 'ipv6')
  }
  return true
}
/** The model chooses which URLs to open, so refuse anything that is not a public http(s) address. */
export async function assertPublicUrl(raw) {
  let u
  try { u = new URL(raw) } catch { throw new Error('not a valid URL') }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('only http and https URLs can be opened')
  if (u.username || u.password) throw new Error('URLs with credentials cannot be opened')
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.ts.net') || host.endsWith('.home.arpa')) throw new Error('local addresses cannot be opened')
  const ips = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((a) => a.address)
  if (!ips.length || ips.some(isPrivateIp)) throw new Error('local or private addresses cannot be opened')
  return u
}

// The address is checked again at the moment of connecting, on the exact IP the socket uses. Without this, a hostname
// could resolve to a public IP for the check above and to a private one for the download (DNS rebinding).
function pinnedLookup(hostname, options, cb) {
  dns.lookup(hostname, { all: true }).then((addrs) => {
    const bad = addrs.find((a) => isPrivateIp(a.address))
    if (!addrs.length || bad) return cb(Object.assign(new Error('local or private addresses cannot be opened'), { code: 'EPRIVATE' }))
    if (options?.all) cb(null, addrs); else cb(null, addrs[0].address, addrs[0].family)
  }, (e) => cb(e))
}

const MAX_BYTES = 3_000_000
/** One HTTP(S) GET without following redirects. Reads at most MAX_BYTES of the body, then stops downloading. */
function getOnce(url, signal) {
  return new Promise((resolve, reject) => {
    const u = new URL(url), mod = u.protocol === 'https:' ? https : http
    const req = mod.request(u, { method: 'GET', lookup: pinnedLookup, signal, headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5', 'Accept-Language': 'en,*;q=0.5', 'Accept-Encoding': 'gzip, deflate, br' } }, (res) => {
      const status = res.statusCode ?? 0, headers = res.headers
      if (status >= 300 && status < 400) { res.resume(); return resolve({ status, headers, body: '' }) }
      const len = Number(headers['content-length'] || 0)
      if (len > MAX_BYTES * 4) { res.destroy(); return resolve({ status, headers, body: '', tooBig: true }) }
      const enc = String(headers['content-encoding'] || '').toLowerCase()
      const stream = enc === 'gzip' ? res.pipe(zlib.createGunzip()) : enc === 'br' ? res.pipe(zlib.createBrotliDecompress()) : enc === 'deflate' ? res.pipe(zlib.createInflate()) : res
      const chunks = []; let size = 0, done = false
      const finish = () => { if (done) return; done = true; resolve({ status, headers, body: Buffer.concat(chunks).toString('utf8') }) }
      stream.on('data', (c) => { if (done) return; chunks.push(c); size += c.length; if (size >= MAX_BYTES) { finish(); res.destroy(); stream.destroy?.() } })
      stream.on('end', finish); stream.on('error', (e) => (done ? null : (done = true, reject(e))))
    })
    req.on('error', reject)
    req.end()
  })
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', euro: '€', pound: '£', yen: '¥', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…' }
export function htmlToText(html) {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').replace(/\s+/g, ' ').trim()
  let s = html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style|noscript|svg|iframe|template|head)\b[\s\S]*?<\/\1>/gi, ' ')
  s = s.replace(/<\/(p|div|li|tr|h[1-6]|section|article|header|footer|br|td|th|blockquote)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ')
  s = s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m)
  s = s.replace(/[ \t ]+/g, ' ').replace(/ *\n\s*/g, '\n').trim()
  return { title: decodeBasic(title), text: s }
}
const decodeBasic = (s) => s.replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m)

const pageCache = new Map()
/** Fetches a public page and returns its readable text. Never throws: failures come back as { ok: false, error }. */
export async function fetchPage(url, { maxChars = 200000 } = {}) {
  if (pageCache.has(url)) return pageCache.get(url)
  let out
  try {
    let current = (await assertPublicUrl(url)).toString(), res
    const signal = AbortSignal.timeout(TIMEOUT)
    for (let hop = 0; hop < 6; hop++) {
      res = await getOnce(current, signal)
      if (res.status >= 300 && res.status < 400 && res.headers.location) { current = (await assertPublicUrl(new URL(res.headers.location, current).toString())).toString(); continue }
      break
    }
    if (res.tooBig) out = { ok: false, url, error: 'page is too large' }
    else if (res.status < 200 || res.status >= 300) out = { ok: false, url, error: `HTTP ${res.status}` }
    else {
      const type = String(res.headers['content-type'] || '')
      if (!/text\/|html|xml|json/.test(type)) out = { ok: false, url, error: `not a text page (${type || 'unknown type'})` }
      else {
        const body = res.body
        const { title, text } = /html|xml/.test(type) || /<html|<body/i.test(body.slice(0, 2000)) ? htmlToText(body) : { title: '', text: body }
        out = text.length < 200 ? { ok: false, url, error: 'page has no readable text (needs JavaScript or is blocked)' } : { ok: true, url: current, title, text: text.slice(0, maxChars) }
      }
    }
  } catch (e) { out = { ok: false, url, error: e.name === 'TimeoutError' || e.name === 'AbortError' ? 'timed out' : e.message } }
  if (pageCache.size > 300) pageCache.delete(pageCache.keys().next().value)
  pageCache.set(url, out)
  return out
}

/** Returns the parts of a long page that mention any of the terms, so the model reads the relevant passages rather than a truncated head. */
export function excerpt(text, terms, budget = 9000) {
  if (text.length <= budget) return text
  const lower = text.toLowerCase(), spans = []
  for (const t of terms.filter(Boolean).map((t) => String(t).toLowerCase()).filter((t) => t.length >= 2)) {
    let i = -1, n = 0
    while ((i = lower.indexOf(t, i + 1)) >= 0 && n++ < 12) spans.push([Math.max(0, i - 700), Math.min(text.length, i + 900)])
  }
  if (!spans.length) return text.slice(0, budget)
  spans.sort((a, b) => a[0] - b[0])
  const merged = []
  for (const s of spans) { const last = merged[merged.length - 1]; if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]); else merged.push([...s]) }
  let out = text.slice(0, 600), used = out.length
  for (const [a, b] of merged) { if (used >= budget) break; const part = text.slice(Math.max(a, 600), Math.min(b, a + budget - used)); if (part) { out += '\n[…]\n' + part; used += part.length } }
  return out
}

// ---- search ------------------------------------------------------------------------------------
export function searchBackend(env = process.env) {
  const pick = (env.ATLAS_SEARCH || '').toLowerCase()
  const has = { tavily: env.TAVILY_API_KEY, brave: env.BRAVE_API_KEY, serper: env.SERPER_API_KEY }
  if (pick && pick !== 'duckduckgo' && !has[pick]) throw new Error(`ATLAS_SEARCH=${pick} needs its API key in .env`)
  return pick || Object.keys(has).find((k) => has[k]) || 'duckduckgo'
}
const post = async (url, headers, body) => { const r = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(TIMEOUT), headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(`search failed: HTTP ${r.status}`); return r.json() }

export async function webSearch(query, { max = 8, env = process.env } = {}) {
  const backend = searchBackend(env)
  let results
  if (backend === 'tavily') results = ((await post('https://api.tavily.com/search', { Authorization: `Bearer ${env.TAVILY_API_KEY}` }, { query, max_results: max })).results || []).map((r) => ({ title: r.title, url: r.url, snippet: r.content }))
  else if (backend === 'serper') results = ((await post('https://google.serper.dev/search', { 'X-API-KEY': env.SERPER_API_KEY }, { q: query, num: max })).organic || []).map((r) => ({ title: r.title, url: r.link, snippet: r.snippet }))
  else if (backend === 'brave') {
    const r = await fetch(`https://api.search.brave.com/res/v1/web/search?count=${max}&q=${encodeURIComponent(query)}`, { signal: AbortSignal.timeout(TIMEOUT), headers: { Accept: 'application/json', 'X-Subscription-Token': env.BRAVE_API_KEY } })
    if (!r.ok) throw new Error(`search failed: HTTP ${r.status}`)
    results = ((await r.json()).web?.results || []).map((x) => ({ title: x.title, url: x.url, snippet: x.description }))
  } else {
    // Keyless fallback: DuckDuckGo's HTML page. Works without setup but is rate-limited; add a search key for heavy use.
    const r = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query), { signal: AbortSignal.timeout(TIMEOUT), headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36', Accept: 'text/html' } })
    if (!r.ok) throw new Error(`search failed: HTTP ${r.status} (DuckDuckGo rate limit? add TAVILY_API_KEY, BRAVE_API_KEY or SERPER_API_KEY to .env)`)
    const html = await r.text()
    results = [...html.matchAll(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?=<a[^>]+class="result__a"|$)/g)].map((m) => {
      let url = m[1].replace(/&amp;/g, '&'); const u = url.match(/[?&]uddg=([^&]+)/); if (u) url = decodeURIComponent(u[1]); if (url.startsWith('//')) url = 'https:' + url
      const snip = m[3].match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? ''
      return { title: htmlToText(m[2]).text, url, snippet: htmlToText(snip).text }
    }).filter((x) => /^https?:/.test(x.url) && !x.url.includes('duckduckgo.com/y.js'))
  }
  return results.filter((r) => r.url && !isBlockedSource(r.url)).slice(0, max)
}
