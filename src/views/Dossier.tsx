import { useEffect } from 'react'
import { ExternalLink, Star, X } from 'lucide-react'
import { findByName, useAtlas } from '../lib/store'
import { CAUSE_LABEL, ROUND_LABEL, countryName, fmtDate, fmtMoney, fmtMonths, fmtUsd, type Co } from '../lib/model'

export const Unknown = () => <span className="unknown">unknown</span>
const host = (u: string) => { try { return new URL(u).hostname.replace('www.', '') } catch { return u } }
export const Src = ({ url }: { url?: string | null }) => (url ? <a className="src" href={url} target="_blank" rel="noreferrer" title={url}>{host(url)} <ExternalLink size={10} /></a> : null)
/** Marker for the independent source check of a single fact. */
export const Chk = ({ v, src }: { v?: string | null; src?: string | null }) => (v === 'confirmed' ? (src && /wikipedia\.org/.test(src) ? <span className="chk wiki" title="Confirmed on Wikipedia only: the primary source it cites could not be opened">✓ Wikipedia only</span> : <span className="chk ok" title="Confirmed: an independent check opened a page that states this">✓</span>) : v === 'unreachable' ? <span className="chk no" title="Not confirmed: no page could be opened that states this">not confirmed</span> : null)
const EVIDENCE: Record<string, string> = { nothing: 'Nothing', 'team-only': 'Team only', research: 'Research results', prototype: 'Prototype', demo: 'Working demo', pilot: 'Pilot', loi: 'Letter of intent', contract: 'Signed contract', revenue: 'Revenue' }
export const STATUS_LABEL: Record<string, string> = { active: 'Active', acquired: 'Acquired', public: 'Public', dead: 'Shut down' }

export function statusLine(c: Co) {
  const e = c.statusEvent
  if (c.status === 'active' || !e) return STATUS_LABEL[c.status]
  if (c.status === 'acquired') return `Acquired${e.acquirer?.name ? ` by ${e.acquirer.name}` : ''}${e.date ? `, ${fmtDate(e.date)}` : ''}${e.amount ? ` for ${fmtMoney(e.amount)}` : ''}`
  if (c.status === 'public') return `Public${e.type === 'spac' ? ' (SPAC)' : ''}${e.date ? ` since ${fmtDate(e.date)}` : ''}`
  return `Shut down${e.date ? ` ${fmtDate(e.date)}` : ''}`
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <section className="field"><h4>{label}</h4>{children}</section>
}
const Text = ({ v }: { v?: string | null }) => (v ? <p>{v}</p> : <p><Unknown /></p>)

export function Dossier() {
  const { selected: c, select, stars, toggleStar, notes, setNote, byName, tax } = useAtlas()
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') select(null) }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [select])
  if (!c) return null
  const subs = tax.domains.flatMap((d) => d.subsectors.map((s) => ({ ...s, domain: d })))
  const starred = stars.has(c.id)
  const facts = [...c.rounds, c.founded.date ? c.founded : null, c.statusEvent, c.totalRaised].filter((f): f is NonNullable<typeof f> => !!f)
  const checks = { total: facts.length, ok: facts.filter((f) => f.check === 'confirmed').length }
  return (
    <>
      <div className="scrim" onClick={() => select(null)} />
      <aside className="dossier" role="dialog" aria-label={`${c.name} dossier`}>
        <header>
          <div>
            <h2>{c.name}{c.unverified && <span className="tag unverified" title={c.lastVerified ? 'Low-confidence sourcing' : 'Never verified against sources'}>unverified</span>}</h2>
            <p className="pitch">{c.pitch}</p>
          </div>
          <div className="dossier-actions">
            <button className={`btn icon ${starred ? 'starred' : ''}`} onClick={() => toggleStar(c.id)} aria-pressed={starred} aria-label={starred ? 'Remove star' : 'Star this company'}><Star size={16} fill={starred ? 'currentColor' : 'none'} /></button>
            <button className="btn icon" onClick={() => select(null)} aria-label="Close dossier"><X size={16} /></button>
          </div>
        </header>
        <div className="chips">{c.subsectors.map((id) => { const s = subs.find((x) => x.id === id); return <span key={id} className="chip" style={{ '--accent': s?.domain.color } as React.CSSProperties}>{s ? `${s.domain.name} · ${s.name}` : id}</span> })}</div>
        <dl className="facts">
          <div><dt>Founded</dt><dd>{fmtDate(c.founded.date)} <Chk v={c.founded.date ? c.founded.check : null} src={c.founded.source} /> <Src url={c.founded.source} /></dd></div>
          <div><dt>Where</dt><dd>{c.hq.city ? `${c.hq.city}, ` : ''}{countryName(c.hq.country)}</dd></div>
          <div><dt>Total raised</dt><dd>{c.totalRaised ? <>{fmtMoney(c.totalRaised)} <Chk v={c.totalRaised.check} src={c.totalRaised.source} /> <Src url={c.totalRaised.source} /></> : c.sumUsd != null ? <span title="Sum of the rounds below with a sourced amount; indicative FX">{fmtUsd(c.sumUsd, true)} <i className="dim">sum of sourced rounds</i></span> : <Unknown />}</dd></div>
          <div><dt>Status</dt><dd>{statusLine(c)} <Chk v={c.statusEvent?.check} src={c.statusEvent?.source} /> <Src url={c.statusEvent?.source} /></dd></div>
          <div><dt>Website</dt><dd>{c.website ? <a href={c.website} target="_blank" rel="noreferrer">{host(c.website)}</a> : <Unknown />}</dd></div>
          <div><dt>Record</dt><dd><span className={`conf ${c.confidence}`}>{c.confidence} confidence</span> · {c.lastVerified ? `checked ${fmtDate(c.lastVerified)}` : 'never checked'}{checks.total > 0 && <span className="dim"> · {checks.ok} of {checks.total} sourced facts confirmed</span>}</dd></div>
        </dl>
        {[['Founding', c.founded.checkNote], ['Status', c.statusEvent?.checkNote], ['Total raised', c.totalRaised?.checkNote]].filter(([, n]) => n).map(([k, n]) => <p key={k} className="check-note">{k}, checker’s note: {n}</p>)}
        {c.statusEvent?.note && <p className={`status-note ${c.status}`}>{c.status === 'dead' && c.statusEvent.causeCategory ? <b>{CAUSE_LABEL[c.statusEvent.causeCategory]}. </b> : null}{c.statusEvent.note}</p>}

        <Field label="Story and origin"><Text v={c.story} /></Field>
        <Field label="Founders">
          {c.founders?.length ? <ul className="founders">{c.founders.map((f) => <li key={f.name}><b>{f.name}</b>{f.role ? ` · ${f.role}` : ''}<br /><span>{f.background ?? <Unknown />}</span></li>)}</ul> : <p><Unknown /></p>}
        </Field>
        <Field label="Product"><Text v={c.product} /></Field>
        <div className="wedge">
          <div><h4>Started with (the wedge)</h4><Text v={c.wedge} /></div>
          <div className="arrow" aria-hidden>→</div>
          <div><h4>Became</h4><Text v={c.became} /></div>
        </div>
        <Field label="Differentiator at the time"><Text v={c.differentiator} /></Field>
        <Field label="Competitors they faced (researcher’s list, not individually sourced)">
          {c.competitors?.length ? <div className="chips">{c.competitors.map((n) => { const m = findByName(byName, n); return m ? <button key={n} className="chip link" onClick={() => select(m.id)}>{n}</button> : <span key={n} className="chip muted" title="Not in the atlas">{n}</span> })}</div> : <p><Unknown /></p>}
        </Field>

        <Field label={`Funding rounds (${c.rounds.length})`}>
          {c.rounds.length ? (
            <table className="tbl rounds">
              <thead><tr><th>Date</th><th>Round</th><th className="num">Amount</th><th>Lead · other investors</th><th className="num">Since founding</th></tr></thead>
              <tbody>{c.rT.map(({ r, t }, i) => (
                <tr key={i}>
                  <td>{fmtDate(r.date)}</td>
                  <td>{r.label || ROUND_LABEL[r.type] || r.type} <Chk v={r.check} src={r.source} /></td>
                  <td className="num">{r.amount ? fmtMoney(r.amount) : <Unknown />}</td>
                  <td>{r.leads.length ? <b>{r.leads.join(', ')}</b> : <Unknown />}{r.investors.length ? <span className="dim"> · {r.investors.join(', ')}</span> : null} <Src url={r.source} />{r.checkNote && <p className="check-note">Checker’s note: {r.checkNote}</p>}</td>
                  <td className="num">{t != null && c.t0 != null ? fmtMonths(Math.max(0, (t - c.t0) * 12)) : <Unknown />}</td>
                </tr>
              ))}</tbody>
            </table>
          ) : <p className="dim">No sourced rounds on record.</p>}
        </Field>
        <Field label="What they had to show at the first raise">
          {c.firstRaiseEvidence ? <p><b>{EVIDENCE[c.firstRaiseEvidence.kind] ?? c.firstRaiseEvidence.kind}.</b> {c.firstRaiseEvidence.note} <Src url={c.firstRaiseEvidence.source} /></p> : <p><Unknown /></p>}
        </Field>
        <Field label="First customers and contracts">
          {c.firstCustomers?.length ? <ul className="plain">{c.firstCustomers.map((f, i) => <li key={i}><b>{f.name}</b>{f.date ? ` · ${fmtDate(f.date)}` : ''}{f.note ? `: ${f.note}` : ''} <Src url={f.source} /></li>)}</ul> : <p><Unknown /></p>}
        </Field>
        <Field label="My notes">
          <textarea value={notes[c.id] ?? ''} onChange={(e) => setNote(c.id, e.target.value)} placeholder="Why this one matters, what to copy, what to avoid…" rows={4} />
          <p className="dim small">Saved automatically to data/user/annotations.json</p>
        </Field>
        <Field label={`Sources (${c.sources.length})`}>
          {c.sources.length ? <ul className="plain sources">{c.sources.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer">{s.title || host(s.url)}</a> <span className="dim">{host(s.url)}</span></li>)}</ul> : <p className="dim">No sources recorded.</p>}
        </Field>
      </aside>
    </>
  )
}
