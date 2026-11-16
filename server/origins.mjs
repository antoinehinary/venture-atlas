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
