import { useEffect, useRef } from 'react'
import { GlobeEngine, type ArcDatum, type PointDatum } from './engine'
import { appearT, raisedAt, type Co, type Group } from '../lib/model'

let engine: GlobeEngine | null = null
export const getEngine = () => engine

/** Fixed full-window canvas behind the UI. Views place globes by rendering <div data-globe-slot="domain-id">. */
export function Stage({ domains }: { domains: { id: string; color: string }[] }) {
  const canvas = useRef<HTMLCanvasElement>(null), labels = useRef<HTMLDivElement>(null), stars = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    engine = new GlobeEngine(canvas.current!, labels.current!)
    const cv = stars.current!, dpr = Math.min(2, devicePixelRatio)
    const draw = () => {
      cv.width = innerWidth * dpr; cv.height = innerHeight * dpr
      const ctx = cv.getContext('2d')!; let s = 7
      const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
      for (let i = 0; i < 420; i++) { const r = rnd(); ctx.fillStyle = `rgba(${190 + rnd() * 60},${205 + rnd() * 40},255,${0.08 + r * r * 0.5})`; ctx.beginPath(); ctx.arc(rnd() * cv.width, rnd() * cv.height, (0.3 + r * r * 0.9) * dpr, 0, 7); ctx.fill() }
    }
    draw(); window.addEventListener('resize', draw)
    return () => { window.removeEventListener('resize', draw); engine?.dispose(); engine = null }
  }, [])
  useEffect(() => { domains.forEach((d, i) => engine?.ensure(d.id, d.color, i)); engine?.prune(new Set(domains.map((d) => d.id))) }, [domains])
  return (<>
    <canvas ref={stars} className="stage stars" aria-hidden />
    <canvas ref={canvas} className="stage" aria-hidden />
    <div ref={labels} className="label-layer" aria-hidden />
  </>)
}

const sizeFor = (usd: number | null) => 5 + 3.3 * Math.log10(1 + (usd ?? 0) / 1e6)

/** Turns companies into glowing points and acquisition arcs for time t. */
export function buildScene(list: Co[], t: number, groupOf: (c: Co) => Group, glow: (g: Group) => string, visible: (c: Co) => boolean, opts: { labels: boolean; starred?: Set<string> }) {
  const points: PointDatum[] = [], arcs: ArcDatum[] = []
  for (const c of list) {
    const age = t - appearT(c), show = age >= 0 && c.located && visible(c)
    const color = glow(groupOf(c))
    let alpha = show ? 1 : 0, shape: PointDatum['shape'] = 0, size = sizeFor(raisedAt(c, t)), col = color
    if (show) {
      size *= 1 + 1.7 * Math.exp(-age * 6)                                       // birth pulse
      for (const r of c.rT) if (r.t != null && r.t <= t && t - r.t < 0.5) size *= 1 + 0.45 * Math.exp(-(t - r.t) * 9)   // funding flash
      const ended = c.tEnd != null ? t - c.tEnd : c.status !== 'active' && c.tEnd == null ? 0.0001 : -1
      if (ended >= 0) {
        if (c.status === 'dead') { shape = 3; col = '#8a93a3'; alpha = Math.max(0.3, 1 - ended * 0.9) }
        else if (c.status === 'acquired') { shape = 1; alpha = 0.85 }
        else if (c.status === 'public') shape = 2
        const a = c.statusEvent?.acquirer
        if (c.status === 'acquired' && a?.lat != null && a?.lon != null && (Math.abs(a.lat - c.jLat) > 0.3 || Math.abs(a.lon - c.jLon) > 0.3)) {
          const p = Math.min(1, ended / 0.5)
          arcs.push({ id: c.id, from: [c.jLat, c.jLon], to: [a.lat, a.lon], color, progress: p, alpha: p < 1 ? 0.95 : Math.max(0.3, 0.95 - (ended - 0.5) * 0.35) })
        }
      }
    }
    points.push({ id: c.id, lat: c.jLat, lon: c.jLon, color: col, size, alpha, shape, hollow: c.unverified, label: opts.labels ? (opts.starred?.has(c.id) ? '★ ' : '') + c.name : undefined })
  }
  return { points, arcs }
}
