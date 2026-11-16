import { useEffect, useState } from 'react'
import { Plus, Trash2, X } from 'lucide-react'
import { useAtlas } from '../lib/store'
import { api } from '../lib/api'

type CatalogField = { id: string; name: string; tagline: string; keywords: string[]; subsectors: string[] }

/** The tile at the end of the home grid, and the dialog it opens. */
export function AddFieldTile() {
  const [open, setOpen] = useState(false)
  if (!useAtlas().live) return null
  return (<>
    <button className="home-cell add-field" onClick={() => setOpen(true)}><span><Plus size={26} /></span><b>Add a field</b><i>Pick one from the list or define your own</i></button>
    {open && <AddFieldDialog close={() => setOpen(false)} />}
  </>)
}

function AddFieldDialog({ close }: { close: () => void }) {
  const { reload, go, meta } = useAtlas()
  const [catalog, setCatalog] = useState<CatalogField[] | null>(null)
  const [pick, setPick] = useState(''), [name, setName] = useState(''), [keywords, setKeywords] = useState(''), [subs, setSubs] = useState('')
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null)
  useEffect(() => { api('/api/fields/catalog').then((c: CatalogField[]) => { setCatalog(c); if (c[0]) { setPick(c[0].id); setKeywords(c[0].keywords.join(', ')) } else setPick('custom') }).catch((e) => setErr(e.message)) }, [])
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [close])
  const chosen = catalog?.find((c) => c.id === pick), custom = pick === 'custom'
  const choose = (id: string) => { setPick(id); setErr(null); setKeywords(catalog?.find((c) => c.id === id)?.keywords.join(', ') ?? '') }
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null)
    try {
      const f = await api('/api/fields', { method: 'POST', body: JSON.stringify(custom ? { name, keywords, subsectors: subs } : { catalogId: pick, keywords }) })
      await reload(); close(); go(`#/d/${f.id}`)
    } catch (e) { setErr((e as Error).message); setBusy(false) }
  }
  return (<>
    <div className="scrim" onClick={close} />
    <form className="dialog" onSubmit={save} role="dialog" aria-label="Add a field">
      <header><h2>Add a field</h2><button type="button" className="btn icon" onClick={close} aria-label="Close"><X size={16} /></button></header>
      <label>Field
        <select value={pick} onChange={(e) => choose(e.target.value)} disabled={!catalog}>
          {!catalog && <option>Loading…</option>}
          {catalog?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          <option value="custom">Custom field…</option>
        </select>
      </label>
      {chosen && <p className="dim small">{chosen.tagline}. Subsectors: {chosen.subsectors.join(', ')}.</p>}
      {custom && <label>Name<input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ocean energy" maxLength={40} required /></label>}
      <label>Keywords <span className="dim">(comma-separated; they steer what “Fetch latest” looks for)</span>
        <input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="e.g. wave power, tidal turbines, floating wind" />
      </label>
      {custom && <label>Subsectors <span className="dim">(optional, comma-separated{meta.ai.available ? '; left empty, the AI proposes a few' : ''})</span>
        <input value={subs} onChange={(e) => setSubs(e.target.value)} placeholder="e.g. Wave, Tidal, Floating wind" />
      </label>}
      {err && <div className="banner error">{err}</div>}
      <footer>
        <span className="dim small">A new globe appears empty. Press “Fetch latest” on it to research and verify companies.</span>
        <button type="button" className="btn ghost" onClick={close}>Cancel</button>
        <button className="btn primary" disabled={busy || (custom && name.trim().length < 2) || !pick}>{busy ? 'Saving…' : 'Save'}</button>
      </footer>
    </form>
  </>)
}

/** "Delete field" button with a confirmation that says exactly what will be removed. */
export function DeleteField({ id, name }: { id: string; name: string }) {
  const { reload, go, tax, live } = useAtlas()
  const [impact, setImpact] = useState<{ companiesRemoved: number; companiesKept: number; eventsRemoved: number } | null>(null)
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null)
  const ask = () => { setOpen(true); setErr(null); api(`/api/fields/${id}/impact`).then(setImpact).catch((e) => setErr(e.message)) }
  const del = async () => { setBusy(true); try { await api(`/api/fields/${id}`, { method: 'DELETE' }); go('#/'); await reload() } catch (e) { setErr((e as Error).message); setBusy(false) } }
  if (tax.domains.length <= 1 || !live) return null
  return (<>
    <button className="btn ghost danger" onClick={ask} title="Remove this field and its data"><Trash2 size={13} /> Delete field</button>
    {open && <>
      <div className="scrim" onClick={() => setOpen(false)} />
      <div className="dialog" role="alertdialog" aria-label={`Delete ${name}`}>
        <header><h2>Delete “{name}”?</h2></header>
        {impact ? <p>This removes the globe and deletes its data from disk: <b>{impact.companiesRemoved} compan{impact.companiesRemoved === 1 ? 'y' : 'ies'}</b> and {impact.eventsRemoved} timeline event{impact.eventsRemoved === 1 ? '' : 's'}.{impact.companiesKept > 0 && ` ${impact.companiesKept} compan${impact.companiesKept === 1 ? 'y that also belongs' : 'ies that also belong'} to another field stay there.`} This cannot be undone from the app (use git to restore).</p> : <p className="dim">Counting what would be removed…</p>}
        {err && <div className="banner error">{err}</div>}
        <footer><button className="btn ghost" onClick={() => setOpen(false)}>Keep field</button><button className="btn danger-solid" disabled={busy || !impact} onClick={del}>{busy ? 'Deleting…' : 'Delete field and data'}</button></footer>
      </div>
    </>}
  </>)
}
