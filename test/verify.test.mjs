import test from 'node:test'
import assert from 'node:assert/strict'
import { amountOnPage, quoteOnPage, companyOnPage, verifyRecord } from '../server/verify.mjs'

const PAGE = `Acme Robotics raises €25 million Series A to scale its inspection crawlers.
RIGA, 3 March 2024 — Acme Robotics today announced it has raised €25 million in a Series A round led by Northwind Capital, with participation from Baltic Angels.
The company was founded in 2021 and has raised $31.5M in total.`
const company = (over = {}) => ({ id: 'acme-robotics', name: 'Acme Robotics', aliases: [], website: 'https://acme-robotics.example', founded: { date: null, source: null }, status: 'active', statusEvent: null, totalRaised: null, confidence: 'low', lastVerified: null,
  rounds: [{ date: '2024-03', type: 'series-a', amount: { value: 25000000, currency: 'EUR' }, leads: ['Northwind Capital'], investors: ['Baltic Angels'], source: 'https://press.example/acme' }], ...over })
const fetchOk = async (url) => ({ ok: true, url, title: 'Acme', text: PAGE })
const answer = (v) => async () => JSON.stringify([{ key: 'round:0', ...v }])

test('amounts are recognised in the forms press releases use', () => {
  for (const [v, t] of [[25e6, '€25 million'], [25e6, 'raised $25M'], [25e6, '25m euros'], [2.5e9, 'a $2.5bn valuation'], [1.5e6, '1,5 Mio. Euro'], [7.4e6, 'raised $7.4m'], [525000, '$525,000 from angels'], [525000, 'raised 525k'], [40e6, 'NOK 40 million'], [1e9, 'US$1 billion'], [200e6, 'JPY 200,000,000'], [775410.9, 'Grant value $775,410.90 (GST inclusive)'], [1943218, 'Hullbot, Rozelle $1,943,218']])
    assert.equal(amountOnPage(v, t), true, `${v} in "${t}"`)
  for (const [v, t] of [[25e6, 'raised €2.5 million'], [25e6, 'raised €125 million'], [25e6, '25 employees'], [1.5e6, 'raised 15 million']])
    assert.equal(amountOnPage(v, t), false, `${v} must not match "${t}"`)
})
test('quotes must be on the page verbatim', () => {
  assert.equal(quoteOnPage('raised €25 million in a Series A round led by Northwind Capital', PAGE), true)
  assert.equal(quoteOnPage('“raised €25 million in a Series A round” … “Baltic Angels”', PAGE), true)
  assert.equal(quoteOnPage('raised €25 million in a Series A led by Southwind Partners', PAGE), false)
  assert.equal(quoteOnPage('raised', PAGE), false)
})
test('the page must mention the company', () => {
  assert.equal(companyOnPage(company(), PAGE), true)
  assert.equal(companyOnPage(company({ name: 'Zenith Dynamics', website: null }), PAGE), false)
})
test('a claim the page states is confirmed', async () => {
  const { record, summary } = await verifyRecord(company(), { fetch: fetchOk, complete: answer({ verdict: 'confirmed', quote: 'raised €25 million in a Series A round led by Northwind Capital', correction: null, note: null }) })
  assert.equal(summary.confirmed, 1); assert.equal(record.rounds[0].check, 'confirmed'); assert.equal(record.confidence, 'high')
})
test('a "confirmed" backed by an invented quote is not accepted', async () => {
  const { record, results } = await verifyRecord(company(), { fetch: fetchOk, complete: answer({ verdict: 'confirmed', quote: 'Acme Robotics closed a €25 million round led by Sequoia', correction: null, note: null }) })
  assert.equal(results[0].verdict, 'unreachable'); assert.equal(record.rounds[0].check, 'unreachable'); assert.notEqual(record.confidence, 'high')
})
test('a hallucinated amount fails even when the model and the quote agree', async () => {
  const c = company(); c.rounds[0].amount.value = 40000000
  const { results } = await verifyRecord(c, { fetch: fetchOk, complete: answer({ verdict: 'confirmed', quote: 'in a Series A round led by Northwind Capital', correction: null, note: null }) })
  assert.equal(results[0].verdict, 'unreachable'); assert.match(results[0].reason, /amount/)
})
test('corrections are taken from the page and re-checked', async () => {
  const c = company(); c.rounds[0].amount.value = 40000000; c.rounds[0].leads = ['Baltic Angels']
  const { record, summary } = await verifyRecord(c, { fetch: fetchOk, complete: answer({ verdict: 'corrected', quote: 'raised €25 million in a Series A round led by Northwind Capital', correction: { amount: { value: 25000000, currency: 'EUR' }, leads: ['Northwind Capital'], investors: ['Baltic Angels'] }, note: null }) })
  assert.equal(summary.corrected, 1); assert.equal(record.rounds[0].amount.value, 25000000); assert.deepEqual(record.rounds[0].leads, ['Northwind Capital'])
})
test('unsupported rounds are removed', async () => {
  const { record, summary } = await verifyRecord(company(), { fetch: fetchOk, complete: answer({ verdict: 'unsupported', quote: null, correction: null, note: 'not on the page' }) })
  assert.equal(summary.removed, 1); assert.equal(record.rounds.length, 0)
})
test('aggregator sources are refused without asking the model', async () => {
  const c = company(); c.rounds[0].source = 'https://www.crunchbase.com/organization/acme'
  let asked = false
  const { record, results } = await verifyRecord(c, { fetch: fetchOk, complete: async () => { asked = true; return '[]' } })
  assert.equal(asked, false); assert.equal(record.rounds.length, 0); assert.match(results[0].reason, /aggregator/)
})
test('a page about another company supports nothing', async () => {
  const { record } = await verifyRecord(company({ name: 'Zenith Dynamics', website: null }), { fetch: fetchOk, complete: answer({ verdict: 'confirmed', quote: 'raised €25 million in a Series A round led by Northwind Capital' }) })
  assert.equal(record.rounds.length, 0)
})
test('an unreachable page keeps the fact but flags it', async () => {
  const { record, summary } = await verifyRecord(company(), { fetch: async (url) => ({ ok: false, url, error: 'HTTP 403' }), complete: async () => '[]' })
  assert.equal(summary.unconfirmed, 1); assert.equal(record.rounds[0].check, 'unreachable')
})
test('an announced-only exit does not change the status', async () => {
  const c = company({ status: 'acquired', statusEvent: { type: 'acquired', date: '2024-05', amount: null, acquirer: { name: 'BigCo' }, source: 'https://press.example/acme' }, rounds: [] })
  const { record } = await verifyRecord(c, { fetch: fetchOk, complete: async () => JSON.stringify([{ key: 'statusEvent', verdict: 'corrected', quote: 'Acme Robotics today announced it has raised', correction: { notClosed: true } }]) })
  assert.equal(record.status, 'active'); assert.equal(record.statusEvent, null)
})
