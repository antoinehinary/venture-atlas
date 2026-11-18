// One interface over several AI providers, so the atlas works with whichever key you have.
//   provider.research(prompt, { onLog, signal }) -> final text, after the model has searched and read the web
//   provider.complete(prompt, { signal })        -> final text, no tools (used by the verification layer)
//
// Providers:
//   anthropic     Claude through the official SDK, using Anthropic's hosted web search and web fetch
//   openai-style  any OpenAI-compatible chat-completions API (OpenAI, Gemini, DeepSeek, OpenRouter, Mistral, Groq, Ollama…),
//                 with web_search / fetch_page run by this server (server/web.mjs)
//   claude-code   the Claude Code CLI, if it is installed and logged in (no API key needed)
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { webSearch, fetchPage, excerpt, searchBackend, isBlockedSource, BLOCKED_SOURCES } from './web.mjs'

const PRESETS = {
  openai: { key: 'OPENAI_API_KEY', base: 'https://api.openai.com/v1', label: 'OpenAI' },
  gemini: { key: 'GEMINI_API_KEY', base: 'https://generativelanguage.googleapis.com/v1beta/openai', label: 'Google Gemini' },
  deepseek: { key: 'DEEPSEEK_API_KEY', base: 'https://api.deepseek.com', label: 'DeepSeek', model: 'deepseek-chat' },
  openrouter: { key: 'OPENROUTER_API_KEY', base: 'https://openrouter.ai/api/v1', label: 'OpenRouter' },
  mistral: { key: 'MISTRAL_API_KEY', base: 'https://api.mistral.ai/v1', label: 'Mistral' },
  groq: { key: 'GROQ_API_KEY', base: 'https://api.groq.com/openai/v1', label: 'Groq' },
  custom: { key: 'ATLAS_API_KEY', base: null, label: 'Custom endpoint' },
}
// Per research run. Invalid or missing values fall back to the defaults (a typo must never remove a limit).
const posInt = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : d }
const MAX_SEARCHES = posInt(process.env.ATLAS_MAX_SEARCHES, 30), MAX_FETCHES = posInt(process.env.ATLAS_MAX_FETCHES, 45), MAX_TURNS = 60
const RUN_TIMEOUT_MS = posInt(process.env.ATLAS_RUN_TIMEOUT_MIN, 20) * 60000

/** Finds the Claude Code binary: $CLAUDE_BIN, PATH, the usual install paths, then editor extension bundles. Works on macOS, Linux and Windows. */
export function findClaudeCli(env = process.env) {
  if (env.CLAUDE_BIN) return fs.existsSync(env.CLAUDE_BIN) ? env.CLAUDE_BIN : null
  const win = process.platform === 'win32'
  try {
    const out = win
      ? execFileSync('where', ['claude'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
      : execFileSync('/bin/sh', ['-lc', 'command -v claude'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    // `where` lists every match (claude, claude.cmd, claude.ps1…): prefer something we can start
    const hits = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    const p = win ? hits.find((h) => /\.(exe|cmd)$/i.test(h)) : hits[0]
    if (p) return p
  } catch { /* not on PATH */ }
  const home = os.homedir()
  const candidates = win
    ? [path.join(home, '.local/bin/claude.exe'), path.join(home, '.claude/local/claude.exe'), env.APPDATA && path.join(env.APPDATA, 'npm/claude.cmd')]
    : [path.join(home, '.claude/local/claude'), path.join(home, '.local/bin/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude']
  for (const p of candidates) if (p && fs.existsSync(p)) return p
  for (const base of ['.vscode/extensions', '.cursor/extensions', '.vscode-insiders/extensions']) {
    const dir = path.join(home, base)
    if (!fs.existsSync(dir)) continue
    const ver = (n) => (n.match(/(\d+)\.(\d+)\.(\d+)/) || []).slice(1).map(Number)
    const exts = fs.readdirSync(dir).filter((n) => n.startsWith('anthropic.claude-code-')).sort((a, b) => { const x = ver(a), y = ver(b); return y[0] - x[0] || y[1] - x[1] || y[2] - x[2] })
    for (const e of exts) { const p = path.join(dir, e, 'resources/native-binary', win ? 'claude.exe' : 'claude'); if (fs.existsSync(p)) return p }
  }
  return null
}

/** Decides which provider to use from the environment. Returns { id, label, model, search, problem? } and never throws. */
export function describeProvider(env = process.env) {
  const want = (env.ATLAS_PROVIDER || 'auto').toLowerCase()
  const model = env.ATLAS_MODEL || null
  const search = (() => { try { return searchBackend(env) } catch (e) { return { problem: e.message } } })()
  const openaiStyle = (id) => {
    const p = PRESETS[id], base = env.ATLAS_BASE_URL || p.base, m = model || p.model
    const problem = !base ? 'set ATLAS_BASE_URL for a custom endpoint' : !env[p.key] && id !== 'custom' ? `set ${p.key} in .env` : !m ? `set ATLAS_MODEL in .env to a ${p.label} model that supports tool calling` : typeof search === 'object' ? search.problem : null
    return { id, kind: 'openai-style', label: p.label, model: m ?? null, base, apiKey: env[p.key] || env.ATLAS_API_KEY || null, search: typeof search === 'string' ? search : null, problem }
  }
  const anthropic = () => ({ id: 'anthropic', kind: 'anthropic', label: 'Claude (Anthropic API)', model: model || 'claude-opus-5-5', search: 'anthropic hosted', problem: env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN ? null : 'set ANTHROPIC_API_KEY in .env' })
  const cli = () => { const bin = findClaudeCli(env); return { id: 'claude-code', kind: 'claude-code', label: 'Claude Code CLI', model, bin, search: 'claude code', problem: bin ? null : 'Claude Code CLI not found (install it, or set CLAUDE_BIN)' } }
  if (want === 'anthropic' || want === 'claude') return anthropic()
  if (want === 'claude-code') return cli()
  if (PRESETS[want]) return openaiStyle(want)
  if (want !== 'auto') return { id: want, kind: 'none', label: want, model, search: null, problem: `unknown ATLAS_PROVIDER "${want}". Use one of: auto, anthropic, claude-code, ${Object.keys(PRESETS).join(', ')}` }
  if (env.ANTHROPIC_API_KEY) return anthropic()
  for (const id of Object.keys(PRESETS)) if (id !== 'custom' && env[PRESETS[id].key]) return openaiStyle(id)
  if (env.ATLAS_BASE_URL) return openaiStyle('custom')
  const c = cli()
  return c.bin ? c : { id: 'none', kind: 'none', label: 'No AI provider', model: null, search: null, problem: 'no AI provider configured: copy .env.example to .env and add one API key' }
}

export function getProvider(env = process.env) {
  const d = describeProvider(env)
  if (d.problem) throw new Error(d.problem)
  if (d.kind === 'anthropic') return { ...d, research: (p, o) => anthropicRun(d, p, o, true), complete: (p, o) => anthropicRun(d, p, o, false) }
  if (d.kind === 'openai-style') return { ...d, research: (p, o) => openaiRun(d, p, o, true, env), complete: (p, o) => openaiRun(d, p, o, false, env) }
  return { ...d, research: (p, o) => cliRun(d, p, o, true), complete: (p, o) => cliRun(d, p, o, false) }
}

// ---- Anthropic (official SDK, hosted web tools) ---------------------------------------------------
async function anthropicRun(d, prompt, { onLog = () => {}, signal } = {}, tools) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const client = new Anthropic()
  const messages = [{ role: 'user', content: prompt }]
  const base = {
    model: d.model, max_tokens: 64000, messages,
    ...(tools ? { tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: MAX_SEARCHES, blocked_domains: BLOCKED_SOURCES }, { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: MAX_FETCHES }] } : {}),
  }
  // Server-side fallback: if a safety classifier declines a request, the API re-runs it on a fallback model in the same call.
  let useFallback = !process.env.ATLAS_NO_FALLBACK
  // max_uses applies per request, and a long run continues over several requests: count across all of them.
  const used = { search: 0, fetch: 0 }
  for (let turn = 0; turn < 12; turn++) {
    if (tools) {
      const left = { search: MAX_SEARCHES - used.search, fetch: MAX_FETCHES - used.fetch }
      if (left.search <= 0 && left.fetch <= 0) throw new Error(`The research run used its ${MAX_SEARCHES} searches and ${MAX_FETCHES} page reads without finishing`)
      base.tools = [{ type: 'web_search_20260209', name: 'web_search', max_uses: Math.max(1, left.search), blocked_domains: BLOCKED_SOURCES }, { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: Math.max(1, left.fetch) }]
    }
    let message
    const open = () => (useFallback ? client.beta.messages.stream({ ...base, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, { signal }) : client.messages.stream(base, { signal }))
    const run = async () => {
      const stream = open()
      stream.on('contentBlock', (b) => {
        if (b.type === 'server_tool_use' && b.name === 'web_search') { used.search++; onLog(`Searching: ${b.input?.query ?? ''}`) }
        else if (b.type === 'server_tool_use' && b.name === 'web_fetch') { used.fetch++; onLog(`Reading: ${b.input?.url ?? ''}`) }
      })
      return stream.finalMessage()
    }
    try { message = await run() } catch (e) {
      // An account or model without the fallback beta rejects the parameter: retry once without it.
      if (useFallback && e instanceof Anthropic.BadRequestError && /fallback/i.test(e.message)) { useFallback = false; message = await run() }
      else if (e instanceof Anthropic.AuthenticationError) throw new Error('Anthropic rejected the API key (check ANTHROPIC_API_KEY in .env)')
      else if (e instanceof Anthropic.RateLimitError) throw new Error('Anthropic rate limit reached: wait a minute and try again')
      else if (e instanceof Anthropic.APIError) throw new Error(`Anthropic API error ${e.status ?? ''}: ${e.message}`)
      else throw e
    }
    if (message.stop_reason === 'refusal') throw new Error(`The model declined this request (${message.stop_details?.category ?? 'no category given'})`)
    if (message.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: message.content }); continue }   // long tool loop: resume where it paused
    if (message.stop_reason === 'max_tokens') onLog('The answer hit the output limit and may be cut short.', 'error')
    return message.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
  }
  throw new Error('The research run did not finish within the turn limit')
}

// ---- OpenAI-compatible chat completions with our own web tools -----------------------------------
const TOOLS = [
  { type: 'function', function: { name: 'web_search', description: 'Search the web. Returns titles, URLs and snippets. Snippets are leads, not evidence: open the page before using a fact.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Search query' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'fetch_page', description: 'Open a public web page and return its readable text. Use it on every page you cite.', parameters: { type: 'object', properties: { url: { type: 'string', description: 'Full http(s) URL' }, find: { type: 'array', items: { type: 'string' }, description: 'Optional words to look for (company name, "raised", an amount): on long pages the passages around them are returned' } }, required: ['url'] } } },
]
async function runTool(name, args, counts, onLog, env) {
  try {
    if (name === 'web_search') {
      if (++counts.search > MAX_SEARCHES) return 'Search budget for this run is used up. Work from the pages you already have and finish.'
      onLog(`Searching: ${args.query}`)
      const r = await webSearch(String(args.query || ''), { env })
      return r.length ? r.map((x, i) => `${i + 1}. ${x.title}\n${x.url}\n${x.snippet || ''}`).join('\n\n') : 'No results.'
    }
    if (name === 'fetch_page') {
      if (++counts.fetch > MAX_FETCHES) return 'Page budget for this run is used up. Finish with what you have.'
      if (isBlockedSource(args.url)) return 'This site is not accepted as a source (aggregator, social network or profile page). Find the company, investor or press announcement instead.'
      onLog(`Reading: ${args.url}`)
      const p = await fetchPage(String(args.url || ''))
      return p.ok ? `TITLE: ${p.title}\nURL: ${p.url}\n\n${excerpt(p.text, Array.isArray(args.find) ? args.find : [])}` : `Could not open the page: ${p.error}. Do not cite it.`
    }
    return `Unknown tool ${name}`
  } catch (e) { return `Tool failed: ${e.message}` }
}
async function openaiRun(d, prompt, { onLog = () => {}, signal } = {}, tools, env) {
  const messages = [{ role: 'user', content: prompt }], counts = { search: 0, fetch: 0 }
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await fetch(d.base.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(600000)]) : AbortSignal.timeout(600000),
      headers: { 'Content-Type': 'application/json', ...(d.apiKey ? { Authorization: `Bearer ${d.apiKey}` } : {}) },
      body: JSON.stringify({ model: d.model, messages, ...(tools ? { tools: TOOLS, tool_choice: 'auto' } : {}) }),
    })
    if (!res.ok) {
      const body = (await res.text()).slice(0, 400)
      if (res.status === 401 || res.status === 403) throw new Error(`${d.label} rejected the API key`)
      if (res.status === 429) throw new Error(`${d.label} rate limit or quota reached: ${body}`)
      throw new Error(`${d.label} API error ${res.status}: ${body}`)
    }
    const msg = (await res.json()).choices?.[0]?.message
    if (!msg) throw new Error(`${d.label} returned no message`)
    const calls = msg.tool_calls || []
    if (!calls.length) return typeof msg.content === 'string' ? msg.content : (msg.content || []).map((c) => c.text || '').join('')
    messages.push({ role: 'assistant', content: msg.content ?? '', tool_calls: calls })   // provider-specific extras (reasoning fields) are not echoed back
    const results = await Promise.all(calls.map(async (c) => {
      let args = {}
      try { args = JSON.parse(c.function?.arguments || '{}') } catch { return { role: 'tool', tool_call_id: c.id, content: 'Arguments were not valid JSON. Call the tool again.' } }
      return { role: 'tool', tool_call_id: c.id, content: await runTool(c.function?.name, args, counts, onLog, env) }
    }))
    messages.push(...results)
  }
  throw new Error('The research run did not finish within the turn limit')
}

// ---- Claude Code CLI ------------------------------------------------------------------------------
// What the CLI child process may see: system basics and its own login, not the other keys in your .env.
const CLI_ENV_KEEP = /^(PATH|PATHEXT|HOME|USERPROFILE|USER|USERNAME|LOGNAME|SHELL|LANG|LC_[A-Z]+|TMPDIR|TEMP|TMP|SYSTEMROOT|SystemRoot|COMSPEC|APPDATA|LOCALAPPDATA|PROGRAMDATA|XDG_[A-Z_]+|HTTPS?_PROXY|NO_PROXY|https?_proxy|no_proxy|NODE_EXTRA_CA_CERTS|ANTHROPIC_[A-Z_]+|CLAUDE_CONFIG_DIR|CLAUDE_CODE_USE_[A-Z]+|AWS_[A-Z_]+|GOOGLE_[A-Z_]+|CLOUD_ML_REGION)$/
const cliEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => CLI_ENV_KEEP.test(k)))
function cliRun(d, prompt, { onLog = () => {}, signal } = {}, tools) {
  return new Promise((resolve, reject) => {
    // Isolated run: only the web tools (none for checking), none of your MCP servers, settings, hooks or permission rules,
    // no saved session, a turn limit, and (below) a time limit and an environment without your other API keys.
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--tools', tools ? 'WebSearch,WebFetch' : '', ...(tools ? ['--allowedTools', 'WebSearch,WebFetch'] : []), '--strict-mcp-config', '--setting-sources', '', '--no-session-persistence', '--max-turns', String(tools ? MAX_TURNS : 3)]
    if (d.model) args.push('--model', d.model)
    // On Windows an npm-installed CLI is a .cmd script, which Node only starts through the shell; the arguments are fixed
    // flags and the model name, quoted so the empty --tools value survives. The prompt itself goes through stdin.
    const viaShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(d.bin)
    const child = viaShell
      ? spawn(`"${d.bin}"`, args.map((a) => `"${String(a).replace(/"/g, '')}"`), { shell: true, windowsHide: true, cwd: os.tmpdir(), env: cliEnv(), stdio: ['pipe', 'pipe', 'pipe'] })
      : spawn(d.bin, args, { cwd: os.tmpdir(), windowsHide: true, env: cliEnv(), stdio: ['pipe', 'pipe', 'pipe'] })
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM') }, tools ? RUN_TIMEOUT_MS : 180000)
    signal?.addEventListener('abort', () => child.kill('SIGTERM'), { once: true })
    child.stdin.end(prompt)
    let buf = '', final = null, stderr = '', failed = null
    const onEvent = (ev) => {
      if (ev.type === 'assistant') for (const b of ev.message?.content || []) {
        if (b.type === 'tool_use' && b.name === 'WebSearch') onLog(`Searching: ${b.input?.query ?? ''}`)
        else if (b.type === 'tool_use' && b.name === 'WebFetch') onLog(`Reading: ${b.input?.url ?? ''}`)
      }
      if (ev.type === 'result') { final = ev.result ?? ''; if (ev.is_error) failed = String(ev.result).slice(0, 300) }
    }
    child.stdout.on('data', (c) => { buf += c; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) try { onEvent(JSON.parse(line)) } catch { /* partial line */ } } })
    child.stderr.on('data', (c) => { stderr += c })
    child.on('error', (e) => reject(new Error(`Could not start Claude Code: ${e.message}`)))
    child.on('close', (code) => {
      clearTimeout(timer)
      if (signal?.aborted) return reject(new Error('Cancelled'))
      if (timedOut) return reject(new Error(`Claude Code did not finish within the time limit (${tools ? RUN_TIMEOUT_MS / 60000 + ' min' : '3 min'})`))
      if (failed) return reject(new Error(`Claude Code reported an error: ${failed}`))
      if (final == null) return reject(new Error(`Claude Code exited (code ${code}) without a result. ${stderr.trim().slice(0, 300)}`))
      resolve(final)
    })
  })
}
