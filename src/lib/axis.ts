// Width-aware chart helpers: pick year labels that fit, and lay out event markers without overlaps, from a phone to a wide screen.
import { useEffect, useRef, useState } from 'react'

/** Width of an element, kept up to date (rotation, split view, window resize). */
export function useWidth() {
  const ref = useRef<HTMLDivElement>(null), [w, setW] = useState(900)
  useEffect(() => { const el = ref.current!; const ro = new ResizeObserver(() => setW(el.clientWidth)); ro.observe(el); setW(el.clientWidth); return () => ro.disconnect() }, [])
  return [ref, w] as const
}

export type YearAxis = { step: number; rotate: boolean; height: number; show: (yr: number) => boolean }

/**
 * How to label a year axis spanning [y0, y1] over `px` pixels:
 * every year or every other year flat if they fit, then every other year slanted (narrow phones),
 * then every 5 years flat, then every 5 or 10 slanted. `height` is the space the labels need under the axis.
 */
export function yearAxis(y0: number, y1: number, px: number, { canRotate = true } = {}): YearAxis {
  const per = px / Math.max(1, y1 - y0) // pixels per year
  const FLAT = 34, SLANT = 15 // "2024" set flat needs ~30px plus a gap; slanted labels only need their line height
  const mk = (step: number, rotate: boolean): YearAxis => ({ step, rotate, height: rotate ? 38 : 20, show: (yr) => yr % step === 0 })
  if (per >= FLAT) return mk(1, false)
  if (per * 2 >= FLAT) return mk(2, false)
  if (canRotate && per * 2 >= SLANT) return mk(2, true)
  if (per * 5 >= FLAT) return mk(5, false)
  if (canRotate) return mk(per * 5 >= SLANT ? 5 : 10, true)
  return mk(10, false)
}

export type Marker = { left: number; width: number; row: number; ids: number[]; label: string }

/**
 * Places numbered event markers (circles, `size` px wide) in `rows` staggered rows. An event that would overlap every row
 * joins the marker before it, which then reads "12–15" (or "12 +3" when the numbers are not consecutive).
 * `xs` must be in increasing order; ids are the event numbers shown.
 */
export function placeMarkers(xs: { x: number; id: number }[], { rows = 2, size = 18, gap = 3, minX = -Infinity, maxX = Infinity } = {}): Marker[] {
  const right = Array<number>(rows).fill(-Infinity)
  const out: Marker[] = []
  const labelOf = (ids: number[]) => ids.length === 1 ? String(ids[0]) : ids.every((v, i) => i === 0 || v === ids[i - 1] + 1) ? `${ids[0]}–${ids[ids.length - 1]}` : `${ids[0]} +${ids.length - 1}`
  const widthOf = (label: string) => Math.max(size, label.length * 6.6 + 10)
  for (const { x, id } of xs) {
    const left = Math.max(minX, Math.min(maxX - size, x - size / 2))
    const row = right.findIndex((r) => left >= r + gap)
    if (row >= 0 || out.length === 0) {
      const r = Math.max(0, row)
      out.push({ left, width: size, row: r, ids: [id], label: String(id) }); right[r] = left + size
    } else {
      const m = out[out.length - 1]
      m.ids.push(id); m.label = labelOf(m.ids); m.width = widthOf(m.label)
      m.left = Math.max(minX, Math.min(m.left, maxX - m.width)); right[m.row] = m.left + m.width
    }
  }
  return out
}
