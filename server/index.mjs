// Venture Atlas local server: JSON data API, research jobs (SSE), review queue, and the Vite dev server on one port.
import './env.mjs'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import express from 'express'
import { DATA, ROOT, readJson, writeJson, taxonomy, loadCompanies } from './validate.mjs'
import { startJob, listJobs, getJob, cancelJob, readQueue, resolveQueueItem, verifyQueueItem, readMeta } from './pipeline.mjs'
import { describeProvider, getProvider } from './providers.mjs'
import { availableFields, addField, deleteField, fieldImpact } from './fields.mjs'

const aiStatus = () => { const d = describeProvider(); return { available: !d.problem, provider: d.label, model: d.model ?? null, search: d.search ?? null, problem: d.problem ?? null } }

const PORT = Number(process.env.PORT || 5173)
const PROD = process.argv.includes('--prod')
const USER = path.join(DATA, 'user/annotations.json')

const app = express()
const server = http.createServer(app)
app.use(express.json({ limit: '2mb' }))

const wrap = (fn) => (req, res) => { try { fn(req, res) } catch (e) { res.status(400).json({ error: e.message }) } }

app.get('/api/data', wrap((_req, res) => {
  res.json({ taxonomy: taxonomy(), companies: loadCompanies(), events: readJson(path.join(DATA, 'events.json'), []), meta: { ...readMeta(), ai: aiStatus() } })
}))

app.get('/api/user', wrap((_req, res) => res.json(readJson(USER, { stars: [], notes: {} }))))
app.put('/api/user', wrap((req, res) => {
  const { stars, notes } = req.body || {}
  if (!Array.isArray(stars) || typeof notes !== 'object') throw new Error('Expected {stars: [], notes: {}}')
  writeJson(USER, { stars, notes }); res.json({ ok: true })
}))

app.get('/api/queue', wrap((_req, res) => res.json(readQueue().filter((q) => q.state === 'pending'))))
app.post('/api/queue/:id/verify', async (req, res) => { try { res.json(await verifyQueueItem(req.params.id)) } catch (e) { res.status(400).json({ error: e.message }) } })
app.post('/api/queue/:id/:action', wrap((req, res) => {
  if (!['approve', 'reject'].includes(req.params.action)) throw new Error('Unknown action')
  res.json(resolveQueueItem(req.params.id, req.params.action))
}))

// ---- fields (globes) ----
app.get('/api/fields/catalog', wrap((_req, res) => res.json(availableFields())))
app.get('/api/fields/:id/impact', wrap((req, res) => res.json(fieldImpact(req.params.id))))
app.post('/api/fields', async (req, res) => {
  try {
    // For a custom field without subsectors, ask the AI (if one is set up) to propose a few. This is taxonomy, not data: nothing here is a sourced fact.
    const propose = async (name, keywords) => {
      const text = await getProvider().complete(`Propose 5 to 7 subsectors for tracking venture-backed companies in the field "${name}"${keywords.length ? ` (keywords: ${keywords.join(', ')})` : ''}. Reply with only a JSON array of short names, e.g. ["A", "B"].`, { signal: AbortSignal.timeout(45000) })
      return JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1))
    }
    res.json(await addField(req.body || {}, { propose: describeProvider().problem ? undefined : propose }))
  } catch (e) { res.status(400).json({ error: e.message }) }
})
app.delete('/api/fields/:id', wrap((req, res) => res.json(deleteField(req.params.id))))

app.get('/api/jobs', wrap((_req, res) => res.json(listJobs())))
app.post('/api/jobs', wrap((req, res) => {
  const { type, domain, query } = req.body || {}
  const domains = taxonomy().domains.map((d) => d.id)
  if (type === 'refresh') { if (!domains.includes(domain)) throw new Error('Unknown field') }
  else if (type === 'add') { if (!query || !String(query).trim()) throw new Error('Give a company name or URL'); if (domain && !domains.includes(domain)) throw new Error('Unknown domain') }
  else throw new Error('type must be "refresh" or "add"')
  const job = startJob({ type, domain, query: query ? String(query).trim().slice(0, 300) : null })
  res.json({ id: job.id })
}))
app.post('/api/jobs/:id/cancel', wrap((req, res) => { cancelJob(req.params.id); res.json({ ok: true }) }))
app.get('/api/jobs/:id/stream', (req, res) => {
  const job = getJob(req.params.id)
  if (!job) return res.status(404).end()
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
  const send = (ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`)
  for (const line of job.log) send({ type: 'log', line })
  if (job.state !== 'running') { send({ type: 'done', state: job.state, queued: job.queued, merged: job.merged ?? 0 }); return res.end() }
  job.listeners.add(send)
  const ping = setInterval(() => res.write(': ping\n\n'), 20000)
  req.on('close', () => { clearInterval(ping); job.listeners.delete(send) })
})

if (PROD) {
  const dist = path.join(ROOT, 'dist')
  if (!fs.existsSync(dist)) { console.error('No dist/ folder. Run "npm run build" first.'); process.exit(1) }
  app.use(express.static(dist))
  app.use((_req, res) => res.sendFile(path.join(dist, 'index.html')))
} else {
  const { createServer } = await import('vite')
  const vite = await createServer({ root: ROOT, appType: 'spa', server: { middlewareMode: true, hmr: { server } } })
  app.use(vite.middlewares)
}

server.on('error', (e) => { if (e.code === 'EADDRINUSE') { console.error(`\n  Port ${PORT} is already in use (an old "vite" dev server?). Stop it, or start on another port:  PORT=5174 npm run dev\n`); process.exit(1) } throw e })
server.listen(PORT, '127.0.0.1', () => console.log(`\n  Venture Atlas  →  http://localhost:${PORT}\n  AI provider: ${aiStatus().available ? `${aiStatus().provider}${aiStatus().model ? ' · ' + aiStatus().model : ''} · search: ${aiStatus().search}` : 'not set up (' + aiStatus().problem + ')'}\n`))
