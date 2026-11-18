// Which web origins may call this server from a browser (CORS). The phone app can be installed from another address
// (GitHub Pages, or another of your machines) and then calls this server over Tailscale; browsers only allow that for
// origins the server names. Allowed:
//   - machines on the SAME tailnet as this server: an https://<machine>.<tailnet>.ts.net origin whose tailnet matches the
//     address the request arrived on (allowing any *.ts.net would also let in strangers' Tailscale Funnel pages),
//   - the origins listed in ATLAS_APP_ORIGINS (comma-separated, e.g. https://you.github.io),
//   - localhost, for development.
export const appOrigins = (env = process.env) => (env.ATLAS_APP_ORIGINS || '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean)

const tailnetOf = (host) => String(host || '').split(':')[0].toLowerCase().match(/^[a-z0-9-]+\.([a-z0-9-]+\.ts\.net)$/)?.[1] ?? null

export function originAllowed(origin, host, allowed = appOrigins()) {
  if (!origin) return false
  if (allowed.includes(origin)) return true
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true
  let o; try { o = new URL(origin) } catch { return false }
  const mine = tailnetOf(host)
  return o.protocol === 'https:' && mine != null && tailnetOf(o.host) === mine
}

// Which Host names the API answers to. The server only listens on 127.0.0.1, but a web page can point its own domain at
// 127.0.0.1 ("DNS rebinding") and then talk to it as if it were that page's own server. Its requests still carry the
// page's own domain in the Host header, so answering only to these names closes that door:
//   localhost / 127.0.0.1 / [::1], any *.ts.net name (your machine through `tailscale serve`; nobody else can point
//   a ts.net name at your computer), and the names in ATLAS_ALLOWED_HOSTS (comma-separated).
export const allowedHosts = (env = process.env) => (env.ATLAS_ALLOWED_HOSTS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
export function hostAllowed(host, extra = allowedHosts()) {
  const h = String(host || '').toLowerCase().replace(/:\d+$/, '').replace(/^\[|\]$/g, '')
  if (!h) return false
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || /^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$/.test(h) || extra.includes(h)
}

/** A request from a page on the same address as the server (the app talking to the server that served it). */
export function sameOrigin(origin, host) {
  try { return new URL(origin).host.toLowerCase() === String(host || '').toLowerCase() } catch { return false }
}
