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
