#!/usr/bin/env node
// Validate data files against the schemas.
//   node scripts/validate.mjs                 -> validates data/companies/*.json and data/events.json
//   node scripts/validate.mjs path/to/file    -> validates one file (array of companies, or of events if the name contains "events")
import fs from 'node:fs'
import path from 'node:path'
import { DATA, readJson, validateCompany, validateEvent } from '../server/validate.mjs'

const args = process.argv.slice(2)
const files = args.length ? args : [...fs.readdirSync(path.join(DATA, 'companies')).filter((f) => f.endsWith('.json')).map((f) => path.join(DATA, 'companies', f)), path.join(DATA, 'events.json')].filter((f) => fs.existsSync(f))
let bad = 0, n = 0
for (const f of files) {
  let list
  try { list = readJson(f) } catch (e) { console.error(`✗ ${f}: not valid JSON (${e.message})`); bad++; continue }
  if (!Array.isArray(list)) { console.error(`✗ ${f}: top level must be an array`); bad++; continue }
  const isEvents = path.basename(f).includes('events')
  const ids = new Set()
  for (const [i, r] of list.entries()) {
    n++
    const errs = isEvents ? validateEvent(r) : validateCompany(r)
    if (r?.id && ids.has(r.id)) errs.push('duplicate id in file')
    ids.add(r?.id)
    if (errs.length) { bad++; console.error(`✗ ${path.basename(f)} [${i}] ${r?.id ?? '?'}:\n   - ${errs.join('\n   - ')}`) }
  }
  console.log(`${path.basename(f)}: ${list.length} records`)
}
console.log(bad ? `\n${bad} invalid of ${n}` : `\nAll ${n} records valid`)
process.exit(bad ? 1 : 0)
