import { useEffect, useMemo } from 'react'
import { useAtlas } from '../lib/store'
import { buildScene, getEngine } from '../globe/Stage'
import { NOW, fmtUsd, groupFor, EUROPE, countWord } from '../lib/model'
import { RefreshControls } from './Refresh'
import { AddFieldTile } from './Fields'

export function Home() {
  const { tax, companies, go, meta } = useAtlas()
  const stats = useMemo(() => tax.domains.map((d) => {
    const list = companies.filter((c) => c.domains.includes(d.id))
    const known = list.filter((c) => c.totalUsd != null)
    const newest = [...list].filter((c) => c.t0 != null).sort((a, b) => b.t0! - a.t0!).slice(0, 3)
    return { d, list, total: known.reduce((s, c) => s + c.totalUsd!, 0), unknown: list.length - known.length, newest, europe: list.filter((c) => EUROPE.has(c.hq.country)).length }
  }), [tax, companies])

  useEffect(() => {
    // rAF so the stage effect (which creates the engine and its globes) has run first
    const id = requestAnimationFrame(() => {
      for (const s of stats) {
        const g = groupFor(tax, s.d.id)
        const { points, arcs } = buildScene(s.list, NOW, g.of, g.glow, () => true, { labels: false })
        getEngine()?.setPoints(s.d.id, points); getEngine()?.setArcs(s.d.id, arcs.map((a) => ({ ...a, alpha: 0.35 })))
      }
    })
    return () => cancelAnimationFrame(id)
  }, [stats, tax])

  const total = companies.length
  return (
    <main className="home">
      <div className="home-intro">
        <h1>How {countWord(stats.length)} field{stats.length === 1 ? ' was' : 's were'} built, company by company.</h1>
        <p>{total} companies tracked. Pick a globe to replay its history, or compare them all in <a href="#/patterns">cross-domain patterns</a>.</p>
      </div>
      <div className={`home-grid n${Math.min(stats.length + 1, 9)}`}>
        {stats.map(({ d, list, total, unknown, newest, europe }) => (
          <section key={d.id} className="home-cell" style={{ '--accent': d.color } as React.CSSProperties}>
            <button className="globe-slot" data-globe-slot={d.id} onClick={() => go(`#/d/${d.id}`)} aria-label={`Open ${d.name}`} />
            <div className="home-meta">
              <a className="home-name" href={`#/d/${d.id}`}><h2>{d.name}</h2><span>{d.tagline}</span></a>
              <dl className="home-stats">
                <div><dt>Companies</dt><dd>{list.length}</dd></div>
                <div><dt>In Europe</dt><dd>{europe}</dd></div>
                <div title={unknown ? `Sum of sourced funding, indicative FX. ${unknown} compan${unknown > 1 ? 'ies have' : 'y has'} no sourced figure.` : 'Sum of sourced funding at indicative FX rates'}><dt>Raised</dt><dd>{list.length ? fmtUsd(total, true) : 'unknown'}</dd></div>
              </dl>
              <p className="home-newest">{newest.length ? <>Newest: {newest.map((c, i) => <span key={c.id}>{i > 0 && ', '}{c.name} <i>{c.founded.date?.slice(0, 4)}</i></span>)}</> : 'Empty globe: press “Fetch latest” to research and verify companies.'}</p>
              <RefreshControls domainId={d.id} domainName={d.name} lastRefresh={meta.lastRefresh?.[d.id]} compact />
            </div>
          </section>
        ))}
        <AddFieldTile />
      </div>
    </main>
  )
}
