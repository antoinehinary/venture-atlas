import { useEffect, useState } from 'react'
import { Loader2, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import { useAtlas } from '../lib/store'
import { blockedAsMixed, getServers, normalizeServer, probe, setServers } from '../lib/api'
import { fmtDate } from '../lib/model'

const when = (iso: string) => { const d = new Date(iso); return isNaN(+d) ? iso : `${fmtDate(iso.slice(0, 10))}, ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` }

/** Small status dot in the top bar: which server the data comes from, or that it is offline. Opens the servers dialog. */
export function ConnectionPill() {
  const { source, connecting } = useAtlas()
  const [open, setOpen] = useState(false)
  const live = source?.kind === 'live'
  const demo = source?.kind === 'snapshot' && getServers().length === 0
  const label = connecting ? 'Connecting…' : live ? source.server.name : demo ? 'Demo' : 'Offline'
  return (<>
    <button className={`conn-pill ${live ? 'live' : demo ? 'demo' : 'off'}`} onClick={() => setOpen(true)} title={live ? `Live data from ${source.server.name}` : 'Not connected to any of your servers. Tap to set them up.'}>
      {connecting ? <Loader2 size={12} className="spin" /> : <i />}<span>{label}</span>
    </button>
    {open && <ServersDialog close={() => setOpen(false)} />}
  </>)
}

/** Shown under the top bar when the data on screen is not live. */
const REPO = 'https://github.com/antoinehinary/venture-atlas'

export function OfflineBanner() {
  const { source, reconnect, connecting } = useAtlas()
  const [open, setOpen] = useState(false)
  if (!source || source.kind === 'live') return null
  // Someone opening the public demo who has never connected to a server of their own: a welcome, not a warning.
  if (source.kind === 'snapshot' && getServers().length === 0) return (
    <div className="banner demo">
      <span><b>Demo</b> · Browse, replay and compare the built-in data ({fmtDate(source.at.slice(0, 10))}). To research the fields you care about, <a href={`${REPO}#run-your-own-atlas`} target="_blank" rel="noreferrer">run your own atlas</a>.</span>
      <span className="banner-actions"><a className="btn" href={REPO} target="_blank" rel="noreferrer">GitHub</a><button className="btn" onClick={() => setOpen(true)}>Connect a server</button></span>
      {open && <ServersDialog close={() => setOpen(false)} />}
    </div>
  )
  return (
    <div className="banner offline">
      <span>{source.kind === 'saved' ? <>Offline: showing the data saved on this device on {when(source.at)}.</> : <>Offline: showing the data built into the app ({fmtDate(source.at.slice(0, 10))}).</>} Research, the review queue and notes need one of your servers.</span>
      <span className="banner-actions">
        <button className="btn" onClick={reconnect} disabled={connecting}><RefreshCw size={13} className={connecting ? 'spin' : ''} /> Retry</button>
        <button className="btn" onClick={() => setOpen(true)}>Servers</button>
      </span>
      {open && <ServersDialog close={() => setOpen(false)} />}
    </div>
  )
}

type Status = 'checking' | 'up' | 'down' | 'mixed'

function ServersDialog({ close }: { close: () => void }) {
  const { source, reconnect } = useAtlas()
  const [list, setList] = useState(getServers)
  const [status, setStatus] = useState<Record<string, Status>>({})
  const [input, setInput] = useState(''), [err, setErr] = useState<string | null>(null), [busy, setBusy] = useState(false)

  const check = (urls: string[]) => {
    for (const u of urls) {
      if (blockedAsMixed(u)) { setStatus((s) => ({ ...s, [u]: 'mixed' })); continue }
      setStatus((s) => ({ ...s, [u]: 'checking' }))
      probe(u).then((r) => setStatus((s) => ({ ...s, [u]: r ? 'up' : 'down' })))
    }
  }
  useEffect(() => { check(getServers()) }, [])
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [close])

  const save = (next: string[]) => { setList(next); setServers(next) }
  const add = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null)
    let url: string
    try { url = normalizeServer(input) } catch (x) { setErr((x as Error).message === 'Enter an address' ? 'Enter an address' : 'That is not a valid address'); return }
    if (blockedAsMixed(url)) { setErr('This app is served over https, so the browser blocks plain http:// servers. Use the https://….ts.net address that `tailscale serve` prints.'); return }
    if (list.includes(url)) { setErr('Already in the list'); return }
    setBusy(true)
    const r = await probe(url)
    setBusy(false)
    save([...list, url]); setInput(''); setStatus((s) => ({ ...s, [url]: r ? 'up' : 'down' }))
    if (!r) setErr('Saved, but it did not answer right now. Is the server running, `tailscale serve` set up on it, and this device connected to Tailscale?')
    else if (source?.kind !== 'live') reconnect()
  }
  const remove = (u: string) => save(list.filter((x) => x !== u))
  const move = (i: number) => { if (i <= 0) return; const n = [...list]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; save(n) }

  return (<>
    <div className="scrim" onClick={close} />
    <form className="dialog servers" onSubmit={add} role="dialog" aria-label="Your servers">
      <header><h2>Your servers</h2><button type="button" className="btn icon" onClick={close} aria-label="Close"><X size={16} /></button></header>
      <p>
        {source?.kind === 'live' ? <>Connected to <b>{source.server.name}</b>{source.server.base ? <> at <code>{source.server.base}</code></> : ' (the server that opened this page)'}.</> : <>Not connected. The app is showing {source?.kind === 'saved' ? 'the data this device saved last time' : 'the data built into it'}.</>}
        {' '}On opening, the app tries these in order and uses the first that answers.
      </p>
      {list.length > 0 ? (
        <ul className="server-list">
          {list.map((u, i) => (
            <li key={u}>
              <i className={`dot ${status[u] ?? 'checking'}`} title={{ checking: 'Checking…', up: 'Answering', down: 'Not answering', mixed: 'Blocked: http address on an https page' }[status[u] ?? 'checking']} />
              <code>{u}</code>
              {i > 0 && <button type="button" className="btn ghost small-btn" onClick={() => move(i)} title="Try this one earlier">↑</button>}
              <button type="button" className="btn ghost icon" onClick={() => remove(u)} aria-label={`Remove ${u}`}><Trash2 size={14} /></button>
            </li>
          ))}
        </ul>
      ) : <p className="dim small">No servers saved yet.</p>}
      <label>Add a server
        <span className="add-row">
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="https://my-laptop.tail1234.ts.net" autoCapitalize="off" autoCorrect="off" spellCheck={false} inputMode="url" />
          <button className="btn primary" disabled={busy || !input.trim()}>{busy ? <Loader2 size={13} className="spin" /> : <Plus size={13} />} Add</button>
        </span>
      </label>
      {err && <div className="banner error">{err}</div>}
      <details className="dim small">
        <summary>How do I get this address?</summary>
        <ol>
          <li>On the laptop or Raspberry Pi, start the atlas: <code>npm run build</code> then <code>npm start</code>.</li>
          <li>On the same machine run <code>tailscale serve --bg 5173</code>. It prints an address like <code>https://my-laptop.tail1234.ts.net</code>. Paste that here.</li>
          <li>Keep Tailscale switched on on this phone. Details in the README, “Phone app”.</li>
        </ol>
      </details>
      <footer>
        <button type="button" className="btn" onClick={() => { check(list); reconnect() }}><RefreshCw size={13} /> Check again</button>
        <button type="button" className="btn primary" onClick={close}>Done</button>
      </footer>
    </form>
  </>)
}
