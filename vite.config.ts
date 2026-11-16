import fs from 'node:fs'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// The app ships with a snapshot of the public data (fields, companies, events) so an installed copy works with no server
// at all. Your own state (stars, notes, the review queue, data/user/, data/queue/) is never put in it.
function snapshot(): Plugin {
  const build = () => {
    const data = path.resolve(import.meta.dirname, 'data')
    const read = (f: string) => JSON.parse(fs.readFileSync(path.join(data, f), 'utf8'))
    const dir = path.join(data, 'companies')
    const companies = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().flatMap((f) => read(path.join('companies', f)))
    return JSON.stringify({ builtAt: new Date().toISOString(), taxonomy: read('taxonomy.json'), companies, events: read('events.json'), meta: { lastRefresh: {} } })
  }
  return {
    name: 'atlas-snapshot',
    generateBundle() { this.emitFile({ type: 'asset', fileName: 'snapshot.json', source: build() }) },
    configureServer(server) { server.middlewares.use('/snapshot.json', (_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(build()) }) },
  }
}

export default defineConfig({
  // Relative paths: the same build works at the root of your server and under /venture-atlas/ on GitHub Pages.
  base: './',
  plugins: [react(), snapshot()],
})
