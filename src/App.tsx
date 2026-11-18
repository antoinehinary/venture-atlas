import { useMemo } from 'react'
import { Inbox } from 'lucide-react'
import './styles.css'
import { AtlasProvider, useAtlas } from './lib/store'
import { Stage } from './globe/Stage'
import { Home } from './views/Home'
import { DomainView } from './views/DomainView'
import { Patterns, PATTERN_TABS } from './views/Patterns'
import { Dossier } from './views/Dossier'
import { JobDock, QueuePage } from './views/Refresh'
import { countWord } from './lib/model'
import { ConnectionPill, OfflineBanner } from './views/Connection'

function Shell() {
  const a = useAtlas()
  const domains = useMemo(() => a.tax.domains.map((d) => ({ id: d.id, color: d.color })), [a.tax])
  const { route } = a
  return (
    <div className={`app view-${route.view}`}>
      <Stage domains={domains} />
      <header className="topbar">
        <a className="brand" href="#/"><span className="brand-mark" />Venture Atlas</a>
        <nav>
          <a href="#/" className={route.view === 'home' || route.view === 'domain' ? 'on' : ''}>Globes</a>
          <a href="#/patterns" className={route.view === 'patterns' ? 'on' : ''}><span className="nav-long">Cross-domain patterns</span><span className="nav-short">Patterns</span></a>
          <a href="#/queue" className={route.view === 'queue' ? 'on' : ''}><Inbox size={14} /> <span className="nav-long">Review queue</span><span className="nav-short">Queue</span>{a.queue.length > 0 && <b className="badge">{a.queue.length}</b>}</a>
        </nav>
        <ConnectionPill />
      </header>
      {a.error && <div className="banner error">Could not load data: {a.error}. Start the server (<code>npm run dev</code>), or on a phone check that Tailscale is on and your servers are set up.</div>}
      <OfflineBanner />
      {a.loading ? <div className="loading">Loading atlas…</div> : (
        <>
          {route.view === 'home' && <Home />}
          {route.view === 'domain' && (a.tax.domains.some((d) => d.id === route.domain) ? <DomainView key={route.domain} domainId={route.domain} tab={route.tab} /> : <div className="loading">Unknown domain. <a href="#/">Back to the globes</a></div>)}
          {route.view === 'patterns' && (
            <main className="page">
              <div className="page-head"><div><p className="eyebrow">All {countWord(a.tax.domains.length)} fields</p><h1>Cross-domain patterns</h1></div></div>
              <div className="tabs">{PATTERN_TABS.map((t) => <a key={t.id} href={`#/patterns/${t.id}`} className={route.tab === t.id ? 'on' : ''}>{t.name}</a>)}</div>
              <Patterns domainId={null} tab={route.tab} />
            </main>
          )}
          {route.view === 'queue' && <QueuePage />}
        </>
      )}
      <Dossier />
      <JobDock />
    </div>
  )
}
export default function App() { return <AtlasProvider><Shell /></AtlasProvider> }
