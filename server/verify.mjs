// The verification layer. Research output is treated as a set of claims, not as facts.
// For every funding round, founding date, exit and reported total:
//   1. this server downloads the cited page itself (never trusting what the researcher said was on it);
//   2. aggregator and social sources are refused outright;
//   3. a second, independent model call sees only the claim and the page text, and must return a verdict plus a verbatim quote;
//   4. code then checks that the quote really is on the page, that the amount appears on the page in some written form,
//      and that the page mentions the company. A "confirmed" from the model that fails these checks is not accepted.
// Outcome per fact: confirmed (kept, marked), corrected (rewritten from the page), unsupported (removed), unreachable (kept, flagged).
import { fetchPage, excerpt, isBlockedSource, sourceTier } from './web.mjs'

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[‘’‚′]/g, "'").replace(/[“”„″]/g, '"').replace(/[‐-―−]/g, '-').replace(/[  -​ ]/g, ' ').replace(/\s+/g, ' ').trim()

/** True if every part of the quote (split on ellipses) appears verbatim on the page. Short quotes prove nothing and are rejected. */
export function quoteOnPage(quote, pageText) {
  const page = norm(pageText), parts = norm(quote).split(/\s*(?:\.\.\.|…|\[\.\.\.\]|\[…\])\s*/).map((p) => p.replace(/^["'\s]+|["'\s.]+$/g, '')).filter(Boolean)
  if (!parts.length || parts.join(' ').length < 12) return false
  return parts.every((p) => p.length >= 6 && page.includes(p))
}

/** True if the amount appears on the page in a written form: "25 million", "25M", "€25m", "25,000,000", "2.5bn", "1,5 Mio." … */
export function amountOnPage(value, pageText) {
  const page = norm(pageText)
  const forms = (n) => { const out = new Set(); for (const d of [0, 1, 2, 3]) { const f = n.toFixed(d); if (Math.abs(Number(f) - n) < 1e-9) { const t = d ? f.replace(/0+$/, '').replace(/\.$/, '') : f; out.add(t); out.add(t.replace('.', ',')); if (d === 0 && n >= 1000) out.add(Number(t).toLocaleString('en-US')) } } return [...out] }
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const units = [[1e9, 'b|bn|bln|billion|billions|milliard|milliards|mrd|mia|miljard'], [1e6, 'm|mn|mm|mio|mil|million|millions|millionen|millones|milioni|miljoen|miljoner|millioner'], [1e3, 'k|thousand|tsd']]
  for (const [u, words] of units) {
    const n = value / u
    if (n < 1 || n >= 1000) continue
    for (const f of forms(n)) if (new RegExp(`(?<![\\d.,])${esc(f)}\\s?-?\\s?(?:${words})(?![a-z])`).test(page)) return true
  }
  // exact figures such as "$775,410.90": whole part with any thousands separator, cents optional
  const digits = String(Math.trunc(value))
  for (const sep of [',', '.', ' ', "'", '']) { const g = digits.replace(/\B(?=(\d{3})+(?!\d))/g, sep); if (new RegExp(`(?<![\\d.,])${esc(g)}(?:[.,]\\d{1,2})?(?![\\d])`).test(page)) return true }
  return false
}

/** True if the page mentions the company (name, an alias, or its website's own name). */
export function companyOnPage(company, pageText) {
  const page = norm(pageText)
  const names = [company.name, ...(company.aliases || [])].map(norm).filter((n) => n.length >= 2)
  let host = null
  try { host = company.website ? new URL(company.website).hostname.replace(/^www\./, '').split('.')[0] : null } catch { /* ignore */ }
  const first = norm(company.name).split(/[ .]/)[0]
  return names.some((n) => page.includes(n)) || (first.length >= 5 && page.includes(first)) || !!(host && host.length >= 4 && page.includes(host))
}

const money = (m) => (m ? `${m.currency} ${m.value}` : 'not disclosed')
/** Lists the checkable facts of a record that have not been verified yet. */
export function factsOf(c) {
  const out = []
  if (c.founded?.date && !c.founded.check) out.push({ key: 'founded', target: c.founded, source: c.founded.source, claim: `${c.name} was founded in ${c.founded.date}.` })
  if (c.statusEvent && !c.statusEvent.check) out.push({ key: 'statusEvent', target: c.statusEvent, source: c.statusEvent.source, amount: c.statusEvent.amount?.value, claim: `${c.name}: ${c.statusEvent.type}${c.statusEvent.acquirer?.name ? ' by ' + c.statusEvent.acquirer.name : ''} on ${c.statusEvent.date ?? 'an unknown date'}, price ${money(c.statusEvent.amount)}. The deal or shutdown is completed, not just announced.` })
  if (c.totalRaised && !c.totalRaised.check) out.push({ key: 'totalRaised', target: c.totalRaised, source: c.totalRaised.source, amount: c.totalRaised.value, claim: `${c.name} has raised ${money(c.totalRaised)} in total${c.totalRaised.asOf ? ' as of ' + c.totalRaised.asOf : ''}.` })
  ;(c.rounds || []).forEach((r, i) => { if (!r.check) out.push({ key: `round:${i}`, target: r, source: r.source, amount: r.amount?.value, claim: `${c.name} funding round: type "${r.type}"${r.label ? ` (called "${r.label}")` : ''}, date ${r.date ?? 'unknown'}, amount ${money(r.amount)}, led by [${(r.leads || []).join('; ')}], other investors [${(r.investors || []).join('; ')}].` }) })
  return out
}

const PROMPT = (company, url, page, claims) => `You are a fact-checker. Decide whether a web page supports claims about the company "${company.name}". Use ONLY the page text below. Do not use anything you know from elsewhere. If the page does not say it, it is not supported.

For each claim return:
- "verdict": "confirmed" if every element is stated on the page (amount AND currency, date to the precision claimed, round name, who led, who else invested, and for an exit that it was completed); "corrected" if the page states the fact but an element differs or is not there; "unsupported" if the page does not state this fact about this company at all.
- "quote": a passage copied character for character from the page that supports your verdict (15 to 300 characters). It will be searched for on the page by a program: a paraphrase counts as a failure. null only for "unsupported".
- "correction": only for "corrected", the fields that change, taken from the page:
  round: "date" (YYYY, YYYY-MM or YYYY-MM-DD), "type" (grant, pre-seed, seed, series-a … series-e, series-f+, growth, venture, debt, strategic, ipo, contract; use "venture" when the page names no series), "label", "amount" ({"value": whole units, "currency": "USD"} or null), "leads" (only investors the page says led), "investors" (only names on the page);
  founded: "date"; statusEvent: "date", "amount", "notClosed": true if only announced; totalRaised: "value", "currency", "asOf".
- "note": a caveat in one sentence, or null (for example: the figure is "more than", the date is the announcement date).

Page: ${url}
--- PAGE TEXT START ---
${page}
--- PAGE TEXT END ---

Claims:
${claims.map((c, i) => `${i + 1}. [${c.key}] ${c.claim}`).join('\n')}

Reply with only a JSON array, one object per claim in the same order: [{"key": "...", "verdict": "...", "quote": "...", "correction": null, "note": null}]`

function parseArray(text) {
  for (const cand of [...[...text.matchAll(/```(?:json)?\s*\n?([\s\S]*?)\n?```/g)].map((m) => m[1]).reverse(), text.slice(text.indexOf('['), text.lastIndexOf(']') + 1)]) { try { const v = JSON.parse(cand); if (Array.isArray(v)) return v } catch { /* next */ } }
  return null
}
const TYPES = new Set(['grant', 'pre-seed', 'seed', 'series-a', 'series-b', 'series-c', 'series-d', 'series-e', 'series-f+', 'growth', 'venture', 'debt', 'strategic', 'ipo', 'contract', 'unknown'])
const okMoney = (m) => m === null || (m && typeof m.value === 'number' && m.value > 0 && /^[A-Z]{3}$/.test(m.currency || ''))
const DATE = /^(19|20)\d\d(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/

function applyCorrection(fact, x) {
  const t = fact.target
  if (fact.key.startsWith('round:')) {
    if (x.date === null || DATE.test(x.date || '')) t.date = x.date
    if (TYPES.has(x.type)) t.type = x.type
    if ('label' in x && (x.label === null || typeof x.label === 'string')) t.label = x.label
    if ('amount' in x && okMoney(x.amount)) t.amount = x.amount
    if (Array.isArray(x.leads)) t.leads = x.leads.filter((s) => typeof s === 'string')
    if (Array.isArray(x.investors)) t.investors = x.investors.filter((s) => typeof s === 'string' && !t.leads.includes(s))
  } else if (fact.key === 'founded') { if (DATE.test(x.date || '')) t.date = x.date }
  else if (fact.key === 'statusEvent') { if (x.date === null || DATE.test(x.date || '')) t.date = x.date; if ('amount' in x && okMoney(x.amount)) t.amount = x.amount }
  else if (fact.key === 'totalRaised') { if (typeof x.value === 'number' && x.value > 0) t.value = x.value; if (/^[A-Z]{3}$/.test(x.currency || '')) t.currency = x.currency; if (x.asOf === null || DATE.test(x.asOf || '')) t.asOf = x.asOf }
}

/**
 * Verifies the unverified facts of one record in place. `complete` is provider.complete; `fetch` defaults to this server's fetchPage.
 * Returns { record, results: [{ key, claim, verdict, reason, quote, source, tier }], summary }.
 */
export async function verifyRecord(record, { complete, fetch = fetchPage, onLog = () => {}, signal } = {}) {
  const facts = factsOf(record), results = [], dropRounds = []
  const done = (f, verdict, reason, quote = null) => results.push({ key: f.key, claim: f.claim, verdict, reason, quote, source: f.source ?? null, tier: f.source ? sourceTier(f.source, record) : null })
  const bySource = new Map()
  for (const f of facts) {
    if (!f.source) { done(f, 'unsupported', 'no source given'); continue }
    if (isBlockedSource(f.source)) { done(f, 'unsupported', 'source is an aggregator, profile or social page, which is not accepted as evidence'); continue }
    bySource.set(f.source, [...(bySource.get(f.source) ?? []), f])
  }
  for (const [url, group] of bySource) {
    onLog(`Checking ${group.length} fact${group.length > 1 ? 's' : ''} against ${url}`)
    const page = await fetch(url)
    if (!page.ok) { for (const f of group) done(f, 'unreachable', `the page could not be opened (${page.error})`); continue }
    if (!companyOnPage(record, page.text)) { for (const f of group) done(f, 'unsupported', 'the page does not mention the company'); continue }
    const terms = [record.name, ...group.flatMap((f) => [f.target.date?.slice(0, 4), ...(f.target.leads || [])]), 'raised', 'funding', 'million', 'acquire', 'founded']
    let verdicts = null
    try { verdicts = parseArray(await complete(PROMPT(record, url, excerpt(page.text, terms, 14000), group), { signal })) } catch (e) { for (const f of group) done(f, 'unreachable', `the checking model failed (${e.message})`); continue }
    for (const [i, f] of group.entries()) {
      const v = verdicts?.find((x) => x?.key === f.key) ?? verdicts?.[i]
      if (!v || !['confirmed', 'corrected', 'unsupported'].includes(v.verdict)) { done(f, 'unreachable', 'the checking model gave no usable verdict'); continue }
      if (v.verdict === 'unsupported') { done(f, 'unsupported', v.note || 'the page does not state this'); continue }
      if (!quoteOnPage(v.quote, page.text)) { done(f, 'unreachable', 'the checker’s supporting quote is not on the page, so its verdict was not accepted', v.quote ?? null); continue }
      if (v.verdict === 'corrected' && v.correction && typeof v.correction === 'object') {
        if (f.key === 'statusEvent' && v.correction.notClosed) { done(f, 'unsupported', 'the page only announces the deal; it does not say it was completed', v.quote); continue }
        applyCorrection(f, v.correction)
      }
      const amount = f.key === 'totalRaised' ? f.target.value : f.target.amount?.value
      if (amount && !amountOnPage(amount, page.text)) { done(f, 'unreachable', `the amount ${amount.toLocaleString('en-US')} was not found on the page in any written form`, v.quote); continue }
      if (typeof v.note === 'string' && v.note.trim()) f.target.checkNote = v.note.trim().slice(0, 500)
      done(f, v.verdict, v.verdict === 'corrected' ? 'rewritten from the page' : 'stated on the page', v.quote)
    }
  }
  // write the outcome into the record
  for (const r of results) {
    const f = facts.find((x) => x.key === r.key)
    if (r.verdict === 'confirmed' || r.verdict === 'corrected') f.target.check = 'confirmed'
    else if (r.verdict === 'unreachable') { f.target.check = 'unreachable'; f.target.checkNote = r.reason }
    else if (f.key.startsWith('round:')) dropRounds.push(f.target)
    else if (f.key === 'founded') { record.founded = { date: null, source: null } }
    else if (f.key === 'totalRaised') record.totalRaised = null
    else if (f.key === 'statusEvent') { record.status = 'active'; record.statusEvent = null }
  }
  if (dropRounds.length) record.rounds = record.rounds.filter((r) => !dropRounds.includes(r))
  const all = [...(record.rounds || []), record.founded?.date ? record.founded : null, record.statusEvent, record.totalRaised].filter(Boolean)
  const ok = all.filter((f) => f.check === 'confirmed').length
  if (all.length) { record.confidence = ok === all.length && !all.some((f) => /wikipedia\.org/.test(f.source || '')) ? 'high' : ok / all.length >= 0.6 ? 'medium' : 'low'; record.lastVerified = new Date().toISOString().slice(0, 10) }
  const count = (v) => results.filter((r) => r.verdict === v).length
  return { record, results, summary: { checked: results.length, confirmed: count('confirmed'), corrected: count('corrected'), removed: count('unsupported'), unconfirmed: count('unreachable') } }
}
