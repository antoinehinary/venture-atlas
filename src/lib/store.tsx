import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { derive, type AtlasEvent, type Co, type Company, type Taxonomy } from './model'

export type Route = { view: 'home' } | { view: 'domain'; domain: string; tab: string } | { view: 'patterns'; tab: string } | { view: 'queue' }
export type FactCheck = { key: string; claim: string; verdict: 'confirmed' | 'corrected' | 'unsupported' | 'unreachable'; reason: string; quote: string | null; source: string | null; tier: string | null }
export type AiStatus = { available: boolean; provider: string; model: string | null; search: string | null; problem: string | null }
export type QueueItem = { verification?: null | { summary: { checked: number; confirmed: number; corrected: number; removed: number; unconfirmed: number }; results: FactCheck[] }; id: string; kind: 'new' | 'update'; existingId: string | null; record: Company; diff: string[]; problems: string[]; createdAt: string; notes: string | null }
export type JobLine = { t: number; level: 'info' | 'note' | 'error' | 'done'; text: string }
export type Job = { id: string; title: string; state: 'running' | 'done' | 'failed' | 'cancelled'; log: JobLine[]; queued: number; merged: number }

type Atlas = {
  loading: boolean; error: string | null
  tax: Taxonomy; companies: Co[]; byId: Map<string, Co>; byName: Map<string, Co>; events: AtlasEvent[]
  meta: { lastRefresh: Record<string, string>; ai: AiStatus }
  reload: () => Promise<void>
  stars: Set<string>; notes: Record<string, string>; toggleStar: (id: string) => void; setNote: (id: string, text: string) => void
  selected: Co | null; select: (id: string | null) => void
  route: Route; go: (hash: string) => void
  job: Job | null; startJob: (body: { type: 'refresh' | 'add'; domain?: string; query?: string }, title: string) => Promise<void>; dismissJob: () => void; cancelJob: () => void
  queue: QueueItem[]; refreshQueue: () => Promise<void>; resolve: (id: string, action: 'approve' | 'reject' | 'verify') => Promise<string | null>
}
const Ctx = createContext<Atlas>(null as unknown as Atlas)
export const useAtlas = () => useContext(Ctx)

function parseRoute(): Route {
  const p = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  if (p[0] === 'd' && p[1]) return { view: 'domain', domain: p[1], tab: p[2] || 'globe' }
  if (p[0] === 'patterns') return { view: 'patterns', tab: p[1] || 'waves' }
  if (p[0] === 'queue') return { view: 'queue' }
  return { view: 'home' }
}
const api = async (url: string, init?: RequestInit) => {
  const r = await fetch(url, init && { ...init, headers: { 'Content-Type': 'application/json' } })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || `${r.status} ${r.statusText}`)
  return j
}
const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

export function AtlasProvider({ children }: { children: ReactNode }) {
  const [raw, setRaw] = useState<{ tax: Taxonomy; companies: Company[]; events: AtlasEvent[]; meta: Atlas['meta'] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [user, setUser] = useState<{ stars: string[]; notes: Record<string, string> }>({ stars: [], notes: {} })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [route, setRoute] = useState<Route>(parseRoute)
  const [job, setJob] = useState<Job | null>(null)
  const [queue, setQueue] = useState<QueueItem[]>([])
  const es = useRef<EventSource | null>(null)
  const saveTimer = useRef<number>(0)

  const reload = useCallback(async () => {
    try { const d = await api('/api/data'); setRaw({ tax: d.taxonomy, companies: d.companies, events: d.events, meta: d.meta }); setError(null) } catch (e) { setError((e as Error).message) }
  }, [])
  const refreshQueue = useCallback(async () => { try { setQueue(await api('/api/queue')) } catch { /* server offline */ } }, [])
  useEffect(() => {
    reload(); refreshQueue()
    api('/api/user').then(setUser).catch(() => { try { const l = localStorage.getItem('atlas-user'); if (l) setUser(JSON.parse(l)) } catch { /* ignore */ } })
    const on = () => { setRoute(parseRoute()); setSelectedId(null) }
    window.addEventListener('hashchange', on); return () => window.removeEventListener('hashchange', on)
  }, [reload, refreshQueue])

  // Stars and notes are written to data/user/annotations.json by the server (debounced), with localStorage as a fallback copy.
  const persist = useCallback((u: typeof user) => {
    setUser(u)
    try { localStorage.setItem('atlas-user', JSON.stringify(u)) } catch { /* ignore */ }
    clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => { api('/api/user', { method: 'PUT', body: JSON.stringify(u) }).catch(() => {}) }, 400)
  }, [])
  const toggleStar = useCallback((id: string) => persist({ ...user, stars: user.stars.includes(id) ? user.stars.filter((s) => s !== id) : [...user.stars, id] }), [user, persist])
  const setNote = useCallback((id: string, text: string) => { const notes = { ...user.notes }; if (text.trim()) notes[id] = text; else delete notes[id]; persist({ ...user, notes }) }, [user, persist])

  const startJob = useCallback(async (body: { type: 'refresh' | 'add'; domain?: string; query?: string }, title: string) => {
    es.current?.close()
    try {
      const { id } = await api('/api/jobs', { method: 'POST', body: JSON.stringify(body) })
      setJob({ id, title, state: 'running', log: [], queued: 0, merged: 0 })
      const src = new EventSource(`/api/jobs/${id}/stream`); es.current = src
      src.onmessage = (m) => {
        const ev = JSON.parse(m.data)
        if (ev.type === 'log' && ev.line.text.startsWith('✓ added to the atlas')) reload()
        if (ev.type === 'log') setJob((j) => (j && j.id === id ? { ...j, log: j.log.some((l) => l.t === ev.line.t && l.text === ev.line.text) ? j.log : [...j.log, ev.line] } : j))
        if (ev.type === 'done') { setJob((j) => (j && j.id === id ? { ...j, state: ev.state, queued: ev.queued, merged: ev.merged ?? 0 } : j)); src.close(); refreshQueue(); reload() }
      }
      src.onerror = () => { /* EventSource retries on its own; the server replays the log */ }
    } catch (e) { setJob({ id: 'x', title, state: 'failed', log: [{ t: Date.now(), level: 'error', text: (e as Error).message }], queued: 0, merged: 0 }) }
  }, [refreshQueue, reload])
  const cancelJob = useCallback(() => { if (job?.state === 'running') api(`/api/jobs/${job.id}/cancel`, { method: 'POST' }).catch(() => {}) }, [job])
  const resolve = useCallback(async (id: string, action: 'approve' | 'reject' | 'verify') => {
    try { await api(`/api/queue/${id}/${action}`, { method: 'POST' }); await Promise.all([refreshQueue(), reload()]); return null } catch (e) { return (e as Error).message }
  }, [refreshQueue, reload])

  const derived = useMemo(() => {
    const companies = raw ? derive(raw.companies) : []
    const byName = new Map<string, Co>()
    for (const c of companies) for (const n of [c.name, ...(c.aliases ?? [])]) byName.set(normName(n), c)
    return { companies, byId: new Map(companies.map((c) => [c.id, c])), byName }
  }, [raw])

  const value: Atlas = {
    loading: !raw && !error, error, tax: raw?.tax ?? { domains: [] }, ...derived, events: raw?.events ?? [], meta: raw?.meta ?? { lastRefresh: {}, ai: { available: false, provider: '', model: null, search: null, problem: 'server not reachable' } }, reload,
    stars: useMemo(() => new Set(user.stars), [user.stars]), notes: user.notes, toggleStar, setNote,
    selected: selectedId ? derived.byId.get(selectedId) ?? null : null, select: setSelectedId,
    route, go: (h) => { location.hash = h },
    job, startJob, dismissJob: () => { es.current?.close(); setJob(null) }, cancelJob, queue, refreshQueue, resolve,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
export const findByName = (byName: Map<string, Co>, name: string) => byName.get(normName(name)) ?? null
