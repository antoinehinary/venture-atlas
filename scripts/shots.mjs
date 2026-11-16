#!/usr/bin/env node
// Takes screenshots of the running app for visual checks:  node scripts/shots.mjs [baseUrl] [outDir]
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import { findChrome, gpuArgs } from './chrome.mjs'
const base = process.argv[2] || 'http://localhost:5173', out = process.argv[3] || 'shots'
const only = process.argv[4]
fs.mkdirSync(out, { recursive: true })
const browser = await puppeteer.launch({ executablePath: findChrome(), headless: 'new', args: [...gpuArgs(), '--window-size=1500,950'] })
const page = await browser.newPage()
await page.setViewport({ width: 1500, height: 950, deviceScaleFactor: 1 })
const errors = []
page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const shot = async (name, hash, after) => {
  if (only && !name.includes(only)) return
  await page.goto(`${base}/${hash}`, { waitUntil: 'networkidle2' }); await page.evaluate((h) => { location.hash = h.replace(/^#?/, '#') }, hash); await wait(1800)
  if (after) await after()
  await page.screenshot({ path: `${out}/${name}.png` }); console.log('shot', name)
}
await shot('01-home', '#/')
await shot('02-domain-defence', '#/d/defence')
await shot('03-domain-hover', '#/d/space', async () => {
  const p = await page.evaluate(() => { const r = document.querySelector('[data-globe-slot]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })
  for (let dx = -200; dx <= 200; dx += 8) for (let dy = -160; dy <= 60; dy += 8) { await page.mouse.move(p.x + dx, p.y + dy); if (await page.$('.hover-card')) return }
})
await shot('04-dossier', '#/d/robotics/exits', async () => { await page.evaluate(() => document.querySelector('.link.name')?.click()); await wait(600) })
await shot('05-timeline-defence-2022', '#/d/defence', async () => { const r = await page.evaluate(() => { const b = document.querySelector('.tl-track').getBoundingClientRect(); return { x: b.left + b.width * 0.826, y: b.top + 50 } }); await page.mouse.click(r.x, r.y); await wait(900) })
await shot('05-timeline-2016', '#/d/space', async () => { const r = await page.evaluate(() => { const b = document.querySelector('.tl-track').getBoundingClientRect(); return { x: b.left + b.width * 0.62, y: b.top + 50 } }); await page.mouse.click(r.x, r.y); await wait(900) })
for (const t of ['waves', 'speed', 'investors', 'whitespace', 'exits']) await shot(`06-${t}`, `#/d/robotics/${t}`, undefined)
await shot('07-cross-waves', '#/patterns/waves'); await shot('07-cross-whitespace', '#/patterns/whitespace')
await shot('08-queue', '#/queue')
await shot('09-add-field', '#/', async () => { await page.click('.add-field'); await wait(900) })
await shot('10-add-custom', '#/', async () => { await page.click('.add-field'); await wait(700); await page.select('.dialog select', 'custom'); await wait(300) })
await shot('11-delete-field', '#/d/space', async () => { await page.click('.btn.danger'); await wait(900) })
if (errors.length) console.log('PAGE ERRORS:\n' + [...new Set(errors)].join('\n'))
await browser.close()
