import test from 'node:test'
import assert from 'node:assert/strict'
import { loadCompanies, validateCompany, validateEvent, findDuplicate, readJson, DATA, taxonomy } from '../server/validate.mjs'
import path from 'node:path'

test('every company record passes the schema', () => {
  const bad = loadCompanies().map((c) => [c.id, validateCompany(c)]).filter(([, e]) => e.length)
  assert.deepEqual(bad, [])
})
test('every event passes the schema', () => {
  const bad = readJson(path.join(DATA, 'events.json'), []).map((e) => [e.id, validateEvent(e)]).filter(([, e]) => e.length)
  assert.deepEqual(bad, [])
})
test('company ids are unique and every company belongs to a known field', () => {
  const all = loadCompanies(), ids = new Set(all.map((c) => c.id)), fields = new Set(taxonomy().domains.map((d) => d.id))
  assert.equal(ids.size, all.length)
  assert.deepEqual(all.filter((c) => c.domains.some((d) => !fields.has(d))).map((c) => c.id), [])
})
test('every funding round carries a source URL', () => {
  assert.deepEqual(loadCompanies().flatMap((c) => c.rounds.filter((r) => !/^https?:\/\//.test(r.source || '')).map(() => c.id)), [])
})
test('duplicate matching does not merge different companies that share a first name', () => {
  const existing = [{ id: 'bedrock-ocean-exploration', name: 'Bedrock Ocean Exploration', aliases: [], website: 'https://bedrockocean.com' }]
  assert.equal(findDuplicate({ id: 'bedrock-robotics', name: 'Bedrock Robotics', website: 'https://bedrockrobotics.com' }, existing), null)
  assert.ok(findDuplicate({ id: 'bedrock-ocean', name: 'Bedrock Ocean Exploration, Inc.', website: null }, existing))
  assert.ok(findDuplicate({ id: 'x', name: 'Other name', website: 'https://www.bedrockocean.com/about' }, existing))
})
