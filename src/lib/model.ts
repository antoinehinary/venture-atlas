// Types mirroring data/schema/*.json plus the derived fields the UI needs.
export type Money = { value: number; currency: string } | null
export type Check = 'confirmed' | 'unreachable' | null
export type Round = { check?: Check; checkNote?: string | null; date: string | null; type: string; label?: string | null; amount: Money; valuation?: Money; leads: string[]; investors: string[]; source: string }
export type Company = {
  id: string; name: string; aliases?: string[]; website?: string | null; pitch: string
  domains: string[]; subsectors: string[]
  founded: { date: string | null; source: string | null; check?: Check; checkNote?: string | null }
  hq: { city: string | null; country: string; lat: number | null; lon: number | null }
  status: 'active' | 'acquired' | 'public' | 'dead'
  statusEvent?: null | { check?: Check; checkNote?: string | null; type: string; date: string | null; amount?: Money; acquirer?: null | { name: string; city?: string | null; country?: string | null; lat?: number | null; lon?: number | null }; causeCategory?: string | null; note?: string | null; source: string | null }
  story?: string | null; founders?: { name: string; role?: string | null; background?: string | null }[]
  product?: string | null; wedge?: string | null; became?: string | null; differentiator?: string | null; competitors?: string[]
  rounds: Round[]
  totalRaised?: null | { check?: Check; checkNote?: string | null; value: number; currency: string; asOf?: string | null; source: string }
  firstRaiseEvidence?: null | { kind: string; note?: string | null; source?: string | null }
  firstCustomers?: { name: string; date?: string | null; note?: string | null; source?: string | null }[]
  sources: { url: string; title?: string | null }[]
  confidence: 'high' | 'medium' | 'low'; lastVerified: string | null
}
export type AtlasEvent = { id: string; date: string; title: string; detail?: string | null; kind: string; domains: string[]; source: string }
export type Subsector = { id: string; name: string; description: string; enabled: boolean }
export type Domain = { id: string; name: string; tagline: string; color: string; subsectors: Subsector[] }
export type Taxonomy = { domains: Domain[] }
export type Group = { id: string; name: string; color: string }

/** Derived, read-only view of a company. */
export type Co = Company & {
  t0: number | null           // founding time as fractional year
  tEnd: number | null         // acquisition / listing / shutdown time
  rT: { t: number | null; usd: number | null; r: Round }[]
  sumUsd: number | null       // sum of rounds with known amounts
  totalUsd: number | null     // reported total if stated, else sum of known rounds
  totalPartial: boolean       // true when totalUsd is only a sum of the rounds we could source
  first: { t: number | null; usd: number | null; r: Round } | null   // first equity round
  monthsToFirst: number | null
  stage: string; region: string; unverified: boolean
  located: boolean; jLat: number; jLon: number  // display position (jittered so co-located companies do not stack)
}

export const T_START = 2000
export const NOW = (() => { const d = new Date(); return d.getFullYear() + (d.getMonth() + d.getDate() / 31) / 12 })()

/** Validated categorical palette (dataviz validator, dark surface): fixed order, never cycled. */
export const PALETTE = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767', '#00a3b8', '#b0692f']
/** Brighter steps of the same hues for glowing points on the globe (additive light, not chart fills). */
export const GLOW = ['#5aa2ff', '#ff7a45', '#2fd39a', '#f5b322', '#ff6fa3', '#3fc63f', '#aaa0ff', '#ff8585', '#22cfe6', '#dd8b4a']

// Indicative FX rates used ONLY to aggregate across currencies. Dossiers always show the amount as sourced.
export const FX: Record<string, number> = { USD: 1, EUR: 1.08, GBP: 1.27, CHF: 1.13, SEK: 0.095, NOK: 0.093, DKK: 0.145, PLN: 0.25, CZK: 0.043, JPY: 0.0067, CNY: 0.14, KRW: 0.00073, INR: 0.012, CAD: 0.73, AUD: 0.66, NZD: 0.6, SGD: 0.75, ILS: 0.27, HKD: 0.128, TWD: 0.031, BRL: 0.18, TRY: 0.03, UAH: 0.024 }
export const toUsd = (m: Money | undefined) => (m && FX[m.currency] ? m.value * FX[m.currency] : null)

export function toT(date: string | null | undefined): number | null {
  if (!date) return null
  const [y, m, d] = date.split('-').map(Number)
  return y + (m ? (m - 1 + (d ? (d - 1) / 31 : 0.5)) / 12 : 0.5)
}
export const fmtDate = (d: string | null | undefined) => {
  if (!d) return 'unknown'
  const [y, m, day] = d.split('-')
  const mo = m ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m) - 1] : null
  return day ? `${Number(day)} ${mo} ${y}` : mo ? `${mo} ${y}` : y
}
const SYM: Record<string, string> = { USD: '$', EUR: '€', GBP: '£', JPY: '¥', INR: '₹', ILS: '₪' }
const compact = (v: number) => (v >= 1e9 ? `${+(v / 1e9).toFixed(v >= 1e10 ? 0 : 1)}B` : v >= 1e6 ? `${+(v / 1e6).toFixed(v >= 1e8 ? 0 : 1)}M` : v >= 1e3 ? `${+(v / 1e3).toFixed(0)}K` : String(Math.round(v)))
export const fmtMoney = (m: Money | undefined) => (m ? (SYM[m.currency] ? `${SYM[m.currency]}${compact(m.value)}` : `${compact(m.value)} ${m.currency}`) : 'unknown')
export const fmtUsd = (v: number | null | undefined, approx = false) => (v == null ? 'unknown' : `${approx ? '≈' : ''}$${compact(v)}`)
export const fmtMonths = (m: number | null) => (m == null ? 'unknown' : m < 24 ? `${Math.round(m)} mo` : `${(m / 12).toFixed(1)} yr`)

const REGIONS: [string, string[]][] = [
  ['North America', ['US', 'CA', 'MX']],
  ['UK & Ireland', ['GB', 'IE', 'JE', 'GG', 'IM']],
  ['DACH', ['DE', 'AT', 'CH', 'LI']],
  ['France & Benelux', ['FR', 'BE', 'NL', 'LU', 'MC']],
  ['Nordics & Baltics', ['SE', 'NO', 'DK', 'FI', 'IS', 'EE', 'LV', 'LT']],
  ['Southern Europe', ['ES', 'PT', 'IT', 'GR', 'MT', 'CY', 'HR', 'SI']],
  ['Central & Eastern Europe', ['PL', 'CZ', 'SK', 'HU', 'RO', 'BG', 'UA', 'RS', 'MD', 'BA', 'AL', 'MK', 'GE']],
  ['Israel & Middle East', ['IL', 'AE', 'SA', 'TR', 'QA', 'JO', 'EG']],
  ['Asia-Pacific', ['JP', 'CN', 'KR', 'IN', 'SG', 'AU', 'NZ', 'TW', 'HK', 'ID', 'VN', 'TH', 'MY', 'PH']],
]
export const REGION_NAMES = [...REGIONS.map((r) => r[0]), 'Rest of world']
export const EUROPE = new Set(REGIONS.slice(1, 7).flatMap((r) => r[1]))
export const regionOf = (cc: string) => REGIONS.find((r) => r[1].includes(cc))?.[0] ?? 'Rest of world'
let regionNames: Intl.DisplayNames | null = null
export const countryName = (cc: string) => { try { regionNames ??= new Intl.DisplayNames(['en'], { type: 'region' }); return regionNames.of(cc) ?? cc } catch { return cc } }

export const STAGES = ['Grant / none', 'Pre-seed & seed', 'Series A', 'Series B', 'Series C+', 'Other / undisclosed']
const EQUITY = new Set(['pre-seed', 'seed', 'series-a', 'series-b', 'series-c', 'series-d', 'series-e', 'series-f+', 'growth', 'venture', 'strategic', 'unknown'])
function stageOf(c: Company) {
  const types = c.rounds.map((r) => r.type)
  if (types.some((t) => ['series-c', 'series-d', 'series-e', 'series-f+', 'growth'].includes(t))) return 'Series C+'
  if (types.includes('series-b')) return 'Series B'
  if (types.includes('series-a')) return 'Series A'
  if (types.includes('seed') || types.includes('pre-seed')) return 'Pre-seed & seed'
  if (types.some((t) => EQUITY.has(t))) return 'Other / undisclosed'
  return 'Grant / none'
}
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0) / 4294967295 }

export function derive(list: Company[]): Co[] {
  // companies sharing a city are fanned out on a small spiral so each one stays visible and clickable
  const byPlace = new Map<string, number>()
  return [...list].sort((a, b) => (a.founded.date ?? '9').localeCompare(b.founded.date ?? '9')).map((c) => {
    const rT = c.rounds.map((r) => ({ t: toT(r.date), usd: toUsd(r.amount), r })).sort((a, b) => (a.t ?? 9999) - (b.t ?? 9999))
    const known = rT.filter((r) => r.usd != null)
    const sumUsd = known.length ? known.reduce((s, r) => s + r.usd!, 0) : null
    const reported = c.totalRaised ? toUsd(c.totalRaised) : null
    const totalUsd = reported != null && sumUsd != null ? Math.max(reported, sumUsd) : reported ?? sumUsd
    const first = rT.find((r) => EQUITY.has(r.r.type) && r.t != null) ?? null
    const t0 = toT(c.founded.date)
    const months = t0 != null && first?.t != null ? Math.max(0, (first.t - t0) * 12) : null
    const lat = c.hq.lat ?? 0, lon = c.hq.lon ?? 0, located = c.hq.lat != null && c.hq.lon != null
    const key = `${lat.toFixed(1)},${lon.toFixed(1)}`, k = byPlace.get(key) ?? 0; byPlace.set(key, k + 1)
    const ang = k * 2.4 + hash(c.id) * 0.5, rad = k === 0 ? 0 : 0.55 * Math.sqrt(k)
    return {
      ...c, t0, tEnd: c.status === 'active' ? null : toT(c.statusEvent?.date), rT, sumUsd, totalUsd, totalPartial: reported == null && sumUsd != null,
      first, monthsToFirst: c.founded.date && c.founded.date.length >= 7 && first?.r.date && first.r.date.length >= 7 ? months : months != null && months >= 12 ? months : null,
      stage: stageOf(c), region: regionOf(c.hq.country), unverified: !c.lastVerified || c.confidence === 'low',
      located, jLat: lat + Math.sin(ang) * rad, jLon: lon + (Math.cos(ang) * rad) / Math.max(0.3, Math.cos((lat * Math.PI) / 180)),
    }
  })
}

/** Money raised by time t (fractional year). Falls back to the reported total once t passes its as-of date. */
export function raisedAt(c: Co, t: number): number | null {
  let s = 0, any = false
  for (const r of c.rT) if (r.usd != null && (r.t ?? Infinity) <= t) { s += r.usd; any = true }
  if (c.totalRaised) { const asOf = toT(c.totalRaised.asOf) ?? NOW - 0.25; const rep = toUsd(c.totalRaised); if (rep != null && t >= asOf && rep > s) return rep }
  return any ? s : null
}
/** Is the company visible at time t? Companies with no founding date appear with their first dated fact. */
export const appearT = (c: Co) => c.t0 ?? c.rT.find((r) => r.t != null)?.t ?? T_START

export function groupFor(tax: Taxonomy, domainId: string | null) {
  if (!domainId) {
    const groups: Group[] = tax.domains.map((d) => ({ id: d.id, name: d.name, color: d.color }))
    return { groups, of: (c: Co) => groups.find((g) => g.id === c.domains[0]) ?? groups[0], glow: (g: Group) => g.color }
  }
  const dom = tax.domains.find((d) => d.id === domainId)!
  const subs = dom.subsectors.filter((s) => s.enabled !== false)
  const groups: Group[] = subs.map((s, i) => ({ id: s.id, name: s.name, color: PALETTE[i % PALETTE.length] }))
  const other: Group = { id: `${domainId}/other`, name: 'Other', color: '#6b7686' }
  const glowBy = new Map(groups.map((g, i) => [g.id, GLOW[i % GLOW.length]]))
  return {
    groups,
    of: (c: Co) => { const s = c.subsectors.find((x) => x.startsWith(domainId + '/')); return groups.find((g) => g.id === s) ?? other },
    glow: (g: Group) => glowBy.get(g.id) ?? '#8b97a8',
  }
}
export const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
export const CAUSE_LABEL: Record<string, string> = { 'ran-out-of-cash': 'Ran out of cash', 'no-market': 'No market', 'technology-failed': 'Technology failed', outcompeted: 'Outcompeted', regulatory: 'Regulatory', 'customer-concentration': 'Customer concentration', 'unit-economics': 'Unit economics', 'founder-conflict': 'Founder conflict', macro: 'Macro / funding climate', other: 'Other' }
export const ROUND_LABEL: Record<string, string> = { grant: 'Grant', 'pre-seed': 'Pre-seed', seed: 'Seed', 'series-a': 'Series A', 'series-b': 'Series B', 'series-c': 'Series C', 'series-d': 'Series D', 'series-e': 'Series E', 'series-f+': 'Series F+', growth: 'Growth', venture: 'Venture', debt: 'Debt', strategic: 'Strategic', ipo: 'IPO', contract: 'Contract', unknown: 'Round' }
export const normInvestor = (s: string) => s.trim().replace(/\s+/g, ' ').replace(/^a16z$/i, 'Andreessen Horowitz').replace(/^Andreessen Horowitz \(a16z\)$/i, 'Andreessen Horowitz')
