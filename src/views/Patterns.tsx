import { useMemo, useState } from 'react'
import { useAtlas } from '../lib/store'
import { CAUSE_LABEL, NOW, REGION_NAMES, ROUND_LABEL, T_START, fmtDate, fmtMoney, fmtMonths, fmtUsd, groupFor, median, normInvestor, toT, type AtlasEvent, type Co, type Group } from '../lib/model'
import { EVENT_KIND } from './DomainView'
import { Unknown } from './Dossier'
import { placeMarkers, useWidth, yearAxis } from '../lib/axis'

export const PATTERN_TABS = [
  { id: 'waves', name: 'Founding waves' }, { id: 'speed', name: 'Speed of money' }, { id: 'investors', name: 'Investors' },
  { id: 'whitespace', name: 'White space' }, { id: 'exits', name: 'Deaths & exits' }, { id: 'starred', name: 'Starred & notes' },
]
type Ctx = { list: Co[]; groups: Group[]; of: (c: Co) => Group; events: AtlasEvent[]; unit: string }
type TipState = { x: number; y: number; body: React.ReactNode } | null

const Tip = ({ tip }: { tip: TipState }) => (tip ? <div className="chart-tip" style={{ left: Math.max(8, Math.min(tip.x + 14, window.innerWidth - 300)), top: tip.y + 14 }}>{tip.body}</div> : null)
const Legend = ({ groups, extra }: { groups: Group[]; extra?: React.ReactNode }) => <div className="legend">{groups.map((g) => <span key={g.id}><i style={{ background: g.color }} />{g.name}</span>)}{extra}</div>
const Name = ({ c }: { c: Co }) => { const { select } = useAtlas(); return <button className="link name" onClick={() => select(c.id)}>{c.name}{c.unverified && <span className="tag unverified">unverified</span>}</button> }
const Seg = <T extends string>({ value, set, options }: { value: T; set: (v: T) => void; options: [T, string][] }) => <div className="seg" role="group">{options.map(([v, l]) => <button key={v} className={v === value ? 'on' : ''} aria-pressed={v === value} onClick={() => set(v)}>{l}</button>)}</div>
const Empty = ({ what }: { what: string }) => <div className="empty"><p>{what}</p></div>

export function Patterns({ domainId, tab }: { domainId: string | null; tab: string }) {
  const a = useAtlas()
  const ctx: Ctx = useMemo(() => {
    const G = groupFor(a.tax, domainId)
    const list = domainId ? a.companies.filter((c) => c.domains.includes(domainId)) : a.companies
    const events = (domainId ? a.events.filter((e) => e.domains.includes(domainId)) : a.events).filter((e) => toT(e.date)! >= T_START).sort((x, y) => x.date.localeCompare(y.date))
    return { list, groups: G.groups, of: G.of, events, unit: domainId ? 'subsector' : 'domain' }
  }, [a.tax, a.companies, a.events, domainId])
  if (!ctx.list.length && tab !== 'starred') return <Empty what="No companies to analyse yet." />
  if (tab === 'speed') return <Speed {...ctx} />
  if (tab === 'investors') return <Investors {...ctx} />
  if (tab === 'whitespace') return <WhiteSpace {...ctx} />
  if (tab === 'exits') return <Exits {...ctx} />
  if (tab === 'starred') return <Starred {...ctx} />
  return <Waves {...ctx} />
}

// ---- 1. Founding waves --------------------------------------------------------------------------
function Waves({ list, groups, of, events: allEvents, unit }: Ctx) {
  const [mode, setMode] = useState<'founded' | 'capital'>('founded')
  const kinds = Object.keys(EVENT_KIND).filter((k) => allEvents.some((e) => e.kind === k))
  const [offKinds, setOffKinds] = useState<Set<string>>(() => new Set(unit === 'domain' ? ['round', 'exit', 'market', 'technology'] : []))
  const events = allEvents.filter((e) => !offKinds.has(e.kind))
  const [ref, W] = useWidth(), [tip, setTip] = useState<TipState>(null)
  const y0 = T_START, y1 = Math.floor(NOW), years = Array.from({ length: y1 - y0 + 1 }, (_, i) => y0 + i)
  const ml = 48, mr = 12, axis = yearAxis(y0, y1 + 1, W - ml - mr)
  const H = W < 560 ? 340 : 400, m = { l: ml, r: mr, t: 56, b: axis.height + 8 }
  const data = useMemo(() => years.map((yr) => groups.map((g) => {
    if (mode === 'founded') { const cs = list.filter((c) => c.t0 != null && Math.floor(c.t0) === yr && of(c).id === g.id); return { v: cs.length, cs } }
    const cs: Co[] = []; let v = 0
    for (const c of list) if (of(c).id === g.id) { let s = 0; for (const r of c.rT) if (r.t != null && Math.floor(r.t) === yr && r.usd != null) s += r.usd; if (s > 0) { v += s; cs.push(c) } }
    return { v, cs }
  })), [list, groups, of, mode]) // eslint-disable-line
  const totals = data.map((row) => row.reduce((s, d) => s + d.v, 0)), max = Math.max(1, ...totals)
  const step = mode === 'founded' ? Math.max(1, Math.ceil(max / 5)) : Math.pow(10, Math.floor(Math.log10(max))) * (max / Math.pow(10, Math.floor(Math.log10(max))) > 5 ? 2 : max / Math.pow(10, Math.floor(Math.log10(max))) > 2 ? 1 : 0.5)
  const top = Math.ceil(max / step) * step
  const bw = (W - m.l - m.r) / years.length, x = (t: number) => m.l + (t - y0) * bw, y = (v: number) => H - m.b - (v / top) * (H - m.t - m.b)
  const undated = list.filter((c) => c.t0 == null).length
  const fmtV = (v: number) => (mode === 'founded' ? String(v) : fmtUsd(v))
  const markers = placeMarkers(events.map((e, i) => ({ x: x(toT(e.date)!), id: i + 1 })), { minX: m.l - 9, maxX: W })
  const eventTip = (ids: number[]) => <>{ids.map((id) => { const e = events[id - 1]; return <div key={id} className="tip-ev"><b>{id}. {fmtDate(e.date)} · {e.title}</b>{ids.length === 1 && e.detail && <p>{e.detail}</p>}<p className="dim">{EVENT_KIND[e.kind]?.name}</p></div> })}</>
  return (
    <div className="panel">
      <div className="panel-head">
        <div><h2>{mode === 'founded' ? 'Companies founded per year' : 'Capital raised per year'}, by {unit}</h2><p>Numbered markers are external events: hover one to see what happened, then look at the bars that follow.</p></div>
        <Seg value={mode} set={setMode} options={[['founded', 'Companies founded'], ['capital', 'Capital raised']]} />
      </div>
      <Legend groups={groups} />
      <div className="pills kinds"><span className="dim small">Events shown:</span>{kinds.map((k) => <button key={k} className={offKinds.has(k) ? 'off' : ''} aria-pressed={!offKinds.has(k)} onClick={() => { const n = new Set(offKinds); if (n.has(k)) n.delete(k); else n.add(k); setOffKinds(n) }}><i style={{ background: EVENT_KIND[k].color }} />{EVENT_KIND[k].name} ({allEvents.filter((e) => e.kind === k).length})</button>)}</div>
      <div ref={ref} className="chart">
        <svg width={W} height={H} role="img" aria-label="Stacked bars per year">
          {Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step).map((v) => <g key={v}><line x1={m.l} x2={W - m.r} y1={y(v)} y2={y(v)} className="grid" /><text x={m.l - 8} y={y(v) + 4} textAnchor="end" className="axis">{fmtV(v)}</text></g>)}
          {years.map((yr, i) => {
            let acc = 0
            return <g key={yr}>
              {data[i].map((d, gi) => { if (!d.v) return null; const yy = y(acc + d.v), hh = y(acc) - yy; acc += d.v
                return <rect key={gi} x={x(yr) + bw * 0.14} y={yy + 1} width={bw * 0.72} height={Math.max(1, hh - 2)} rx={Math.min(3, hh / 3)} fill={groups[gi].color}
                  onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, body: <><b>{yr} · {groups[gi].name}</b><p>{mode === 'founded' ? `${d.v} founded` : `${fmtUsd(d.v, true)} raised by ${d.cs.length}`}</p><p className="dim">{d.cs.slice(0, 12).map((c) => c.name).join(', ')}{d.cs.length > 12 ? '…' : ''}</p></> })} onMouseLeave={() => setTip(null)} /> })}
              {axis.show(yr) && (axis.rotate
                ? <text x={x(yr) + bw / 2} y={H - m.b + 14} textAnchor="end" transform={`rotate(-40 ${x(yr) + bw / 2} ${H - m.b + 14})`} className="axis">{yr}</text>
                : <text x={x(yr) + bw / 2} y={H - m.b + 16} textAnchor="middle" className="axis">{yr}</text>)}
            </g>
          })}
          {events.map((e) => { const ex = x(toT(e.date)!); return <line key={e.id} x1={ex} x2={ex} y1={m.t - 6} y2={H - m.b} stroke={EVENT_KIND[e.kind]?.color} strokeDasharray="2 4" opacity={0.7} pointerEvents="none" /> })}
          {markers.map((mk) => { const e = events[mk.ids[0] - 1], cy = m.t - 16 - mk.row * 21, col = mk.ids.length === 1 ? EVENT_KIND[e.kind]?.color : 'var(--text-2)'; return (
            <g key={mk.ids[0]} className="ev" onMouseMove={(ev) => setTip({ x: ev.clientX, y: ev.clientY, body: eventTip(mk.ids) })} onMouseLeave={() => setTip(null)} onClick={(ev) => setTip({ x: ev.clientX, y: ev.clientY, body: eventTip(mk.ids) })}>
              <rect x={mk.left} y={cy - 9} width={mk.width} height={18} rx={9} fill="var(--surface)" stroke={col} strokeWidth={1.5} />
              <text x={mk.left + mk.width / 2} y={cy + 3.5} textAnchor="middle" className="ev-n">{mk.label}</text>
            </g>) })}
        </svg>
      </div>
      {undated > 0 && mode === 'founded' && <p className="dim small">{undated} compan{undated > 1 ? 'ies' : 'y'} with an unknown founding date not shown.</p>}
      {mode === 'capital' && <p className="dim small">Only rounds with a sourced amount and date. Currencies combined at indicative rates.</p>}
      <ol className="event-list">{events.map((e) => <li key={e.id}><i style={{ background: EVENT_KIND[e.kind]?.color }} /><b>{fmtDate(e.date)}</b> {e.title} <a href={e.source} target="_blank" rel="noreferrer" className="src">source</a></li>)}</ol>
      <Tip tip={tip} />
    </div>
  )
}

// ---- 2. Speed of money --------------------------------------------------------------------------
const COHORTS: [string, (t: number) => boolean][] = [['Founded up to 2015', (t) => t < 2016], ['2016–2020', (t) => t >= 2016 && t < 2021], ['2021 onwards', (t) => t >= 2021]]
function Speed({ list, groups, of, unit }: Ctx) {
  const { select } = useAtlas()
  const [ref, W] = useWidth(), [tip, setTip] = useState<TipState>(null)
  const pts = list.filter((c) => c.t0 != null && c.monthsToFirst != null && c.first)
  const x0 = Math.max(T_START, Math.floor(Math.min(NOW - 12, ...pts.map((c) => c.t0!)))), x1 = Math.ceil(NOW)
  const axis = yearAxis(x0, x1, W - 52 - 16)
  const H = W < 560 ? 340 : 400, m = { l: 52, r: 16, t: 14, b: axis.height + 14 }, CAP = 84
  const x = (t: number) => m.l + ((Math.max(x0, t) - x0) / (x1 - x0)) * (W - m.l - m.r), y = (mo: number) => H - m.b - (Math.min(mo, CAP) / CAP) * (H - m.t - m.b)
  const maxUsd = Math.max(1e6, ...pts.map((c) => c.first!.usd ?? 0)), r = (usd: number | null) => (usd == null ? 4 : 4 + 20 * Math.sqrt(usd / maxUsd))
  const rows = groups.map((g) => { const cs = pts.filter((c) => of(c).id === g.id); return { g, n: cs.length, months: median(cs.map((c) => c.monthsToFirst!)), size: median(cs.map((c) => c.first!.usd).filter((v): v is number => v != null)), cohorts: COHORTS.map(([, f]) => { const cc = cs.filter((c) => f(c.t0!)); return { n: cc.length, months: median(cc.map((c) => c.monthsToFirst!)), size: median(cc.map((c) => c.first!.usd).filter((v): v is number => v != null)) } }) } })
  const all = COHORTS.map(([name, f]) => { const cc = pts.filter((c) => f(c.t0!)); return { name, n: cc.length, months: median(cc.map((c) => c.monthsToFirst!)), size: median(cc.map((c) => c.first!.usd).filter((v): v is number => v != null)) } })
  if (!pts.length) return <Empty what="No company has both a founding date and a dated first round yet." />
  return (
    <div className="panel">
      <div className="panel-head"><div><h2>How fast the first money arrived</h2><p>Each circle is a company: when it was founded, how long until its first equity round, and how big that round was. {pts.length} of {list.length} companies have both dates.</p></div></div>
      <div className="stat-row">{all.map((c) => <div key={c.name} className="stat"><span>{c.name}</span><b>{c.months == null ? '—' : fmtMonths(c.months)}</b><em>median to first round · {c.size == null ? 'size unknown' : `${fmtUsd(c.size, true)} median`} · {c.n} co.</em></div>)}</div>
      <Legend groups={groups} extra={<><span className="sep" /><span><i className="ring" />amount undisclosed</span><span className="dim">circle area = first-round size</span></>} />
      <div ref={ref} className="chart">
        <svg width={W} height={H} role="img" aria-label="Months from founding to first round by founding year">
          {[0, 12, 24, 36, 48, 60, 72, 84].map((v) => <g key={v}><line x1={m.l} x2={W - m.r} y1={y(v)} y2={y(v)} className="grid" /><text x={m.l - 8} y={y(v) + 4} textAnchor="end" className="axis">{v === CAP ? '7 yr+' : v === 0 ? '0' : `${v / 12} yr`}</text></g>)}
          {Array.from({ length: x1 - x0 + 1 }, (_, i) => x0 + i).filter(axis.show).map((yr) => axis.rotate
            ? <text key={yr} x={x(yr)} y={H - m.b + 16} textAnchor="end" transform={`rotate(-40 ${x(yr)} ${H - m.b + 16})`} className="axis">{yr}</text>
            : <text key={yr} x={x(yr)} y={H - m.b + 18} textAnchor="middle" className="axis">{yr}</text>)}
          <text x={m.l} y={H - 0.5} className="axis" />
          {[...pts].sort((p, q) => (q.first!.usd ?? 0) - (p.first!.usd ?? 0)).map((c) => { const g = of(c), known = c.first!.usd != null
            return <circle key={c.id} cx={x(c.t0!)} cy={y(c.monthsToFirst!)} r={r(c.first!.usd)} fill={known ? g.color : 'transparent'} fillOpacity={0.72} stroke={known ? 'var(--surface)' : g.color} strokeWidth={known ? 2 : 1.5} className="dot"
              onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, body: <><b>{c.name}</b><p>Founded {fmtDate(c.founded.date)} · first round {fmtDate(c.first!.r.date)} ({fmtMonths(c.monthsToFirst)} later)</p><p>{ROUND_LABEL[c.first!.r.type]}: {fmtMoney(c.first!.r.amount)}{c.first!.r.leads.length ? `, led by ${c.first!.r.leads.join(', ')}` : ''}</p><p className="dim">{g.name}</p></> })} onMouseLeave={() => setTip(null)} onClick={() => select(c.id)} /> })}
        </svg>
        <span className="y-title">Time from founding to first round</span>
      </div>
      <div className="scroll-x"><table className="tbl">
        <thead><tr><th>{unit === 'domain' ? 'Domain' : 'Subsector'}</th><th className="num">Companies</th><th className="num">Median time to first round</th><th className="num">Median first round</th>{COHORTS.map(([n]) => <th key={n} className="num">{n}</th>)}</tr></thead>
        <tbody>{rows.map(({ g, n, months, size, cohorts }) => <tr key={g.id}><td><i className="sw" style={{ background: g.color }} />{g.name}</td><td className="num">{n}</td><td className="num">{n ? fmtMonths(months) : '—'}</td><td className="num">{size == null ? '—' : fmtUsd(size, true)}</td>{cohorts.map((c, i) => <td key={i} className="num">{c.n ? <>{fmtMonths(c.months)} <span className="dim">· {c.size == null ? '?' : fmtUsd(c.size)} · n={c.n}</span></> : '—'}</td>)}</tr>)}</tbody>
      </table></div>
      <p className="dim small">Medians over small samples: read them as hints. Companies without a month-precise founding date and first-round date are excluded when the gap is under a year.</p>
      <Tip tip={tip} />
    </div>
  )
}

// ---- 3. Investors -------------------------------------------------------------------------------
function Investors({ list, groups, of, unit }: Ctx) {
  const [mode, setMode] = useState<'lead' | 'first' | 'any'>('lead'), [tip, setTip] = useState<TipState>(null)
  const { matrix, early } = useMemo(() => {
    const m = new Map<string, Map<string, Co[]>>()
    const firsts = new Map<string, { inv: string; t: number; c: Co; type: string; date: string | null }[]>()
    for (const c of list) {
      const g = of(c).id
      c.rT.forEach((rt, i) => {
        const isFirst = c.first ? rt === c.first : i === 0
        const names = (mode === 'lead' ? (isFirst ? rt.r.leads : []) : mode === 'first' ? (isFirst ? [...rt.r.leads, ...rt.r.investors] : []) : [...rt.r.leads, ...rt.r.investors]).map(normInvestor)
        for (const n of new Set(names)) { if (!m.has(n)) m.set(n, new Map()); const row = m.get(n)!; if (!row.get(g)?.includes(c)) row.set(g, [...(row.get(g) ?? []), c]) }
        if (rt.t != null) for (const n of new Set([...rt.r.leads, ...rt.r.investors].map(normInvestor))) { if (!firsts.has(g)) firsts.set(g, []); firsts.get(g)!.push({ inv: n, t: rt.t, c, type: rt.r.type, date: rt.r.date }) }
      })
    }
    const matrix = [...m.entries()].map(([inv, row]) => ({ inv, row, total: new Set([...row.values()].flat()).size })).sort((p, q) => q.total - p.total || p.inv.localeCompare(q.inv)).slice(0, 22)
    const early = groups.map((g) => {
      const cs = list.filter((c) => of(c).id === g.id && c.t0 != null)
      const crowd = cs.length >= 4 ? Math.floor(median(cs.map((c) => c.t0!))!) : null
      const seen = new Set<string>(), firstIn: { inv: string; t: number; c: Co; type: string; date: string | null }[] = []
      for (const f of (firsts.get(g.id) ?? []).sort((p, q) => p.t - q.t)) if (!seen.has(f.inv)) { seen.add(f.inv); firstIn.push(f) }
      return { g, crowd, n: cs.length, firstIn: firstIn.slice(0, 7) }
    })
    return { matrix, early }
  }, [list, groups, of, mode])
  const maxCell = Math.max(1, ...matrix.flatMap((r) => [...r.row.values()].map((v) => v.length)))
  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <div><h2>Who backs which {unit}</h2><p>{mode === 'lead' ? 'Investors named as lead of a company’s first equity round.' : mode === 'first' ? 'Every investor named in a company’s first equity round.' : 'Every investor named in any sourced round.'} Cells count companies.</p></div>
          <Seg value={mode} set={setMode} options={[['lead', 'Led first round'], ['first', 'In first round'], ['any', 'Any round']]} />
        </div>
        {matrix.length === 0 ? <Empty what="No investors on record for this selection." /> : (
          <div className="scroll-x"><table className="tbl matrix">
            <thead><tr><th>Investor</th>{groups.map((g) => <th key={g.id} className="rot"><div><span><i className="sw" style={{ background: g.color }} />{g.name}</span></div></th>)}<th className="num">Companies</th></tr></thead>
            <tbody>{matrix.map(({ inv, row, total }) => <tr key={inv}><td>{inv}</td>{groups.map((g) => { const cs = row.get(g.id) ?? []; return <td key={g.id} className="cell" style={cs.length ? { background: `rgba(57,135,229,${0.2 + 0.7 * (cs.length / maxCell)})` } : undefined}
              onMouseMove={cs.length ? (e) => setTip({ x: e.clientX, y: e.clientY, body: <><b>{inv} · {g.name}</b><p>{cs.map((c) => c.name).join(', ')}</p></> }) : undefined} onMouseLeave={() => setTip(null)}>{cs.length || ''}</td> })}<td className="num">{total}</td></tr>)}</tbody>
          </table></div>
        )}
      </div>
      <div className="panel">
        <div className="panel-head"><div><h2>Who showed up early</h2><p>The first investors on record in each {unit}, in order of arrival. “Early” means before the year by which half of today’s companies in that {unit} had been founded.</p></div></div>
        <div className="early-grid">{early.map(({ g, crowd, firstIn, n }) => (
          <div key={g.id} className="early">
            <h3><i className="sw" style={{ background: g.color }} />{g.name}</h3>
            <p className="dim small">{n} companies{crowd ? ` · half founded by ${crowd}` : ''}</p>
            {firstIn.length ? <ul>{firstIn.map((f) => <li key={f.inv}><span className="yr">{Math.floor(f.t)}</span><span><b>{f.inv}</b>{crowd && f.t < crowd + 1 && <span className="tag early-tag">early</span>}<br /><span className="dim">{f.c.name} · {ROUND_LABEL[f.type] ?? f.type}</span></span></li>)}</ul> : <p className="dim small">No investors on record.</p>}
          </div>))}</div>
      </div>
      <Tip tip={tip} />
    </>
  )
}

// ---- 4. White space -----------------------------------------------------------------------------
function WhiteSpace({ list, groups, of, unit }: Ctx) {
  const [metric, setMetric] = useState<'count' | 'money'>('count'), [sel, setSel] = useState<{ g: string; r: string } | null>(null), [recent, setRecent] = useState(false)
  const src = recent ? list.filter((c) => c.t0 != null && c.t0 >= NOW - 5) : list
  const cell = (g: string, r: string) => src.filter((c) => of(c).id === g && c.region === r)
  const grid = groups.map((g) => REGION_NAMES.map((r) => { const cs = cell(g.id, r); return { cs, usd: cs.reduce((s, c) => s + (c.totalUsd ?? 0), 0) } }))
  const max = Math.max(1, ...grid.flat().map((c) => (metric === 'count' ? c.cs.length : c.usd)))
  const regions = REGION_NAMES.filter((r, i) => r !== 'Rest of world' || grid.some((row) => row[i].cs.length))
  const picked = sel ? cell(sel.g, sel.r) : []
  return (
    <div className="panel">
      <div className="panel-head">
        <div><h2>Where it is crowded and where it is empty</h2><p>{unit === 'domain' ? 'Domain' : 'Subsector'} by founding region. Dashed cells have no company in the atlas: either real white space or a gap in coverage, so check before you believe it.</p></div>
        <div className="head-controls"><label className="check"><input type="checkbox" checked={recent} onChange={(e) => setRecent(e.target.checked)} /> Founded in the last 5 years only</label><Seg value={metric} set={setMetric} options={[['count', 'Colour by companies'], ['money', 'Colour by money']]} /></div>
      </div>
      <div className="scroll-x"><table className="tbl ws">
        <thead><tr><th />{regions.map((r) => <th key={r}>{r}</th>)}<th className="num">Total</th></tr></thead>
        <tbody>{groups.map((g, gi) => <tr key={g.id}><th><i className="sw" style={{ background: g.color }} />{g.name}</th>
          {regions.map((r) => { const c = grid[gi][REGION_NAMES.indexOf(r)], v = metric === 'count' ? c.cs.length : c.usd, on = sel?.g === g.id && sel.r === r
            return <td key={r}>{c.cs.length ? <button className={`ws-cell ${on ? 'on' : ''}`} style={{ background: `rgba(57,135,229,${0.14 + 0.78 * Math.sqrt(v / max)})` }} onClick={() => setSel(on ? null : { g: g.id, r })} aria-label={`${g.name}, ${r}: ${c.cs.length} companies`}><b>{c.cs.length}</b><span>{c.usd ? fmtUsd(c.usd, true) : '$ unknown'}</span></button> : <div className="ws-cell empty-cell" aria-label={`${g.name}, ${r}: none`}>0</div>}</td> })}
          <td className="num">{grid[gi].reduce((s, c) => s + c.cs.length, 0)}</td></tr>)}
          <tr className="total"><th>Total</th>{regions.map((r) => <td key={r} className="num c">{src.filter((c) => c.region === r && groups.some((g) => g.id === of(c).id)).length}</td>)}<td className="num">{src.length}</td></tr>
        </tbody>
      </table></div>
      {sel && <div className="ws-list"><h3>{groups.find((g) => g.id === sel.g)?.name} · {sel.r}</h3><CoTable list={picked} /></div>}
      {!sel && <p className="dim small">Click a cell to list its companies. Money is the sum of sourced funding at indicative FX rates.</p>}
    </div>
  )
}
function CoTable({ list }: { list: Co[] }) {
  return <div className="scroll-x"><table className="tbl"><thead><tr><th>Company</th><th>Founded</th><th>Where</th><th className="num">Raised</th><th>Status</th><th>Wedge</th></tr></thead>
    <tbody>{[...list].sort((p, q) => (q.totalUsd ?? 0) - (p.totalUsd ?? 0)).map((c) => <tr key={c.id}><td><Name c={c} /></td><td>{fmtDate(c.founded.date)}</td><td>{c.hq.city ?? c.hq.country}</td><td className="num">{fmtUsd(c.totalUsd, c.totalPartial)}</td><td>{c.status}</td><td className="wrap">{c.wedge ?? <Unknown />}</td></tr>)}</tbody></table></div>
}

// ---- 5. Deaths & exits --------------------------------------------------------------------------
function Exits({ list, of }: Ctx) {
  const dead = list.filter((c) => c.status === 'dead').sort((p, q) => (q.tEnd ?? 0) - (p.tEnd ?? 0))
  const acq = list.filter((c) => c.status === 'acquired').sort((p, q) => (q.tEnd ?? 0) - (p.tEnd ?? 0))
  const pub = list.filter((c) => c.status === 'public').sort((p, q) => (q.tEnd ?? 0) - (p.tEnd ?? 0))
  const causes = Object.entries(CAUSE_LABEL).map(([k, name]) => ({ k, name, cs: dead.filter((c) => (c.statusEvent?.causeCategory ?? 'other') === k) })).filter((c) => c.cs.length).sort((p, q) => q.cs.length - p.cs.length)
  const maxC = Math.max(1, ...causes.map((c) => c.cs.length))
  const life = (c: Co) => (c.t0 != null && c.tEnd != null ? `${Math.max(0, c.tEnd - c.t0).toFixed(1)} yr` : '—')
  const acquirers = [...acq.reduce((m, c) => { const n = c.statusEvent?.acquirer?.name; if (n) m.set(n, [...(m.get(n) ?? []), c]); return m }, new Map<string, Co[]>())].filter(([, v]) => v.length > 1).sort((p, q) => q[1].length - p[1].length)
  return (
    <>
      <div className="stat-row">
        <div className="stat"><span>Still active</span><b>{list.filter((c) => c.status === 'active').length}</b><em>of {list.length} tracked</em></div>
        <div className="stat"><span>Acquired</span><b>{acq.length}</b><em>{acq.filter((c) => c.statusEvent?.amount).length} with a disclosed price</em></div>
        <div className="stat"><span>Went public</span><b>{pub.length}</b><em>IPO, SPAC or direct listing</em></div>
        <div className="stat"><span>Shut down</span><b>{dead.length}</b><em>median life {median(dead.filter((c) => c.t0 != null && c.tEnd != null).map((c) => c.tEnd! - c.t0!))?.toFixed(1) ?? '—'} yr</em></div>
      </div>
      <div className="panel">
        <div className="panel-head"><div><h2>What killed them</h2><p>Main cause as reported by the source for each shutdown. The atlas favours companies that mattered, so deaths are under-counted.</p></div></div>
        {dead.length === 0 ? <Empty what="No shutdowns on record here." /> : <>
          <div className="hbars">{causes.map((c) => <div key={c.k} className="hbar"><span>{c.name}</span><div><i style={{ width: `${(c.cs.length / maxC) * 100}%` }} /><b>{c.cs.length}</b></div><em>{c.cs.map((x) => x.name).join(', ')}</em></div>)}</div>
          <div className="scroll-x"><table className="tbl"><thead><tr><th>Company</th><th>Segment</th><th>Lived</th><th className="num">Raised</th><th>Cause</th><th>What happened</th></tr></thead>
            <tbody>{dead.map((c) => <tr key={c.id}><td><Name c={c} /></td><td>{of(c).name}</td><td>{fmtDate(c.founded.date)} – {fmtDate(c.statusEvent?.date)} <span className="dim">({life(c)})</span></td><td className="num">{fmtUsd(c.totalUsd, c.totalPartial)}</td><td>{c.statusEvent?.causeCategory ? CAUSE_LABEL[c.statusEvent.causeCategory] : <Unknown />}</td><td className="wrap">{c.statusEvent?.note ?? <Unknown />} {c.statusEvent?.source && <a className="src" href={c.statusEvent.source} target="_blank" rel="noreferrer">source</a>}</td></tr>)}</tbody></table></div></>}
      </div>
      <div className="panel">
        <div className="panel-head"><div><h2>Who acquired whom</h2><p>{acquirers.length ? <>Repeat acquirers: {acquirers.map(([n, v]) => `${n} (${v.length})`).join(', ')}.</> : 'Acquisitions of tracked companies, newest first.'}</p></div></div>
        {acq.length === 0 ? <Empty what="No acquisitions on record here." /> :
          <div className="scroll-x"><table className="tbl"><thead><tr><th>Company</th><th>Segment</th><th>Acquirer</th><th>Date</th><th className="num">Price</th><th className="num">Raised before</th><th className="num">Age at exit</th><th>Notes</th></tr></thead>
            <tbody>{acq.map((c) => <tr key={c.id}><td><Name c={c} /></td><td>{of(c).name}</td><td>{c.statusEvent?.acquirer?.name ?? <Unknown />}</td><td>{fmtDate(c.statusEvent?.date)}</td><td className="num">{c.statusEvent?.amount ? fmtMoney(c.statusEvent.amount) : <span className="unknown">undisclosed</span>}</td><td className="num">{fmtUsd(c.totalUsd, c.totalPartial)}</td><td className="num">{life(c)}</td><td className="wrap">{c.statusEvent?.note ?? ''} {c.statusEvent?.source && <a className="src" href={c.statusEvent.source} target="_blank" rel="noreferrer">source</a>}</td></tr>)}</tbody></table></div>}
      </div>
      {pub.length > 0 && <div className="panel">
        <div className="panel-head"><div><h2>Public listings</h2></div></div>
        <div className="scroll-x"><table className="tbl"><thead><tr><th>Company</th><th>Segment</th><th>Route</th><th>Date</th><th className="num">Raised privately</th><th className="num">Age at listing</th><th>Notes</th></tr></thead>
          <tbody>{pub.map((c) => <tr key={c.id}><td><Name c={c} /></td><td>{of(c).name}</td><td>{c.statusEvent?.type?.toUpperCase() ?? <Unknown />}</td><td>{fmtDate(c.statusEvent?.date)}</td><td className="num">{fmtUsd(c.totalUsd, c.totalPartial)}</td><td className="num">{life(c)}</td><td className="wrap">{c.statusEvent?.note ?? ''} {c.statusEvent?.source && <a className="src" href={c.statusEvent.source} target="_blank" rel="noreferrer">source</a>}</td></tr>)}</tbody></table></div>
      </div>}
    </>
  )
}

// ---- 6. Starred & notes -------------------------------------------------------------------------
function Starred({ list }: Ctx) {
  const { stars, notes } = useAtlas()
  const mine = list.filter((c) => stars.has(c.id) || notes[c.id])
  if (!mine.length) return <Empty what="Nothing starred yet. Open a company and press the star, or write a note in its dossier." />
  return <div className="panel"><div className="panel-head"><div><h2>Starred companies and notes</h2><p>Stored locally in data/user/annotations.json.</p></div></div>
    <div className="scroll-x"><table className="tbl"><thead><tr><th /><th>Company</th><th>Founded</th><th className="num">Raised</th><th>Wedge</th><th>My note</th></tr></thead>
      <tbody>{mine.map((c) => <tr key={c.id}><td>{stars.has(c.id) ? '★' : ''}</td><td><Name c={c} /></td><td>{fmtDate(c.founded.date)}</td><td className="num">{fmtUsd(c.totalUsd, c.totalPartial)}</td><td className="wrap">{c.wedge ?? <Unknown />}</td><td className="wrap">{notes[c.id] ?? ''}</td></tr>)}</tbody></table></div></div>
}
