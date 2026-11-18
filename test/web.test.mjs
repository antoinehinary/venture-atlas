import test from 'node:test'
import assert from 'node:assert/strict'
import { htmlToText, assertPublicUrl, isBlockedSource, excerpt, sourceTier } from '../server/web.mjs'

test('html is reduced to readable text', () => {
  const { title, text } = htmlToText('<html><head><title>A &amp; B</title><style>p{}</style></head><body><script>x()</script><p>Raised&nbsp;&euro;5&nbsp;million</p><div>led by <b>X</b></div></body></html>')
  assert.equal(title, 'A & B'); assert.match(text, /Raised €5 million\nled by X/)
})
test('local and private addresses are never opened', async () => {
  for (const u of ['http://localhost:5173/api/user', 'http://127.0.0.1/', 'http://10.0.0.4/', 'http://192.168.1.1/', 'http://169.254.169.254/latest/meta-data', 'http://100.101.102.103/', 'http://[::1]/', 'file:///etc/passwd', 'ftp://example.com/', 'http://my-laptop.tail1234.ts.net/'])
    await assert.rejects(assertPublicUrl(u), undefined, u)
})
test('aggregators and social sites are not sources', () => {
  for (const u of ['https://www.crunchbase.com/organization/x', 'https://linkedin.com/company/x', 'https://uk.linkedin.com/in/y', 'https://pitchbook.com/profiles/x', 'not a url']) assert.equal(isBlockedSource(u), true, u)
  for (const u of ['https://techcrunch.com/2024/01/01/x', 'https://www.helsing.ai/newsroom', 'https://en.wikipedia.org/wiki/X']) assert.equal(isBlockedSource(u), false, u)
})
test('sources are ranked: company, official, press, wikipedia', () => {
  const c = { website: 'https://www.acme.io' }
  assert.equal(sourceTier('https://acme.io/news/series-a', c), 'company'); assert.equal(sourceTier('https://www.prnewswire.com/x', c), 'official')
  assert.equal(sourceTier('https://sifted.eu/x', c), 'press'); assert.equal(sourceTier('https://fr.wikipedia.org/wiki/X', c), 'wikipedia')
})
test('long pages are cut around the terms asked for', () => {
  const text = 'intro '.repeat(400) + ' Acme raised $12 million from Northwind. ' + 'filler '.repeat(4000)
  const e = excerpt(text, ['Northwind'], 3000)
  assert.ok(e.length < 4000); assert.match(e, /Acme raised \$12 million/)
})

import { isPrivateIp } from '../server/web.mjs'
test('private, reserved and disguised addresses are refused; public ones are not', () => {
  for (const ip of ['127.0.0.1', '10.0.0.1', '172.16.5.4', '192.168.1.1', '169.254.169.254', '100.100.100.100', '198.18.0.1', '0.0.0.0', '224.0.0.1', '::1', 'fe80::1', 'fd12::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '64:ff9b::7f00:1', '2002:7f00:1::'])
    assert.equal(isPrivateIp(ip), true, ip)
  for (const ip of ['8.8.8.8', '104.20.23.154', '2606:4700:10::6814:179a', '::ffff:8.8.8.8', '::ffff:808:808']) assert.equal(isPrivateIp(ip), false, ip)
})
