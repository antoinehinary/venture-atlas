import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Work on a throwaway copy of the data folder so the real atlas is never touched.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-test-'))
const real = path.resolve(import.meta.dirname, '..', 'data')
for (const f of ['taxonomy.json', 'field-catalog.json', 'events.json']) fs.copyFileSync(path.join(real, f), path.join(tmp, f))
fs.cpSync(path.join(real, 'schema'), path.join(tmp, 'schema'), { recursive: true })
fs.cpSync(path.join(real, 'companies'), path.join(tmp, 'companies'), { recursive: true })
process.env.ATLAS_DATA_DIR = tmp
process.env.ATLAS_AUTO_APPROVE = 'verified'
const { availableFields, addField, deleteField, fieldImpact } = await import('../server/fields.mjs')
const { taxonomy, loadCompanies, validateCompany, readJson } = await import('../server/validate.mjs')
const { fileResults, readQueue } = await import('../server/pipeline.mjs')
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }))

test('the dropdown only offers fields that are not on the atlas', () => {
  const have = new Set(taxonomy().domains.map((d) => d.id)), offered = availableFields()
  assert.ok(offered.length >= 10); assert.equal(offered.some((f) => have.has(f.id)), false)
})
test('adding a catalog field creates an empty globe with its own colour and data file', async () => {
  const before = taxonomy().domains
  const f = await addField({ catalogId: 'quantum', keywords: 'ion traps, error correction' })
  assert.equal(f.id, 'quantum'); assert.deepEqual(f.keywords, ['ion traps', 'error correction'])
  assert.equal(before.some((d) => d.color === f.color), false)
  assert.deepEqual(readJson(path.join(tmp, 'companies/quantum.json')), [])
  assert.equal(availableFields().some((x) => x.id === 'quantum'), false)
  await assert.rejects(addField({ catalogId: 'quantum' }), /already/)
})
test('a custom field gets subsectors from the user, the AI proposal, or a single General one', async () => {
  const a = await addField({ name: 'Ocean Energy', keywords: 'wave, tidal', subsectors: 'Wave, Tidal' })
  assert.equal(a.id, 'ocean-energy'); assert.deepEqual(a.subsectors.map((s) => s.id), ['ocean-energy/wave', 'ocean-energy/tidal']); assert.equal(a.custom, true)
  const b = await addField({ name: 'Space Mining' }, { propose: async () => ['Prospecting', 'Extraction'] })
  assert.deepEqual(b.subsectors.map((s) => s.name), ['Prospecting', 'Extraction'])
  const c = await addField({ name: 'Glass' }, { propose: async () => { throw new Error('no AI') } })
  assert.deepEqual(c.subsectors.map((s) => s.id), ['glass/general'])
  await assert.rejects(addField({ name: ' ' }), /name/)
})
test('verified records are added to a new field; unverified ones wait in the queue', async () => {
  const rec = (name, extra = {}) => ({ name, pitch: 'Test company.', domains: ['quantum'], subsectors: ['quantum/hardware'], founded: { date: null, source: null }, hq: { city: null, country: 'FR', lat: null, lon: null }, status: 'active', confidence: 'low', lastVerified: null,
    rounds: [{ date: '2024', type: 'seed', amount: { value: 1000000, currency: 'EUR' }, leads: [], investors: [], source: 'https://press.example/x' }], ...extra })
  const verify = async (c) => { const ok = c.name === 'Good Qubits'; c.rounds[0].check = ok ? 'confirmed' : 'unreachable'; return { record: c, results: [], summary: { checked: 1, confirmed: ok ? 1 : 0, corrected: 0, removed: 0, unconfirmed: ok ? 0 : 1 } } }
  const merged = { n: 0 }, log = []
  const queued = await fileResults({ id: 'job' }, { companies: [rec('Good Qubits'), rec('Shaky Qubits')] }, (t) => log.push(t), { complete: async () => '[]', verify, merged })
  assert.equal(merged.n, 1); assert.equal(queued, 1)
  const all = loadCompanies()
  assert.ok(all.some((c) => c.id === 'good-qubits')); assert.equal(all.some((c) => c.id === 'shaky-qubits'), false)
  assert.deepEqual(readQueue().filter((q) => q.state === 'pending').map((q) => q.record.name), ['Shaky Qubits'])
})
test('confirmed marks written by the researcher are ignored: every fact is checked by the server', async () => {
  const { verifyRecord } = await import('../server/verify.mjs')
  const forged = { name: 'Forged Qubits', pitch: 'Test company.', domains: ['quantum'], subsectors: ['quantum/hardware'], founded: { date: '2020', source: 'https://press.example/f', check: 'confirmed' },
    hq: { city: null, country: 'FR', lat: null, lon: null }, status: 'active', confidence: 'high', lastVerified: '2026-01-01', sources: [],
    rounds: [{ date: '2024', type: 'seed', amount: { value: 9000000, currency: 'EUR' }, leads: [], investors: [], source: 'https://press.example/f', check: 'confirmed' }],
    totalRaised: { value: 9000000, currency: 'EUR', source: 'https://press.example/f', check: 'confirmed' } }
  // The page exists and names the company but supports none of the claims.
  const fetch = async (url) => ({ ok: true, url, title: 'x', text: 'Forged Qubits is a company. '.repeat(20) })
  const complete = async () => JSON.stringify([{ key: 'founded', verdict: 'unsupported', quote: null }, { key: 'totalRaised', verdict: 'unsupported', quote: null }, { key: 'round:0', verdict: 'unsupported', quote: null }])
  const merged = { n: 0 }, seen = []
  await fileResults({ id: 'job2' }, { companies: [forged] }, () => {}, { complete, merged, verify: (c, o) => { seen.push(structuredClone(c)); return verifyRecord(c, { ...o, fetch }) } })
  assert.equal(seen[0].rounds[0].check, undefined); assert.equal(seen[0].founded.check, undefined); assert.equal(seen[0].confidence, 'low')
  assert.equal(merged.n, 0, 'nothing forged is auto-added')
  assert.equal(loadCompanies().some((c) => c.id === 'forged-qubits'), false)
  const q = readQueue().find((x) => x.record.name === 'Forged Qubits')
  assert.equal(q.verification.summary.checked, 3); assert.equal(q.verification.summary.removed, 3)
  assert.deepEqual(q.record.rounds, [])
})
test('deleting a field removes its data and nothing else', async () => {
  const before = loadCompanies()
  const impact = fieldImpact('maritime')
  assert.ok(impact.companiesRemoved > 0); assert.ok(impact.companiesKept > 0)
  assert.deepEqual(deleteField('maritime'), impact)
  const after = loadCompanies()
  assert.equal(after.length, before.length - impact.companiesRemoved)
  assert.equal(after.some((c) => c.domains.includes('maritime') || c.subsectors.some((s) => s.startsWith('maritime/'))), false)
  assert.equal(fs.existsSync(path.join(tmp, 'companies/maritime.json')), false)
  assert.equal(taxonomy().domains.some((d) => d.id === 'maritime'), false)
  assert.deepEqual(after.map((c) => [c.id, validateCompany(c)]).filter(([, e]) => e.length), [])
  assert.equal(readJson(path.join(tmp, 'events.json')).some((e) => e.domains.includes('maritime')), false)
  assert.ok(availableFields().some((f) => f.id === 'maritime'), 'a deleted field can be added again from the catalog')
  assert.throws(() => deleteField('maritime'), /No such field/)
  deleteField('quantum')
  assert.equal(loadCompanies().some((c) => c.id === 'good-qubits'), false)
})
