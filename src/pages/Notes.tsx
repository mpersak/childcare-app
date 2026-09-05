import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore, childName } from '../lib/store'
import { Avatar, Badge, Card, EmptyState, Field, Modal, PageHead } from '../components/ui'
import { formatDate, today } from '../lib/dates'
import { download, notesCSV } from '../lib/exporters'
import type { NoteCategory } from '../types'

const CATEGORIES: NoteCategory[] = ['general', 'incident', 'medical', 'milestone', 'behaviour', 'meal', 'nap']

export default function Notes() {
  const { db, actions } = useStore()
  const { locale } = db.settings
  const [childFilter, setChildFilter] = useState('all')
  const [category, setCategory] = useState<NoteCategory | 'all'>('all')
  const [flaggedOnly, setFlaggedOnly] = useState(false)
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({
    childId: '', date: today(), category: 'general' as NoteCategory,
    title: '', body: '', flagged: false,
  })

  const notes = useMemo(() => {
    const q = query.trim().toLowerCase()
    return db.notes
      .filter(n => childFilter === 'all' || n.childId === childFilter)
      .filter(n => category === 'all' || n.category === category)
      .filter(n => !flaggedOnly || n.flagged)
      .filter(n => !q || `${n.title} ${n.body}`.toLowerCase().includes(q))
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
  }, [db.notes, childFilter, category, flaggedOnly, query])

  const openAdd = () => {
    setDraft(d => ({ ...d, childId: d.childId || db.children[0]?.id || '', date: today() }))
    setAdding(true)
  }

  const save = () => {
    if (!draft.childId) return
    if (!draft.title.trim() && !draft.body.trim()) return
    actions.addNote({ ...draft, author: 'Owner' })
    setAdding(false)
    setDraft({ childId: draft.childId, date: today(), category: 'general', title: '', body: '', flagged: false })
  }

  return (
    <>
      <PageHead
        title="Notes"
        subtitle={`${notes.length} shown · ${db.notes.filter(n => n.flagged).length} flagged`}
        actions={
          <>
            <button className="btn" disabled={db.notes.length === 0}
                    onClick={() => download('notes.csv', notesCSV(db), 'text/csv')}>
              Export CSV
            </button>
            <button className="btn primary" disabled={db.children.length === 0} onClick={openAdd}>
              Add note
            </button>
          </>
        }
      />

      <Card>
        <div className="toolbar">
          <input className="input" placeholder="Search notes" value={query}
                 onChange={e => setQuery(e.target.value)} />
          <select className="input" value={childFilter} onChange={e => setChildFilter(e.target.value)}>
            <option value="all">All children</option>
            {db.children.map(c => <option key={c.id} value={c.id}>{childName(c)}</option>)}
          </select>
          <select className="input" value={category}
                  onChange={e => setCategory(e.target.value as NoteCategory | 'all')}>
            <option value="all">All categories</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <label className="check">
            <input type="checkbox" checked={flaggedOnly} onChange={e => setFlaggedOnly(e.target.checked)} />
            Flagged only
          </label>
        </div>

        {notes.length === 0 ? (
          <EmptyState title="No notes match">
            Notes are the running record for each child — incidents, meals, naps, milestones.
          </EmptyState>
        ) : (
          <ul className="note-list">
            {notes.map(n => {
              const child = db.children.find(c => c.id === n.childId)
              return (
                <li key={n.id} className={n.flagged ? 'flagged' : undefined}>
                  <div className="feed-head">
                    <Avatar child={child} size={24} />
                    <Link to={`/children/${n.childId}`}><strong>{childName(child)}</strong></Link>
                    <Badge tone={n.flagged ? 'bad' : 'muted'}>{n.category}</Badge>
                    <span className="muted small">{formatDate(n.date, locale)}</span>
                    <button className="link" onClick={() => actions.updateNote(n.id, { flagged: !n.flagged })}>
                      {n.flagged ? 'unflag' : 'flag'}
                    </button>
                    <button className="link danger" onClick={() => actions.deleteNote(n.id)}>delete</button>
                  </div>
                  {n.title && <strong className="note-title">{n.title}</strong>}
                  {n.body && <p>{n.body}</p>}
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      <Modal
        open={adding}
        title="Add note"
        onClose={() => setAdding(false)}
        footer={
          <>
            <button className="btn" onClick={() => setAdding(false)}>Cancel</button>
            <button className="btn primary" onClick={save}>Save note</button>
          </>
        }
      >
        <div className="form-grid">
          <Field label="Child">
            <select className="input" value={draft.childId}
                    onChange={e => setDraft({ ...draft, childId: e.target.value })}>
              {db.children.map(c => <option key={c.id} value={c.id}>{childName(c)}</option>)}
            </select>
          </Field>
          <Field label="Date">
            <input className="input" type="date" value={draft.date}
                   onChange={e => setDraft({ ...draft, date: e.target.value })} />
          </Field>
          <Field label="Category">
            <select className="input" value={draft.category}
                    onChange={e => setDraft({ ...draft, category: e.target.value as NoteCategory })}>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Follow-up">
            <label className="check">
              <input type="checkbox" checked={draft.flagged}
                     onChange={e => setDraft({ ...draft, flagged: e.target.checked })} />
              Flag this note
            </label>
          </Field>
          <Field label="Title" wide>
            <input className="input" value={draft.title}
                   onChange={e => setDraft({ ...draft, title: e.target.value })} />
          </Field>
          <Field label="Note" wide>
            <textarea className="input" rows={5} value={draft.body}
                      onChange={e => setDraft({ ...draft, body: e.target.value })} />
          </Field>
        </div>
      </Modal>
    </>
  )
}
