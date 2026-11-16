// Fields ("domains") are data, not code: each globe is one entry in data/taxonomy.json.
// Adding a field creates an empty globe; deleting one removes its companies, events and files so nothing is left behind.
import path from 'node:path'
import { DATA, readJson, writeJson, taxonomy, loadCompanies, saveCompanies, slugify } from './validate.mjs'

const TAX = path.join(DATA, 'taxonomy.json')
const COLORS = ['#ff6b4a', '#4db8ff', '#a78bfa', '#f5c451', '#3ddc97', '#22d3ee', '#ff7ab6', '#9ad14b', '#ff9f43', '#7c8cff', '#e879f9', '#2dd4bf', '#f87171', '#c4b5fd', '#facc15', '#60a5fa']
export const catalog = () => readJson(path.join(DATA, 'field-catalog.json'), [])
const clean = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
const list = (v, max = 12) => (Array.isArray(v) ? v : String(v ?? '').split(/[,;\n]/)).map((k) => clean(k, 60)).filter(Boolean).filter((k, i, a) => a.findIndex((x) => x.toLowerCase() === k.toLowerCase()) === i).slice(0, max)

/** Catalog entries not on the atlas yet, for the "Add a field" dropdown. */
export function availableFields() {
  const have = new Set(taxonomy().domains.map((d) => d.id))
  return catalog().filter((f) => !have.has(f.id)).map(({ id, name, tagline, keywords, subsectors }) => ({ id, name, tagline, keywords, subsectors: subsectors.map((s) => s.name) }))
}

/**
 * Adds a field. Body is { catalogId, keywords? } or { name, keywords, subsectors? } for a custom one.
 * `propose` (optional, async) may return subsector names for a custom field that came without any.
 */
export async function addField(body, { propose } = {}) {
  const tax = taxonomy()
  let field
  if (body.catalogId) {
    const c = catalog().find((f) => f.id === body.catalogId)
    if (!c) throw new Error('That field is not in the catalog')
    field = { id: c.id, name: c.name, tagline: c.tagline, keywords: list(body.keywords).length ? list(body.keywords) : c.keywords, subsectors: c.subsectors.map((s) => ({ ...s, enabled: true })) }
  } else {
    const name = clean(body.name, 40)
    if (name.length < 2) throw new Error('Give the field a name')
    const id = slugify(name)
    if (!id) throw new Error('The name needs at least one letter or digit')
    const keywords = list(body.keywords)
    let subs = list(body.subsectors, 10)
    if (!subs.length && propose) { try { subs = list(await propose(name, keywords), 8) } catch { /* fall back to a single subsector */ } }
    const ids = new Set()
    const subsectors = (subs.length ? subs : ['General']).map((n) => { let sid = slugify(n) || 'general'; while (ids.has(sid)) sid += '-2'; ids.add(sid); return { id: `${id}/${sid}`, name: n, description: subs.length ? n : `Everything in ${name}`, enabled: true } })
    field = { id, name, tagline: clean(body.tagline, 80) || (keywords.length ? keywords.slice(0, 3).join(', ') : 'Custom field'), keywords, subsectors, custom: true }
  }
  if (tax.domains.some((d) => d.id === field.id)) throw new Error(`"${field.name}" is already on the atlas`)
  const used = new Set(tax.domains.map((d) => d.color))
  field = { id: field.id, name: field.name, tagline: field.tagline, color: COLORS.find((c) => !used.has(c)) ?? COLORS[tax.domains.length % COLORS.length], ...field }
  tax.domains.push(field)
  writeJson(TAX, tax)
  saveCompanies(loadCompanies())   // creates the empty data file
  return field
}

/** What deleting a field would remove. */
export function fieldImpact(id) {
  const all = loadCompanies(), events = readJson(path.join(DATA, 'events.json'), [])
  return {
    companiesRemoved: all.filter((c) => c.domains.includes(id) && c.domains.length === 1).length,
    companiesKept: all.filter((c) => c.domains.includes(id) && c.domains.length > 1).length,
    eventsRemoved: events.filter((e) => e.domains.includes(id) && e.domains.length === 1).length,
  }
}

/** Deletes a field and everything that belongs only to it. Companies that also sit in another field stay there. */
export function deleteField(id) {
  const tax = taxonomy()
  if (!tax.domains.some((d) => d.id === id)) throw new Error('No such field')
  if (tax.domains.length === 1) throw new Error('The atlas needs at least one field')
  const impact = fieldImpact(id)
  const kept = loadCompanies().filter((c) => !(c.domains.includes(id) && c.domains.length === 1)).map((c) => (c.domains.includes(id) ? { ...c, domains: c.domains.filter((d) => d !== id), subsectors: c.subsectors.filter((s) => !s.startsWith(id + '/')) } : c))
  tax.domains = tax.domains.filter((d) => d.id !== id)
  writeJson(TAX, tax)
  saveCompanies(kept)   // also removes data/companies/<id>.json
  const ev = path.join(DATA, 'events.json')
  writeJson(ev, readJson(ev, []).filter((e) => !(e.domains.includes(id) && e.domains.length === 1)).map((e) => (e.domains.includes(id) ? { ...e, domains: e.domains.filter((d) => d !== id) } : e)))
  const metaFile = path.join(DATA, 'meta.json'), meta = readJson(metaFile, null)
  if (meta?.lastRefresh?.[id]) { delete meta.lastRefresh[id]; writeJson(metaFile, meta) }
  const qf = path.join(DATA, 'queue/queue.json'), q = readJson(qf, null)
  if (q) writeJson(qf, q.filter((item) => !(item.state === 'pending' && item.record?.domains?.[0] === id)))
  const uf = path.join(DATA, 'user/annotations.json'), user = readJson(uf, null)
  if (user) { const ids = new Set(kept.map((c) => c.id)); writeJson(uf, { stars: (user.stars || []).filter((s) => ids.has(s)), notes: Object.fromEntries(Object.entries(user.notes || {}).filter(([k]) => ids.has(k))) }) }
  return impact
}
