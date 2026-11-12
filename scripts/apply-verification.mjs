#!/usr/bin/env node
// Applies the independent source-check verdicts in data/verification/*.json to data/companies/*.json.
//   confirmed   -> fact marked check:"confirmed" (source replaced by a better one if the checker found it)
//   corrected   -> fact rewritten from what the page states, then marked confirmed
//   unsupported -> fact removed (round dropped, date/total set to null)
//   unreachable -> fact kept but marked check:"unreachable" (shown as unchecked in the UI)
// Writes data/verification/REPORT.md. Run once per verification pass:  node scripts/apply-verification.mjs [--dry]
import fs from 'node:fs'
import path from 'node:path'
import { DATA, readJson, loadCompanies, saveCompanies, validateCompany } from '../server/validate.mjs'

const dry = process.argv.includes('--dry')
const dir = path.join(DATA, 'verification')
// Verdict keys refer to round positions at the time of the check, so each file is applied once and then moved to applied/.
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('events'))
const verdicts = files.flatMap((f) => { try { return readJson(path.join(dir, f)).map((v) => ({ ...v, file: f })) } catch { console.error('unreadable', f); return [] } })
const all = loadCompanies(), byId = new Map(all.map((c) => [c.id, c]))
const today = new Date().toISOString().slice(0, 10)
const count = { confirmed: 0, corrected: 0, unsupported: 0, unreachable: 0, skipped: 0 }, changes = [], drop = new Map(), seen = new Set()
// companies whose non-active status rests on an insolvency that IS confirmed, even though the follow-on sale is not
const KEEP_STATUS = new Set(['franka-emika'])
const TYPES = new Set(['grant', 'pre-seed', 'seed', 'series-a', 'series-b', 'series-c', 'series-d', 'series-e', 'series-f+', 'growth', 'venture', 'debt', 'strategic', 'ipo', 'contract', 'unknown'])
const okMoney = (m) => m === null || (m && typeof m.value === 'number' && m.value > 0 && /^[A-Z]{3}$/.test(m.currency || ''))
const isUrl = (u) => typeof u === 'string' && /^https?:\/\//.test(u)
const money = (m) => (m ? `${m.currency} ${m.value.toLocaleString('en-US')}` : 'undisclosed')

for (const v of verdicts) {
  const c = byId.get(v.id), k = `${v.id}|${v.key}`
  if (!c || seen.has(k) || !count.hasOwnProperty(v.verdict)) { count.skipped++; continue }
  seen.add(k)
  const ri = v.key.startsWith('round:') ? Number(v.key.slice(6)) : null
  const target = ri != null ? c.rounds[ri] : v.key === 'founded' ? c.founded : v.key === 'statusEvent' ? c.statusEvent : v.key === 'totalRaised' ? c.totalRaised : null
  if (!target) { count.skipped++; continue }
  count[v.verdict]++
  const what = ri != null ? `${target.type} ${target.date ?? 'undated'} ${money(target.amount)}` : v.key
  if (isUrl(v.newSource) && v.verdict !== 'unsupported' && v.verdict !== 'unreachable') { target.source = v.newSource; if (!c.sources.some((s) => s.url === v.newSource)) c.sources.push({ url: v.newSource, title: null }) }
  if (typeof v.note === 'string' && v.note.trim() && v.verdict !== 'unsupported') target.checkNote = v.note.trim().slice(0, 500)
  if (v.verdict === 'confirmed') target.check = 'confirmed'
  else if (v.verdict === 'unreachable') target.check = 'unreachable'
  else if (v.verdict === 'corrected') {
    const x = v.correction || {}, before = JSON.stringify(target)
    if (ri != null) {
      if (typeof x.date === 'string' || x.date === null) target.date = x.date
      if (TYPES.has(x.type)) target.type = x.type
      if ('label' in x && (x.label === null || typeof x.label === 'string')) target.label = x.label
      if ('amount' in x && okMoney(x.amount)) target.amount = x.amount
      if (Array.isArray(x.leads)) target.leads = x.leads.filter((s) => typeof s === 'string')
      if (Array.isArray(x.investors)) target.investors = x.investors.filter((s) => typeof s === 'string' && !target.leads.includes(s))
    } else if (v.key === 'founded') {
      if (typeof x.date === 'string') target.date = x.date
      if (typeof x.city === 'string' && x.city !== c.hq.city) { c.hq.city = x.city; c.hq.lat = null; c.hq.lon = null }   // coordinates no longer match: off the globe until re-geocoded
    } else if (v.key === 'statusEvent') {
      if (x.notClosed && KEEP_STATUS.has(c.id)) { if (typeof x.date === 'string') target.date = x.date; target.check = 'unreachable'; changes.push(`- **${c.name}** · statusEvent: completion not confirmed by any page opened; kept and flagged. ${v.note ?? ''}`); continue }
      if (x.notClosed) { c.became = [c.became, `Announced but not completed when checked (${today}): ${target.type}${target.acquirer?.name ? ' by ' + target.acquirer.name : ''}${target.date ? ', ' + target.date : ''}. ${target.note ?? ''}`].filter(Boolean).join(' ').trim(); c.status = 'active'; c.statusEvent = null }
      else {
        if (typeof x.date === 'string' || x.date === null) target.date = x.date
        if (['acquired', 'ipo', 'spac', 'direct-listing', 'shutdown', 'bankruptcy'].includes(x.type)) target.type = x.type
        if ('amount' in x && okMoney(x.amount)) target.amount = x.amount
        if (x.acquirerName === null) target.acquirer = null
        if (typeof x.acquirerName === 'string' && target.acquirer && x.acquirerName !== target.acquirer.name) target.acquirer = { name: x.acquirerName, city: null, country: null, lat: null, lon: null }
      }
    } else if (v.key === 'totalRaised') {
      if (typeof x.value === 'number' && x.value > 0) target.value = x.value
      if (/^[A-Z]{3}$/.test(x.currency || '')) target.currency = x.currency
      if (typeof x.asOf === 'string' || x.asOf === null) target.asOf = x.asOf
    }
    if (c.statusEvent !== null || v.key !== 'statusEvent') target.check = 'confirmed'
    changes.push(`- **${c.name}** · ${what}: corrected. ${v.note ?? ''}${v.quote ? ` Page: “${String(v.quote).slice(0, 160)}”` : ''}\n  - before: \`${before.slice(0, 260)}\`\n  - after: \`${JSON.stringify(c.statusEvent === null && v.key === 'statusEvent' ? { status: 'active' } : target).slice(0, 260)}\``)
  } else if (v.verdict === 'unsupported') {
    changes.push(`- **${c.name}** · ${what}: removed, not supported by its source. ${v.note ?? ''}`)
    if (ri != null) drop.set(c.id, [...(drop.get(c.id) ?? []), ri])
    else if (v.key === 'founded') { c.founded.date = null; c.founded.source = null; delete c.founded.check }
    else if (v.key === 'totalRaised') c.totalRaised = null
    else if (v.key === 'statusEvent') { target.date = null; target.amount = null; target.check = 'unreachable' }
  }
}
for (const [id, idx] of drop) { const c = byId.get(id); c.rounds = c.rounds.filter((_, i) => !idx.includes(i)) }

const touched = new Set(verdicts.map((v) => v.id))
// record-level confidence now follows the check: share of this record's sourced facts that were confirmed
let unchecked = 0
for (const c of all) {
  const facts = [...c.rounds, c.founded.date ? c.founded : null, c.statusEvent, c.totalRaised].filter(Boolean)
  const done = facts.filter((f) => f.check), ok = facts.filter((f) => f.check === 'confirmed').length
  if (!done.length) { unchecked++; continue }
  if (!touched.has(c.id)) continue
  const wiki = facts.some((f) => /wikipedia\.org/.test(f.source || ''))
  // high: every sourced fact confirmed on a non-Wikipedia page; medium: all or most confirmed but some rest on Wikipedia or could not be confirmed
  c.confidence = ok === facts.length && !wiki ? 'high' : ok / facts.length >= 0.6 ? 'medium' : 'low'
  c.lastVerified = today
  c.rounds.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'))
}
const bad = all.filter((c) => validateCompany(c).length)
for (const c of bad) console.error('INVALID after apply:', c.id, validateCompany(c).slice(0, 3))
const total = count.confirmed + count.corrected + count.unsupported + count.unreachable
const report = `# Source verification report (${today})\n\nEvery sourced fact (funding rounds, founding dates, exits, reported totals) was re-checked by an independent pass that opened the cited page, or an alternative when the page was blocked.\n\n| Verdict | Facts | Share |\n|---|---|---|\n${Object.entries(count).filter(([k]) => k !== 'skipped').map(([k, n]) => `| ${k} | ${n} | ${total ? ((n / total) * 100).toFixed(1) : 0}% |`).join('\n')}\n| **total checked** | **${total}** | |\n\n- confirmed: an opened page states the fact as recorded.\n- corrected: the page supports the fact but an element differed; the record now carries what the page says.\n- unsupported: the cited page does not state it; the fact was removed.\n- unreachable: no page could be opened; the fact is kept and flagged "not re-checked" in the UI.\n\nRecords by confidence after the check: ${['high', 'medium', 'low'].map((k) => `${k} ${all.filter((c) => c.confidence === k).length}`).join(', ')}. Records with no checkable fact: ${unchecked}.\n\n## Changes made\n\n${changes.join('\n') || 'None.'}\n`
console.log(count, 'total', total, 'invalid', bad.length, 'changes', changes.length)
if (!dry && !bad.length) {
  saveCompanies(all)
  const rp = path.join(dir, 'REPORT.md')
  if (fs.existsSync(rp)) fs.appendFileSync(rp, `\n## Additional pass (${today}): ${files.join(', ')}\n\n${Object.entries(count).filter(([k]) => k !== 'skipped').map(([k, n]) => `${k} ${n}`).join(', ')}.\n\n${changes.join('\n') || 'No changes.'}\n`)
  else fs.writeFileSync(rp, report)
  fs.mkdirSync(path.join(dir, 'applied'), { recursive: true })
  for (const f of files) fs.renameSync(path.join(dir, f), path.join(dir, 'applied', f))
  console.log('applied; report written; verdict files moved to applied/')
} else console.log(dry ? 'dry run: nothing written' : 'NOT applied: fix invalid records first')
