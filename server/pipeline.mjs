// Research pipeline: runs Claude Code non-interactively (`claude -p`) with web tools only,
// parses the JSON it returns, validates, deduplicates and files the result in the review queue.
import fs from 'node:fs'
import path from 'node:path'
import { getProvider } from './providers.mjs'
import { verifyRecord } from './verify.mjs'
import { DATA, ROOT, readJson, writeJson, taxonomy, validateCompany, findDuplicate, loadCompanies, saveCompanies, slugify } from './validate.mjs'

const QUEUE = path.join(DATA, 'queue/queue.json')
const META = path.join(DATA, 'meta.json')
const today = () => new Date().toISOString().slice(0, 10)

export const readQueue = () => readJson(QUEUE, [])
const saveQueue = (q) => writeJson(QUEUE, q)
export const readMeta = () => readJson(META, { lastRefresh: {} })

function buildPrompt(job) {
  const tax = taxonomy()
  const brief = fs.readFileSync(path.join(ROOT, 'server/research-brief.md'), 'utf8')
  const schema = fs.readFileSync(path.join(DATA, 'schema/company.schema.json'), 'utf8')
  const subs = tax.domains.map((d) => `${d.id}: ${d.subsectors.map((s) => s.id).join(', ')}`).join('\n')
  const all = loadCompanies()
  let task
  if (job.type === 'refresh') {
    const dom = tax.domains.find((d) => d.id === job.domain)
    const since = readMeta().lastRefresh?.[job.domain] || all.filter((c) => c.domains.includes(job.domain)).map((c) => c.lastVerified).filter(Boolean).sort().pop() || '2025-01-01'
    const known = all.filter((c) => c.domains.includes(job.domain)).map((c) => c.name)
    task = `## Task: refresh the "${dom.name}" domain

Today is ${today()}. The last refresh was ${since}.
Subsectors: ${dom.subsectors.map((s) => `${s.id} (${s.description})`).join('; ')}.${dom.keywords?.length ? `\nKeywords the user associates with this field: ${dom.keywords.join(', ')}.` : ''}

1. ${known.length < 5 ? `This field is new on the atlas. Start with the 10 to 12 best-documented venture-backed companies in it: the ones that defined each subsector plus ones funded in the last 24 months.` : `Find companies in this field that were **founded, funded, or came out of stealth since ${since}** and are not in the known list below.`} Look in: recent Y Combinator batches, a16z (American Dynamism), General Catalyst, Lux, Founders Fund, Point Nine, EQT, Project A, Expeditions, NATO Innovation Fund and other fund portfolio/announcement pages; accelerators such as NATO DIANA cohorts, EIC Accelerator results, Techstars, Seraphim, Creative Destruction Lab, Entrepreneur First; and the trade and startup press (TechCrunch, Sifted, Tech.eu, EU-Startups, SpaceNews, Breaking Defense, The Robot Report, Splash247, TradeWinds). Give European companies real coverage, not only the US.
2. For companies in the known list, report any **new funding round, acquisition, IPO or shutdown since ${since}** by returning a record with the same name containing the new round(s) and/or status plus sources (other fields may be null/empty: they will be merged into the existing record).

Return up to 12 records, best-sourced first. Known companies (do not re-research their history): ${known.join(', ') || '(none yet)'}`
  } else {
    task = `## Task: research one company

Today is ${today()}. The user gave this name or URL: "${job.query}"${job.domain ? `\nIt probably belongs to the "${job.domain}" domain, but check.` : ''}
If it is a LinkedIn or other URL you cannot open, work from the company name in the URL and search the web for it. Identify the company unambiguously (if several companies share the name, pick the one in defence, space, robotics, automation, ML/AI or maritime technology) and fill in one complete record. If you cannot identify the company at all, return an empty list and explain in "notes".`
  }
  return `${brief}

## Taxonomy (subsector ids by domain)
${subs}

## JSON Schema for a company record
\`\`\`json
${schema}
\`\`\`

${task}

## Output
Search the web and open the pages you cite. When done, reply with a single fenced \`\`\`json block and nothing after it, shaped exactly as:
{"companies": [ ...records... ], "notes": "anything the reviewer should know: conflicts between sources, things you could not confirm"}`
}

function extractJson(text) {
  const fences = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)\n```/g)].map((m) => m[1])
  const candidates = [...fences.reverse(), text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)]
  for (const c of candidates) { try { const v = JSON.parse(c); if (v && typeof v === 'object') return v } catch { /* next */ } }
  return null
}

const money = (m) => (m ? `${m.currency} ${m.value.toLocaleString('en-US')}` : 'undisclosed')
const roundKey = (r) => `${(r.date || '').slice(0, 7)}|${r.type}`

/** Merges an incoming record into an existing one without discarding anything; returns the proposal and a readable diff. */
export function mergeRecords(existing, incoming) {
  const out = structuredClone(existing)
  const diff = []
  const have = new Set(out.rounds.map(roundKey))
  const haveYearType = new Set(out.rounds.map((r) => `${(r.date || '').slice(0, 4)}|${r.type}|${r.amount?.value ?? ''}`))
  for (const r of incoming.rounds || []) {
    if (have.has(roundKey(r)) || haveYearType.has(`${(r.date || '').slice(0, 4)}|${r.type}|${r.amount?.value ?? ''}`)) continue
    out.rounds.push(r); diff.push(`+ round ${r.type} ${r.date ?? 'undated'} ${money(r.amount)}${r.leads?.length ? ' led by ' + r.leads.join(', ') : ''}`)
  }
  out.rounds.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'))
  if (incoming.status && incoming.status !== existing.status && incoming.status !== 'active' && incoming.statusEvent) {
    out.status = incoming.status; out.statusEvent = incoming.statusEvent; diff.push(`status ${existing.status} → ${incoming.status}`)
  }
  if (incoming.totalRaised && incoming.totalRaised.value !== existing.totalRaised?.value) { out.totalRaised = incoming.totalRaised; diff.push(`total raised → ${money(incoming.totalRaised)}`) }
  for (const k of ['website', 'story', 'product', 'wedge', 'became', 'differentiator', 'firstRaiseEvidence']) if (out[k] == null && incoming[k] != null) { out[k] = incoming[k]; diff.push(`filled ${k}`) }
  for (const k of ['founders', 'competitors', 'firstCustomers']) if (!(out[k] || []).length && (incoming[k] || []).length) { out[k] = incoming[k]; diff.push(`filled ${k}`) }
  const urls = new Set(out.sources.map((s) => s.url))
  for (const s of incoming.sources || []) if (!urls.has(s.url)) { out.sources.push(s); urls.add(s.url) }
  if (diff.length) out.lastVerified = incoming.lastVerified || today()
  return { record: out, diff }
}

/** Normalises what the model returned, verifies every fact against its source, deduplicates and appends to the review queue. */
const AUTO_APPROVE = () => (process.env.ATLAS_AUTO_APPROVE || 'verified').toLowerCase() !== 'off'

export async function fileResults(job, payload, log, { complete, signal, verify = verifyRecord, merged = { n: 0 } } = {}) {
  const existing = loadCompanies()
  const queue = readQueue()
  let added = 0
  for (const raw of payload.companies || []) {
    if (!raw || typeof raw !== 'object' || !raw.name) continue
    const c = { aliases: [], website: null, statusEvent: null, story: null, founders: [], product: null, wedge: null, became: null, differentiator: null, competitors: [], rounds: [], totalRaised: null, firstRaiseEvidence: null, firstCustomers: [], sources: [], ...raw }
    c.id = c.id || slugify(c.name)
    if (queue.some((q) => q.state === 'pending' && findDuplicate(c, [q.record]))) { log(`· ${c.name}: already waiting in the review queue, skipped`); continue }
    // Second pass: nothing the researcher claimed is kept unless the cited page, fetched by this server, backs it up.
    let verification = null
    if (complete) {
      log(`Verifying ${c.name}…`)
      try { const v = await verify(c, { complete, onLog: log, signal }); verification = { summary: v.summary, results: v.results }; log(`  ${c.name}: ${v.summary.confirmed + v.summary.corrected} confirmed${v.summary.corrected ? ` (${v.summary.corrected} corrected from the page)` : ''}, ${v.summary.removed} removed, ${v.summary.unconfirmed} could not be confirmed`) }
      catch (e) { log(`  ${c.name}: verification failed (${e.message}); queued as unverified`, 'error') }
    }
    const dup = findDuplicate(c, existing)
    let item
    if (dup) {
      const { record, diff } = mergeRecords(dup, c)
      if (!diff.length) { log(`· ${c.name}: already tracked, nothing new that survived verification`); continue }
      item = { kind: 'update', existingId: dup.id, record, diff, problems: validateCompany(record) }
    } else {
      item = { kind: 'new', existingId: null, record: c, diff: [], problems: validateCompany(c) }
    }
    // Fully verified records go straight onto the atlas; anything with an unconfirmed or removed fact waits for a human.
    const clean = verification && verification.summary.checked > 0 && verification.summary.removed === 0 && verification.summary.unconfirmed === 0 && item.problems.length === 0
    if (clean && AUTO_APPROVE()) {
      const all = loadCompanies(), i = all.findIndex((x) => x.id === (item.existingId || item.record.id))
      if (i >= 0) all[i] = item.record; else all.push(item.record)
      saveCompanies(all); existing.splice(0, existing.length, ...all)
      queue.push({ id: `${Date.now().toString(36)}-${c.id}`, state: 'approved', auto: true, jobId: job.id, createdAt: new Date().toISOString(), resolvedAt: new Date().toISOString(), notes: payload.notes || null, verification, ...item })
      saveQueue(queue); merged.n++
      log(`✓ added to the atlas: ${item.record.name} (${verification.summary.checked} fact${verification.summary.checked > 1 ? 's' : ''} confirmed on source)`, 'done')
      continue
    }
    queue.push({ id: `${Date.now().toString(36)}-${c.id}`, state: 'pending', jobId: job.id, createdAt: new Date().toISOString(), notes: payload.notes || null, verification, ...item })
    saveQueue(queue)
    added++
    log(`${item.kind === 'new' ? '＋ new' : '△ update'}: ${item.record.name}${item.problems.length ? ` (${item.problems.length} schema problem${item.problems.length > 1 ? 's' : ''}: needs fixing before approval)` : ''}`)
  }
  return added
}

/** Runs the source check on a pending item that was queued without one (or re-runs it). */
export async function verifyQueueItem(id) {
  const provider = getProvider()
  const item = readQueue().find((q) => q.id === id && q.state === 'pending')
  if (!item) throw new Error('No such pending item')
  for (const f of [...item.record.rounds, item.record.founded, item.record.statusEvent, item.record.totalRaised]) if (f && f.check !== 'confirmed') { delete f.check; delete f.checkNote }
  const v = await verifyRecord(item.record, { complete: provider.complete })
  const queue = readQueue(), i = queue.findIndex((q) => q.id === id)
  if (i < 0) throw new Error('The item was resolved while it was being checked')
  queue[i] = { ...queue[i], record: v.record, verification: { summary: v.summary, results: v.results }, problems: validateCompany(v.record) }
  saveQueue(queue)
  return queue[i]
}

export function resolveQueueItem(id, action) {
  const queue = readQueue()
  const item = queue.find((q) => q.id === id)
  if (!item || item.state !== 'pending') throw new Error('No such pending item')
  if (action === 'approve') {
    const problems = validateCompany(item.record)
    if (problems.length) throw new Error('Record does not pass the schema: ' + problems.join('; '))
    const all = loadCompanies()
    const i = all.findIndex((c) => c.id === (item.existingId || item.record.id))
    if (i >= 0) all[i] = item.record; else all.push(item.record)
    saveCompanies(all)
  }
  item.state = action === 'approve' ? 'approved' : 'rejected'
  item.resolvedAt = new Date().toISOString()
  // keep the last 200 resolved items as an audit trail
  const pending = queue.filter((q) => q.state === 'pending'), done = queue.filter((q) => q.state !== 'pending').slice(-200)
  saveQueue([...done, ...pending])
  return item
}

// ---- jobs -------------------------------------------------------------------------------------
const jobs = new Map()
export const listJobs = () => [...jobs.values()].map(({ listeners: _l, abort: _a, ...j }) => j).sort((a, b) => b.startedAt.localeCompare(a.startedAt))
export const getJob = (id) => jobs.get(id)

export function startJob({ type, domain, query }) {
  const running = [...jobs.values()].find((j) => j.state === 'running' && j.type === type && j.domain === domain && j.query === query)
  if (running) return running
  const abort = new AbortController()
  const job = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, type, domain: domain || null, query: query || null, state: 'running', startedAt: new Date().toISOString(), finishedAt: null, log: [], queued: 0, merged: 0, listeners: new Set(), abort }
  jobs.set(job.id, job)
  const log = (text, level = 'info') => { const line = { t: Date.now(), level, text }; job.log.push(line); for (const l of job.listeners) l({ type: 'log', line }) }
  const finish = (state) => { if (job.state !== 'running') return; job.state = state; job.finishedAt = new Date().toISOString(); for (const l of job.listeners) l({ type: 'done', state, queued: job.queued, merged: job.merged ?? 0 }) }
  ;(async () => {
    let provider
    try { provider = getProvider() } catch (e) { log(`AI is not set up: ${e.message}. See the README, "Connect an AI provider".`, 'error'); return finish('failed') }
    log(`Step 1 of 2: research with ${provider.label}${provider.model ? ` (${provider.model})` : ''} — ${type === 'refresh' ? 'fetch latest: ' + domain : 'add: ' + query}`)
    try {
      const text = await provider.research(buildPrompt(job), { onLog: log, signal: abort.signal })
      const payload = extractJson(text)
      if (!payload) { log('The run finished but returned no parseable JSON. Nothing was queued.', 'error'); return finish('failed') }
      const n = (payload.companies || []).length
      log(`Step 2 of 2: verifying ${n} record${n === 1 ? '' : 's'} against their sources`)
      const merged = { n: 0 }
      job.queued = await fileResults(job, payload, log, { complete: provider.complete, signal: abort.signal, merged })
      job.merged = merged.n
      if (payload.notes) log(`Researcher notes: ${String(payload.notes).slice(0, 600)}`, 'note')
      if (type === 'refresh') { const m = readMeta(); m.lastRefresh = { ...m.lastRefresh, [domain]: today() }; writeJson(META, m) }
      log(`Done: ${merged.n} added to the atlas, ${job.queued} waiting in the review queue.`, 'done')
      finish('done')
    } catch (e) { if (job.state === 'running') { log(abort.signal.aborted ? 'Cancelled.' : `Run failed: ${e.message}`, 'error'); finish(abort.signal.aborted ? 'cancelled' : 'failed') } }
  })()
  return job
}

export function cancelJob(id) {
  const job = jobs.get(id)
  if (job?.state === 'running') job.abort.abort()
  return job
}
