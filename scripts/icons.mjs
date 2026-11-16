#!/usr/bin/env node
// Renders the app icons in public/ from one SVG design:  node scripts/icons.mjs
import fs from 'node:fs'
import path from 'node:path'
import puppeteer from 'puppeteer-core'
import { findChrome } from './chrome.mjs'

const out = path.resolve(import.meta.dirname, '../public')
// rounded: browser/desktop icon. square: Android masks it and iOS rounds it itself; the globe stays inside the safe zone.
const svg = (rounded) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs><radialGradient id="g" cx=".35" cy=".35"><stop offset="0" stop-color="#9fd8ff"/><stop offset=".55" stop-color="#2b6cd0"/><stop offset="1" stop-color="#0b1c3d"/></radialGradient><radialGradient id="h"><stop offset=".6" stop-color="#4db8ff" stop-opacity=".35"/><stop offset="1" stop-color="#4db8ff" stop-opacity="0"/></radialGradient></defs><rect width="32" height="32" rx="${rounded ? 7 : 0}" fill="#05070c"/><circle cx="16" cy="16" r="11.5" fill="url(#h)"/><circle cx="16" cy="16" r="9" fill="url(#g)"/></svg>`
const icons = [['icon-192.png', 192, true], ['icon-512.png', 512, true], ['icon-maskable-512.png', 512, false], ['apple-touch-icon.png', 180, false]]

const browser = await puppeteer.launch({ executablePath: findChrome(), headless: 'new' })
const page = await browser.newPage()
for (const [name, size, rounded] of icons) {
  await page.setViewport({ width: size, height: size })
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg(rounded).replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`)
  await page.screenshot({ path: path.join(out, name), omitBackground: true })
  console.log('wrote public/' + name)
}
await browser.close()
