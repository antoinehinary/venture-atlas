import { useWidth, yearAxis } from '../lib/axis'
import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Minus, Pause, Play, Plus, Search, SkipForward, Star } from 'lucide-react'
import { useAtlas } from '../lib/store'
import { buildScene, getEngine } from '../globe/Stage'
import { NOW, STAGES, T_START, appearT, countryName, fmtDate, fmtUsd, groupFor, raisedAt, toT, type AtlasEvent, type Co } from '../lib/model'
import { Patterns, PATTERN_TABS } from './Patterns'
import { RefreshControls } from './Refresh'
import { DeleteField } from './Fields'
import { STATUS_LABEL, statusLine } from './Dossier'

const STATUSES = ['active', 'acquired', 'public', 'dead'] as const
export const EVENT_KIND: Record<string, { name: string; color: string }> = {
  conflict: { name: 'Conflict', color: '#e66767' }, policy: { name: 'Policy & budget', color: '#c98500' }, technology: { name: 'Technology', color: '#3987e5' },
  round: { name: 'Landmark round', color: '#199e70' }, exit: { name: 'Exit', color: '#9085e9' }, market: { name: 'Market', color: '#d55181' },
}
const toggle = <T,>(s: Set<T>, v: T) => { const n = new Set(s); if (n.has(v)) n.delete(v); else n.add(v); return n }

export function DomainView({ domainId, tab }: { domainId: string; tab: string }) {
  const a = useAtlas()
  const dom = a.tax.domains.find((d) => d.id === domainId)!
  const list = useMemo(() => a.companies.filter((c) => c.domains.includes(domainId)), [a.companies, domainId])
  const events = useMemo(() => a.events.filter((e) => e.domains.includes(domainId)).sort((x, y) => x.date.localeCompare(y.date)), [a.events, domainId])
  const G = useMemo(() => groupFor(a.tax, domainId), [a.tax, domainId])

  const [t, setT] = useState(NOW), [playing, setPlaying] = useState(false), [speed, setSpeed] = useState(1.5)
  const [offSubs, setOffSubs] = useState(new Set<string>()), [offStages, setOffStages] = useState(new Set<string>()), [offStatus, setOffStatus] = useState(new Set<string>())
  const [country, setCountry] = useState(''), [starredOnly, setStarredOnly] = useState(false), [q, setQ] = useState('')
  const [hover, setHover] = useState<{ c: Co; x: number; y: number } | null>(null)

  const visible = useMemo(() => {
    const ql = q.trim().toLowerCase()
    return (c: Co) => !offSubs.has(G.of(c).id) && !offStages.has(c.stage) && !offStatus.has(c.status) && (!country || c.hq.country === country) && (!starredOnly || a.stars.has(c.id)) && (!ql || c.name.toLowerCase().includes(ql) || c.pitch.toLowerCase().includes(ql))
  }, [offSubs, offStages, offStatus, country, starredOnly, q, G, a.stars])
  const shown = useMemo(() => list.filter(visible), [list, visible])
  const filtersOn = offSubs.size + offStages.size + offStatus.size > 0 || !!country || starredOnly || !!q

  // playback
  useEffect(() => {
    if (!playing) return
    let raf = 0, last = performance.now()
    const tick = (now: number) => { const dt = (now - last) / 1000; last = now; setT((v) => { const n = v + dt * speed; if (n >= NOW) { setPlaying(false); return NOW } return n }); raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf)
  }, [playing, speed])
  const play = () => { if (t >= NOW - 0.01) setT(T_START); setPlaying((p) => !p) }

  // push the scene to the globe
  const isGlobe = tab === 'globe'
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const { points, arcs } = buildScene(list, t, G.of, G.glow, visible, { labels: true, starred: a.stars })
      getEngine()?.setPoints(domainId, points); getEngine()?.setArcs(domainId, arcs)
    })
    return () => cancelAnimationFrame(id)
  }, [list, t, G, visible, a.stars, domainId, isGlobe])
  const byId = a.byId, select = a.select
  useEffect(() => {
    const id = requestAnimationFrame(() => getEngine()?.setHandlers(domainId, {
      onHover: (cid, x, y) => setHover(cid && byId.get(cid) ? { c: byId.get(cid)!, x, y } : null),
      onSelect: (cid) => { if (cid) select(cid) },
    }))
    return () => { cancelAnimationFrame(id); getEngine()?.setHandlers(domainId, {}) }
  }, [domainId, byId, select])
  useEffect(() => { const id = setTimeout(() => getEngine()?.focus(domainId, 38, -28), 60); return () => clearTimeout(id) }, [domainId])

  const present = shown.filter((c) => appearT(c) <= t)
  const counts = useMemo(() => { const m = new Map<string, number>(); for (const c of list) m.set(G.of(c).id, (m.get(G.of(c).id) ?? 0) + 1); return m }, [list, G])
  const countries = useMemo(() => [...new Set(list.map((c) => c.hq.country))].map((cc) => ({ cc, name: countryName(cc), n: list.filter((c) => c.hq.country === cc).length })).sort((x, y) => y.n - x.n), [list])
  const unlocated = shown.filter((c) => !c.located).length
  const raisedNow = present.reduce((s, c) => s + (raisedAt(c, t) ?? 0), 0)
  const recentEvent = [...events].reverse().find((e) => { const et = toT(e.date)!; return et <= t && t - et < 1.1 })
  const year = Math.floor(t), month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Math.min(11, Math.floor((t - year) * 12))]

  return (
    <main className="domain" style={{ '--accent': dom.color } as React.CSSProperties}>
      <div className="domain-head">
        <a className="btn ghost" href="#/" aria-label="Back to all globes"><ArrowLeft size={15} /> All globes</a>
        <div className="domain-title"><h1>{dom.name}</h1><span>{list.length} companies · {dom.tagline}</span></div>
        <RefreshControls domainId={domainId} domainName={dom.name} lastRefresh={a.meta.lastRefresh?.[domainId]} />
        <DeleteField id={domainId} name={dom.name} />
      </div>
      <div className="tabs">
        <a href={`#/d/${domainId}`} className={isGlobe ? 'on' : ''}>Globe</a>
        {PATTERN_TABS.map((p) => <a key={p.id} href={`#/d/${domainId}/${p.id}`} className={tab === p.id ? 'on' : ''}>{p.name}</a>)}
      </div>

      {!isGlobe ? <div className="page inner"><Patterns domainId={domainId} tab={tab} /></div> : (
        <div className="globe-layout">
          <aside className="filters">
            <label className="search"><Search size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search companies" aria-label="Search companies" /></label>
            <div className="filter-group">
              <h4>Subsector <button className="link" onClick={() => setOffSubs(offSubs.size ? new Set() : new Set(G.groups.map((g) => g.id)))}>{offSubs.size ? 'all' : 'none'}</button></h4>
              {G.groups.map((g) => (
                <button key={g.id} className={`legend-row ${offSubs.has(g.id) ? 'off' : ''}`} onClick={() => setOffSubs(toggle(offSubs, g.id))} aria-pressed={!offSubs.has(g.id)} title={dom.subsectors.find((s) => s.id === g.id)?.description}>
                  <i style={{ background: G.glow(g) }} /><span>{g.name}</span><em>{counts.get(g.id) ?? 0}</em>
                </button>
              ))}
            </div>
            <div className="filter-group"><h4>Stage</h4><div className="pills">{STAGES.map((s) => <button key={s} className={offStages.has(s) ? 'off' : ''} aria-pressed={!offStages.has(s)} onClick={() => setOffStages(toggle(offStages, s))}>{s}</button>)}</div></div>
            <div className="filter-group"><h4>Status</h4><div className="pills">{STATUSES.map((s) => <button key={s} className={offStatus.has(s) ? 'off' : ''} aria-pressed={!offStatus.has(s)} onClick={() => setOffStatus(toggle(offStatus, s))}><span className={`glyph ${s}`} />{STATUS_LABEL[s]}</button>)}</div></div>
            <div className="filter-group"><h4>Country</h4>
              <select value={country} onChange={(e) => { setCountry(e.target.value); const c = list.find((x) => x.hq.country === e.target.value); if (c?.located) getEngine()?.focus(domainId, c.jLat, c.jLon) }} aria-label="Country">
                <option value="">All countries ({countries.length})</option>{countries.map((c) => <option key={c.cc} value={c.cc}>{c.name} ({c.n})</option>)}
              </select>
            </div>
            <label className="check"><input type="checkbox" checked={starredOnly} onChange={(e) => setStarredOnly(e.target.checked)} /> <Star size={13} /> Starred only ({list.filter((c) => a.stars.has(c.id)).length})</label>
            {filtersOn && <button className="btn ghost" onClick={() => { setOffSubs(new Set()); setOffStages(new Set()); setOffStatus(new Set()); setCountry(''); setStarredOnly(false); setQ('') }}>Clear filters</button>}
            <div className="glyph-key">
              <p><span className="glyph active" /> size grows with money raised</p>
              <p><span className="glyph hollow" /> hollow = unverified record</p>
              <p><span className="glyph acquired" /> acquired, arc to acquirer</p>
              <p><span className="glyph public" /> public · <span className="glyph dead" /> shut down</p>
            </div>
          </aside>

          <section className="globe-wrap">
            <div className="globe-slot big" data-globe-slot={domainId} data-interactive="true" data-autorotate="false" />
            <div className="now-readout" aria-live="off">
              <b>{month} {year}</b>
              <span>{present.length} compan{present.length === 1 ? 'y' : 'ies'} · {fmtUsd(raisedNow || null, true)} raised</span>
              {recentEvent && <p key={recentEvent.id} className="event-toast"><i style={{ background: EVENT_KIND[recentEvent.kind]?.color }} />{fmtDate(recentEvent.date)} · {recentEvent.title}</p>}
            </div>
            <div className="zoom"><button className="btn icon" onClick={() => getEngine()?.zoom(domainId, 0.8)} aria-label="Zoom in"><Plus size={15} /></button><button className="btn icon" onClick={() => getEngine()?.zoom(domainId, 1.25)} aria-label="Zoom out"><Minus size={15} /></button></div>
            {list.length === 0 && <div className="empty over"><p>No companies in this domain yet.</p><p className="dim">Use “Fetch latest” or “Add a company” above; results go to the review queue first.</p></div>}
            {unlocated > 0 && <p className="unlocated">{unlocated} compan{unlocated > 1 ? 'ies' : 'y'} not on the globe (founding city unknown): find them in the pattern tabs or search.</p>}
            {list.length > 0 && shown.length === 0 && <div className="empty over"><p>No company matches these filters.</p></div>}
          </section>

          <Timeline t={t} setT={(v) => { setT(v); setPlaying(false) }} companies={shown} events={events} playing={playing} onPlay={play} speed={speed} setSpeed={setSpeed} toEnd={() => { setPlaying(false); setT(NOW) }} />
        </div>
      )}

      {hover && isGlobe && (
        <div className="hover-card" style={{ left: Math.min(hover.x + 16, window.innerWidth - 300), top: Math.min(hover.y + 14, window.innerHeight - 150) }}>
          <b>{hover.c.name}{hover.c.unverified && <span className="tag unverified">unverified</span>}</b>
          <p>{hover.c.pitch}</p>
          <dl><div><dt>Founded</dt><dd>{fmtDate(hover.c.founded.date)}</dd></div><div><dt>Raised</dt><dd>{fmtUsd(hover.c.totalUsd, hover.c.totalPartial)}</dd></div></dl>
          <span className="hc-status"><span className={`glyph ${hover.c.status}`} />{statusLine(hover.c)}</span>
        </div>
      )}
    </main>
  )
}

function Timeline({ t, setT, companies, events, playing, onPlay, speed, setSpeed, toEnd }: { t: number; setT: (t: number) => void; companies: Co[]; events: AtlasEvent[]; playing: boolean; onPlay: () => void; speed: number; setSpeed: (s: number) => void; toEnd: () => void }) {
  const [ref, trackW] = useWidth()
  const [tip, setTip] = useState<AtlasEvent | null>(null)
  const END = Math.ceil(NOW)
  const axis = yearAxis(T_START, END, trackW, { canRotate: false })
  const pct = (v: number) => ((v - T_START) / (END - T_START)) * 100
  const years = Array.from({ length: END - T_START }, (_, i) => T_START + i)
  const hist = useMemo(() => { const m = new Map<number, number>(); for (const c of companies) if (c.t0 != null) m.set(Math.floor(c.t0), (m.get(Math.floor(c.t0)) ?? 0) + 1); return m }, [companies])
  const max = Math.max(1, ...hist.values())
  const at = (clientX: number) => { const r = ref.current!.getBoundingClientRect(); return Math.max(T_START, Math.min(NOW, T_START + ((clientX - r.left) / r.width) * (END - T_START))) }
  const down = (e: React.PointerEvent) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); setT(at(e.clientX)) }
  const move = (e: React.PointerEvent) => { if (e.buttons & 1) setT(at(e.clientX)) }
  const key = (e: React.KeyboardEvent) => { if (e.key === 'ArrowLeft') setT(Math.max(T_START, t - (e.shiftKey ? 1 : 1 / 12))); if (e.key === 'ArrowRight') setT(Math.min(NOW, t + (e.shiftKey ? 1 : 1 / 12))) }
  return (
    <footer className="timeline">
      <div className="tl-controls">
        <button className="btn primary icon" onClick={onPlay} aria-label={playing ? 'Pause' : 'Play history'}>{playing ? <Pause size={16} /> : <Play size={16} />}</button>
        <button className="btn icon" onClick={toEnd} aria-label="Jump to today" title="Jump to today"><SkipForward size={14} /></button>
        <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Playback speed"><option value={0.6}>Slow</option><option value={1.5}>Normal</option><option value={4}>Fast</option></select>
      </div>
      <div className="tl-track" ref={ref} onPointerDown={down} onPointerMove={move} onKeyDown={key} tabIndex={0} role="slider" aria-label="Timeline" aria-valuemin={T_START} aria-valuemax={Math.floor(NOW)} aria-valuenow={Math.floor(t)}>
        <div className="tl-bars">{years.map((y) => <i key={y} className={y + 1 <= t ? 'past' : y < t ? 'cur' : ''} style={{ left: `${pct(y)}%`, width: `${100 / years.length}%`, height: `${((hist.get(y) ?? 0) / max) * 100}%` }} title={`${y}: ${hist.get(y) ?? 0} founded`} />)}</div>
        <div className="tl-axis">{years.filter(axis.show).map((y) => <span key={y} style={{ left: `${pct(y)}%` }}>{y}</span>)}</div>
        <div className="tl-events">{events.map((e) => { const et = toT(e.date)!; if (et < T_START) return null; return (
          <button key={e.id} className={`tl-event ${et <= t ? 'past' : ''}`} style={{ left: `${pct(et)}%`, '--k': EVENT_KIND[e.kind]?.color } as React.CSSProperties}
            onPointerDown={(ev) => ev.stopPropagation()} onClick={() => setT(Math.min(NOW, et + 0.02))} onMouseEnter={() => setTip(e)} onMouseLeave={() => setTip(null)} onFocus={() => setTip(e)} onBlur={() => setTip(null)} aria-label={`${fmtDate(e.date)}: ${e.title}`} />
        ) })}</div>
        <div className="tl-head" style={{ left: `${pct(t)}%` }} />
        {tip && <div className="tl-tip" style={{ left: `${Math.max(12, Math.min(88, pct(toT(tip.date)!)))}%` }}><b>{fmtDate(tip.date)} · {tip.title}</b>{tip.detail && <p>{tip.detail}</p>}<span style={{ color: EVENT_KIND[tip.kind]?.color }}>{EVENT_KIND[tip.kind]?.name}</span></div>}
      </div>
      <div className="tl-legend">{Object.entries(EVENT_KIND).filter(([k]) => events.some((e) => e.kind === k)).map(([k, v]) => <span key={k}><i style={{ background: v.color }} />{v.name}</span>)}<span className="dim">bars: companies founded per year</span></div>
    </footer>
  )
}
