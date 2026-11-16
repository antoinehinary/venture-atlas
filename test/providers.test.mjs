import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { describeProvider, getProvider } from '../server/providers.mjs'

const NO_CLI = { CLAUDE_BIN: '/nonexistent/claude' }
test('the provider is picked from whichever key is present', () => {
  assert.equal(describeProvider({ ...NO_CLI, ANTHROPIC_API_KEY: 'x' }).id, 'anthropic')
  assert.equal(describeProvider({ ...NO_CLI, OPENAI_API_KEY: 'x', ATLAS_MODEL: 'some-model' }).id, 'openai')
  assert.equal(describeProvider({ ...NO_CLI, GEMINI_API_KEY: 'x', ATLAS_MODEL: 'm' }).base, 'https://generativelanguage.googleapis.com/v1beta/openai')
  assert.equal(describeProvider({ ...NO_CLI, DEEPSEEK_API_KEY: 'x' }).model, 'deepseek-chat')
  assert.equal(describeProvider({ ...NO_CLI, ATLAS_BASE_URL: 'http://localhost:11434/v1', ATLAS_MODEL: 'local' }).id, 'custom')
  assert.equal(describeProvider({ ...NO_CLI, ATLAS_PROVIDER: 'openai', ANTHROPIC_API_KEY: 'x', OPENAI_API_KEY: 'y', ATLAS_MODEL: 'm' }).id, 'openai')
})
test('missing pieces are reported in plain words, not thrown at startup', () => {
  assert.match(describeProvider(NO_CLI).problem, /\.env/)
  assert.match(describeProvider({ ...NO_CLI, OPENAI_API_KEY: 'x' }).problem, /ATLAS_MODEL/)
  assert.match(describeProvider({ ...NO_CLI, ATLAS_PROVIDER: 'nope' }).problem, /unknown/)
  assert.match(describeProvider({ ...NO_CLI, ATLAS_PROVIDER: 'gemini', ATLAS_MODEL: 'm' }).problem, /GEMINI_API_KEY/)
  assert.throws(() => getProvider(NO_CLI))
})
test('an OpenAI-compatible provider can call the web tools and finish', async () => {
  const seen = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      const j = JSON.parse(body); seen.push({ auth: req.headers.authorization, path: req.url, n: j.messages.length, tools: j.tools?.map((t) => t.function.name) })
      const last = j.messages[j.messages.length - 1]
      const message = last.role === 'user' && j.tools
        ? { role: 'assistant', content: null, reasoning_content: 'private', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'fetch_page', arguments: JSON.stringify({ url: 'http://127.0.0.1:1/secret' }) } }, { id: 'c2', type: 'function', function: { name: 'fetch_page', arguments: '{"url": "https://www.crunchbase.com/organization/x"}' } }] }
        : { role: 'assistant', content: 'FINAL: ' + j.messages.filter((m) => m.role === 'tool').map((m) => m.content).join(' | ') }
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message }] }))
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  try {
    const log = []
    const p = getProvider({ ...NO_CLI, ATLAS_PROVIDER: 'custom', ATLAS_BASE_URL: `http://127.0.0.1:${server.address().port}/v1`, ATLAS_API_KEY: 'k', ATLAS_MODEL: 'mock' })
    const out = await p.research('find things', { onLog: (t) => log.push(t) })
    assert.match(out, /^FINAL: /); assert.match(out, /Could not open the page/); assert.match(out, /not accepted as a source/)
    assert.equal(seen[0].auth, 'Bearer k'); assert.equal(seen[0].path, '/v1/chat/completions'); assert.deepEqual(seen[0].tools, ['web_search', 'fetch_page'])
    assert.equal(seen[1].n, 4)
    assert.ok(log.some((l) => l.startsWith('Reading: ')))
    assert.equal(await p.complete('just answer'), 'FINAL: ')   // no tools offered, so the mock answers directly
    assert.equal(seen[2].tools, undefined)
  } finally { server.close() }
})
