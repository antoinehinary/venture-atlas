import test from 'node:test'
import assert from 'node:assert/strict'
import { originAllowed, appOrigins } from '../server/origins.mjs'

const host = 'laptop.tail1234.ts.net'
test('machines on the same tailnet are allowed', () => {
  assert.equal(originAllowed('https://rpi.tail1234.ts.net', host, []), true)
  assert.equal(originAllowed('https://laptop.tail1234.ts.net', 'laptop.tail1234.ts.net:443', []), true)
})
test('other tailnets, plain http and look-alikes are refused', () => {
  assert.equal(originAllowed('https://evil.tail9999.ts.net', host, []), false)
  assert.equal(originAllowed('http://rpi.tail1234.ts.net', host, []), false)
  assert.equal(originAllowed('https://rpi.tail1234.ts.net.evil.com', host, []), false)
  assert.equal(originAllowed('https://x.tail1234.ts.net', 'localhost:5173', []), false)
  assert.equal(originAllowed('https://someone.github.io', host, []), false)
  assert.equal(originAllowed(undefined, host, []), false)
})
test('configured app origins and localhost are allowed', () => {
  const allowed = appOrigins({ ATLAS_APP_ORIGINS: ' https://me.github.io/ , https://other.example ' })
  assert.deepEqual(allowed, ['https://me.github.io', 'https://other.example'])
  assert.equal(originAllowed('https://me.github.io', host, allowed), true)
  assert.equal(originAllowed('http://localhost:5174', host, []), true)
})

import { hostAllowed, sameOrigin } from '../server/origins.mjs'
test('the API only answers to localhost, Tailscale names and listed hosts', () => {
  for (const h of ['localhost:5173', '127.0.0.1:5180', '[::1]:5173', 'laptop.tail1234.ts.net', 'laptop.tail1234.ts.net:8443']) assert.equal(hostAllowed(h, []), true, h)
  for (const h of ['evil.example:5173', 'localhost.evil.example', '', 'ts.net', 'a.b.ts.net.evil.com']) assert.equal(hostAllowed(h, []), false, h)
  assert.equal(hostAllowed('atlas.lan:5173', ['atlas.lan']), true)
})
test('same-origin detection', () => {
  assert.equal(sameOrigin('http://localhost:5180', 'localhost:5180'), true)
  assert.equal(sameOrigin('http://localhost:5181', 'localhost:5180'), false)
})
