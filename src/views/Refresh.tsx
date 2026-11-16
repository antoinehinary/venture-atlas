import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, ExternalLink, Loader2, Plus, RefreshCw, X } from 'lucide-react'
import { useAtlas, type QueueItem } from '../lib/store'
import { ROUND_LABEL, countryName, fmtDate, fmtMoney } from '../lib/model'
import { Chk } from './Dossier'

/** The two per-domain controls: "Fetch latest" and "Add a company". */
export function RefreshControls({ domainId, domainName, lastRefresh, compact }: { domainId: string; domainName: string; lastRefresh?: string; compact?: boolean }) {
  const { startJob, job, meta } = useAtlas()
  const [adding, setAdding] = useState(false), [q, setQ] = useState('')
  const busy = job?.state === 'running'
  const off = !meta.ai.available, why = `AI is not set up: ${meta.ai.problem}. See README, “Connect an AI provider”.`
  const submit = (e: React.FormEvent) => { e.preventDefault(); if (!q.trim()) return; startJob({ type: 'add', domain: domainId, query: q.trim() }, `Researching "${q.trim()}"`); setQ(''); setAdding(false) }
  return (
    <div className={`refresh ${compact ? 'compact' : ''}`}>
      <button className="btn" disabled={busy || off} title={off ? why : `Research what is new since ${lastRefresh ?? 'the last check'}, then verify every figure against its source`} onClick={() => startJob({ type: 'refresh', domain: domainId }, `Fetching latest: ${domainName}`)}>
        <RefreshCw size={13} /> Fetch latest
      </button>
      <button className="btn" disabled={busy || off} onClick={() => setAdding((v) => !v)} title={off ? why : 'Paste a company name or URL: it is researched, verified, then queued for your review'}><Plus size={13} /> Add a company</button>
      {!compact && <span className="refresh-when">{lastRefresh ? `Last fetched ${fmtDate(lastRefresh)}` : 'Never fetched'}</span>}
      {adding && (
        <form className="add-pop" onSubmit={submit}>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Company name or URL (LinkedIn links work: the name is used)" aria-label="Company name or URL" />
          <button className="btn primary" type="submit" disabled={!q.trim()}>Research</button>
          <button className="btn ghost" type="button" onClick={() => setAdding(false)} aria-label="Cancel"><X size={14} /></button>
        </form>
      )}
    </div>
  )
}

/** Bottom-right dock streaming the progress of the running research job. */
export function JobDock() {
  const { job, dismissJob, cancelJob } = useAtlas()
  const [open, setOpen] = useState(true)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [job?.log.length, open])
  useEffect(() => { if (job) setOpen(true) }, [job?.id])
  if (!job) return null
  const last = job.log[job.log.length - 1]
  return (
    <aside className={`job-dock ${job.state}`} aria-live="polite">
      <header onClick={() => setOpen((o) => !o)}>
        {job.state === 'running' ? <Loader2 size={14} className="spin" /> : job.state === 'done' ? <Check size={14} /> : <X size={14} />}
        <b>{job.title}</b>
        <span className="job-state">{job.state === 'running' ? `${job.log.length} steps` : job.state}</span>
        <ChevronDown size={14} style={{ transform: open ? 'none' : 'rotate(180deg)' }} />
      </header>
      {open ? (
        <div className="job-log">
          {job.log.map((l, i) => <p key={i} className={l.level}>{l.text}</p>)}
          {job.state === 'running' && <p className="info dim">Working… this usually takes a few minutes.</p>}
          <div ref={end} />
        </div>
      ) : last && <p className="job-last">{last.text}</p>}
      <footer>
        {job.state === 'running' ? <button className="btn ghost" onClick={cancelJob}>Cancel run</button> : (
          <>{job.merged > 0 && <span className="job-merged">{job.merged} added to the atlas</span>}{job.queued > 0 && <a className="btn primary" href="#/queue" onClick={dismissJob}>Review {job.queued} record{job.queued > 1 ? 's' : ''}</a>}<button className="btn ghost" onClick={dismissJob}>Dismiss</button></>
        )}
      </footer>
    </aside>
  )
}

const VERDICT: Record<string, string> = { confirmed: '✓ confirmed', corrected: '✓ corrected', unsupported: '✕ removed', unreachable: '? not confirmed' }

function QueueCard({ item }: { item: QueueItem }) {
  const { resolve, tax, meta } = useAtlas()
  const [raw, setRaw] = useState(false), [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null)
  const c = item.record
  const act = async (a: 'approve' | 'reject' | 'verify') => { setBusy(true); const e = await resolve(item.id, a); setErr(e); setBusy(false) }
  const subName = (id: string) => tax.domains.flatMap((d) => d.subsectors).find((s) => s.id === id)?.name ?? id
  return (
    <article className="queue-card">
      <header>
        <span className={`tag ${item.kind}`}>{item.kind === 'new' ? 'New company' : 'Update'}</span>
        <h3>{c.name}</h3>
        <span className={`conf ${c.confidence}`}>{c.confidence} confidence</span>
        <div className="queue-actions">
          <button className="btn primary" disabled={busy || item.problems.length > 0} onClick={() => act('approve')} title={item.problems.length ? 'Fix the schema problems in the record first' : 'Merge into the data files'}><Check size={14} /> Approve</button>
          <button className="btn" disabled={busy} onClick={() => act('reject')}><X size={14} /> Reject</button>
        </div>
      </header>
      <p className="queue-pitch">{c.pitch}</p>
      <p className="dim">{c.hq.city ?? 'City unknown'}, {countryName(c.hq.country)} · founded {fmtDate(c.founded.date)} · {c.subsectors.map(subName).join(', ')} · status {c.status}</p>
      {item.kind === 'update' && <ul className="diff">{item.diff.map((d, i) => <li key={i}>{d}</li>)}</ul>}
      {c.rounds.length > 0 && (
        <table className="tbl"><thead><tr><th>Date</th><th>Round</th><th className="num">Amount</th><th>Lead</th><th>Check</th><th>Source</th></tr></thead>
          <tbody>{c.rounds.map((r, i) => <tr key={i}><td>{fmtDate(r.date)}</td><td>{r.label || ROUND_LABEL[r.type] || r.type}</td><td className="num">{fmtMoney(r.amount)}</td><td>{r.leads.join(', ') || <span className="unknown">unknown</span>}</td><td><Chk v={r.check} src={r.source} /></td><td><a href={r.source} target="_blank" rel="noreferrer">{new URL(r.source).hostname.replace('www.', '')} <ExternalLink size={11} /></a></td></tr>)}</tbody></table>
      )}
      {item.verification ? (
        <details className="verif" open={item.verification.summary.removed + item.verification.summary.unconfirmed > 0}>
          <summary><b>Source check:</b> {item.verification.summary.confirmed + item.verification.summary.corrected} of {item.verification.summary.checked} facts confirmed on their source page{item.verification.summary.corrected > 0 && `, ${item.verification.summary.corrected} rewritten from the page`}{item.verification.summary.removed > 0 && `, ${item.verification.summary.removed} removed as unsupported`}{item.verification.summary.unconfirmed > 0 && `, ${item.verification.summary.unconfirmed} could not be confirmed`}</summary>
          <ul>{item.verification.results.map((r, i) => <li key={i} className={r.verdict}><span className="v">{VERDICT[r.verdict]}</span> {r.claim} <span className="dim">— {r.reason}{r.tier ? ` · ${r.tier} source` : ''}</span>{r.quote && (r.verdict === 'confirmed' || r.verdict === 'corrected') && <q>{r.quote}</q>}</li>)}</ul>
        </details>
      ) : <p className="dim small">This record was queued without a source check. <button className="link" disabled={busy || !meta.ai.available} onClick={() => act('verify')}>{busy ? 'Checking sources…' : 'Check its sources now'}</button></p>}
      {item.problems.length > 0 && <div className="banner error"><b>Does not pass the schema, so it cannot be approved:</b><ul>{item.problems.map((p, i) => <li key={i}>{p}</li>)}</ul></div>}
      {item.notes && <p className="dim"><b>Researcher notes:</b> {item.notes}</p>}
      {err && <div className="banner error">{err}</div>}
      <button className="link" onClick={() => setRaw((r) => !r)}>{raw ? 'Hide' : 'Show'} full record (JSON)</button>
      {raw && <pre className="raw">{JSON.stringify(c, null, 2)}</pre>}
    </article>
  )
}

export function QueuePage() {
  const { queue, tax, meta } = useAtlas()
  return (
    <main className="page narrow">
      <div className="page-head"><div><p className="eyebrow">Nothing is merged without your approval</p><h1>Review queue</h1></div></div>
      {meta.ai.available
        ? <p className="dim small ai-line">Research and verification run on {meta.ai.provider}{meta.ai.model ? ` (${meta.ai.model})` : ''}, web search via {meta.ai.search}.</p>
        : <div className="banner">“Fetch latest” and “Add a company” are off: {meta.ai.problem}. Copy <code>.env.example</code> to <code>.env</code>, add one API key and restart.</div>}
      {queue.length === 0 ? (
        <div className="empty">
          <p>The queue is empty. Records found by “Fetch latest” or “Add a company” are checked against their sources, then land here for your approval before anything is written to <code>data/companies/</code>.</p>
          <div className="empty-actions">{tax.domains.map((d) => <a key={d.id} className="btn" href={`#/d/${d.id}`}>{d.name}</a>)}</div>
        </div>
      ) : queue.map((q) => <QueueCard key={q.id} item={q} />)}
    </main>
  )
}
