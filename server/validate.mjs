// Shared validation for company and event records (used by the server, the scripts and the refresh pipeline).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv from 'ajv'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// ATLAS_DATA_DIR lets tests (or a second atlas) point at another data folder.
export const DATA = process.env.ATLAS_DATA_DIR ? path.resolve(process.env.ATLAS_DATA_DIR) : path.join(ROOT, 'data')
export const readJson = (p, fallback) => {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch (e) { if (fallback !== undefined) return fallback; throw e }
}
export const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n') }

const ajv = new Ajv({ allErrors: true, strict: false })
const companySchema = readJson(path.join(DATA, 'schema/company.schema.json'))
const eventSchema = readJson(path.join(DATA, 'schema/event.schema.json'))
const vCompany = ajv.compile(companySchema)
const vEvent = ajv.compile(eventSchema)

export const taxonomy = () => readJson(path.join(DATA, 'taxonomy.json'))
const subsectorIds = () => new Set(taxonomy().domains.flatMap((d) => d.subsectors.map((s) => s.id)))

const fmt = (errors) => (errors || []).map((e) => `${e.instancePath || '/'} ${e.message}${e.params?.allowedValues ? ' ' + JSON.stringify(e.params.allowedValues) : ''}${e.params?.additionalProperty ? ' "' + e.params.additionalProperty + '"' : ''}`)

/** Returns a list of human-readable problems; empty means valid. */
export function validateCompany(c) {
  if (!vCompany(c)) return fmt(vCompany.errors)
  const errs = []
  const subs = subsectorIds()
  const fields = new Set(taxonomy().domains.map((d) => d.id))
  for (const d of c.domains) if (!fields.has(d)) errs.push(`field "${d}" is not in data/taxonomy.json`)
  for (const s of c.subsectors) {
    if (!subs.has(s)) errs.push(`subsector "${s}" is not in data/taxonomy.json`)
    if (!c.domains.includes(s.split('/')[0])) errs.push(`subsector "${s}" belongs to a domain not listed in domains`)
  }
  for (const d of c.domains) if (!c.subsectors.some((s) => s.startsWith(d + '/'))) errs.push(`domain "${d}" has no subsector`)
  if (c.status !== 'active' && !c.statusEvent) errs.push(`status "${c.status}" needs a statusEvent (use null fields inside it if details are unknown)`)
  if ((c.hq.lat == null) !== (c.hq.lon == null)) errs.push('hq.lat and hq.lon must both be set or both be null')
  if (c.hq.city == null && c.hq.lat != null) errs.push('hq.city is unknown, so hq.lat/lon must be null (no placeholder coordinates)')
  if (c.founded.date && !c.founded.source) errs.push('founded.date needs founded.source')
  return errs
}
export function validateEvent(e) { return vEvent(e) ? [] : fmt(vEvent.errors) }

export const slugify = (s) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
// Only legal-form suffixes are stripped: stripping words like "Robotics" once merged two different companies that share a first name.
export const normName = (s) => slugify(s).replace(/-(inc|ltd|llc|gmbh|sas|sa|ab|as|oy|bv|ag|plc|corp|corporation)$/g, '').replace(/-/g, '')
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, '') } catch { return null } }

/** Finds an existing record that is the same company as `c` (by id, name, alias or website host). */
export function findDuplicate(c, existing) {
  const names = new Set([c.name, ...(c.aliases || [])].map(normName))
  const h = c.website && host(c.website)
  return existing.find((x) => x.id === c.id || [x.name, ...(x.aliases || [])].some((n) => names.has(normName(n))) || (h && x.website && host(x.website) === h)) || null
}

export function loadCompanies() {
  const dir = path.join(DATA, 'companies')
  const out = []
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) for (const c of readJson(path.join(dir, f))) out.push(c)
  return out
}
/** Rewrites data/companies/<primary field>.json from a full list, sorted by id for stable diffs. Files of fields that no longer exist are removed. */
export function saveCompanies(all) {
  const by = {}
  for (const d of taxonomy().domains) by[d.id] = []
  for (const c of all) (by[c.domains[0]] ??= []).push(c)
  const dir = path.join(DATA, 'companies')
  fs.mkdirSync(dir, { recursive: true })
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) if (!(f.slice(0, -5) in by)) fs.rmSync(path.join(dir, f))
  for (const [d, list] of Object.entries(by)) writeJson(path.join(dir, d + '.json'), list.sort((a, b) => a.id.localeCompare(b.id)))
}
