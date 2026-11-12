import { useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { ArrowDown, ArrowUp, ArrowUpRight, Camera, ChevronRight, Ellipsis, Images, Plus, Sparkles } from 'lucide-react'
import { motion } from 'motion/react'
import { PageHeader } from '@/components/AppShell'
import { Button, Segmented, Spinner } from '@/components/ui'
import { ConfirmSheet, Sheet } from '@/components/Sheet'
import { useToast } from '@/components/Toast'
import { useHousehold } from '@/household/HouseholdProvider'
import { roomColor } from '@/design/tokens'
import { errorMessage, supabase } from '@/lib/supabase'
import { BackButton } from './RoomDetail'
import { useVisualHome } from '@/visual/useVisualHome'
import { MediaImage } from '@/visual/MediaImage'
import { PhotoViewer } from '@/visual/PhotoViewer'
import { UploadSheet } from '@/visual/UploadSheet'
import { VisualEditor } from '@/visual/VisualEditor'
import { TransformationSheet } from '@/visual/TransformationSheet'
import { Comparison } from '@/visual/Comparison'
import { movedOrder, type Transformation, type Visual, type VisualKind } from '@/visual/types'

export function VisualHomePage() {
  const { roomId } = useParams()
  const { household, rooms } = useHousehold()
  const room = rooms.find(r => r.id === roomId)
  const navigate = useNavigate()
  if (!room || !household) return <><PageHeader title="Room not found" back={<BackButton onClick={() => navigate('/rooms')} />} /><p className="p-5">This room may have been removed by a flatmate.</p></>
  return <VisualRoom key={`${household.id}:${room.id}`} room={room} householdId={household.id} />
}

function VisualRoom({ room, householdId }: { room: ReturnType<typeof useHousehold>['rooms'][number]; householdId: string }) {
  const { visuals, transformations, loading, error, load, more, loadMore } = useVisualHome(householdId, room.id)
  const { memberById } = useHousehold()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const section = params.get('gallery')
  const [upload, setUpload] = useState<VisualKind | null>(null)
  const [editing, setEditing] = useState<Visual | 'link' | null>(null)
  const [menu, setMenu] = useState<Visual | null>(null)
  const [viewer, setViewer] = useState<Visual | null>(null)
  const [pair, setPair] = useState<Transformation | 'new' | null>(null)
  const [comparison, setComparison] = useState<Transformation | null>(null)
  const [removing, setRemoving] = useState<Visual | Transformation | null>(null)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  if (viewer && !visuals.some(v => v.id === viewer.id)) setViewer(null)
  const c = roomColor(room.color)
  const photos = visuals.filter(v => v.kind === 'photo')
  const inspirations = visuals.filter(v => v.kind === 'inspiration')
  const grouped = { inspiration: inspirations, photo: photos }
  const remove = async () => {
    if (!removing || busy) return
    if (!navigator.onLine) { toast.error('Reconnect before removing this.'); return }
    setBusy(true)
    const table = 'kind' in removing ? 'room_visuals' : 'room_transformations'
    const r = await supabase.from(table).delete().eq('id', removing.id).eq('updated_at', removing.updated_at).select('id')
    if (r.error) toast.error(errorMessage(r.error))
    else if (!r.data?.length) toast.error('A flatmate changed this. Please check the latest version.')
    else { setRemoving(null); setComparison(null); toast.success('Removed'); }
    await load(); setBusy(false)
  }
  const move = async (visual: Visual, direction: -1 | 1) => {
    if (busy) return
    if (!navigator.onLine) { toast.error('Reconnect before rearranging photos.'); return }
    setBusy(true)
    const rows = grouped[visual.kind]
    const r = await supabase.from('room_visuals').update({ sort_order: movedOrder(rows, rows.findIndex(p => p.id === visual.id), direction) }).eq('id', visual.id).eq('updated_at', visual.updated_at).select('id')
    if (r.error || !r.data?.length) toast.error(r.error ? errorMessage(r.error) : 'A flatmate changed this. Try again.')
    await load(); setBusy(false); setMenu(null)
  }
  const grid = (rows: Visual[], full: boolean) => <div className="columns-2 gap-3 md:columns-3 lg:gap-4">{(full ? rows : rows.slice(0, 6)).map((v, i) => <motion.article key={v.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.18 }} className="mb-4 break-inside-avoid">
    {v.photo_path ? <button style={{ aspectRatio: v.aspect_ratio || 1 }} className="pressable bg-surface-2 block w-full overflow-hidden rounded-[20px]" aria-label={`View ${v.title || `photo ${i + 1}`}`} onClick={e => { e.currentTarget.focus(); setViewer(v) }}><MediaImage path={v.thumbnail_path} alt={v.title || ''} className="h-full w-full object-contain" /></button>
      : <a href={v.source_url!} target="_blank" rel="noopener noreferrer" className="pressable bg-surface-2 flex min-h-40 flex-col justify-between rounded-[20px] p-4"><ArrowUpRight size={24} /><span className="break-words font-bold">{v.title || new URL(v.source_url!).hostname}</span></a>}
    <div className="flex items-start justify-between gap-1 pt-1"><div className="min-w-0 pl-1 pt-2">{v.title && v.photo_path && <p className="break-words text-sm font-bold">{v.title}</p>}<p className="text-ink-3 truncate text-xs">{memberById.get(v.created_by ?? '')?.profile.display_name || 'A flatmate'}{v.taken_on ? ` · ${v.taken_on}` : ''}</p></div><button className="pressable flex h-11 w-11 shrink-0 items-center justify-center rounded-full" aria-label={`Options for ${v.title || `photo ${i + 1}`}`} onClick={() => setMenu(v)}><Ellipsis size={20} /></button></div>
  </motion.article>)}</div>
  const openSection = (kind: string) => { setParams({ gallery: kind }); window.scrollTo({ top: 0 }) }
  const heading = section === 'inspiration' ? 'Our inspiration' : section === 'photo' ? 'Our flat photos' : section === 'transformations' ? 'Before & after' : room.name
  return <>
    <PageHeader title={heading} back={<BackButton onClick={() => section ? setParams({}) : navigate(`/rooms/${room.id}`)} />} />
    <div className="px-4 lg:px-0">
      {!section && <><div className="mb-5"><Segmented label="Room view" value="visual" onChange={() => navigate(`/rooms/${room.id}`)} options={[{ value: 'checklist', label: 'Checklist' }, { value: 'visual', label: 'Visual Home' }]} /></div><div className="mb-8"><span className="mb-3 inline-flex rounded-full px-3 py-1 text-xs font-bold" style={{ backgroundColor: c.hex, color: c.on }}>{room.name}</span><h1 className="text-[32px] leading-[1.08] font-extrabold tracking-tight">A place that feels<br />like us.</h1><p className="text-ink-2 mt-3 text-[15px]">The ideas, the little changes, the home we’re making.</p></div></>}
      {loading && <div className="py-10 text-center"><Spinner label="Loading your gallery" /></div>}
      {error && <div role="alert" className="bg-surface-2 mb-6 rounded-2xl p-4"><p>{error}</p><Button variant="ghost" onClick={() => void load()}>Try again</Button></div>}
      {!loading && (['inspiration','photo'] as const).filter(kind => !section || section === kind).map(kind => {
        const rows = grouped[kind]; const Icon = kind === 'photo' ? Camera : Images
        return <section key={kind} className="mb-10" aria-label={kind === 'photo' ? 'Our flat photos' : 'Our inspiration'}>
          <div className="mb-4 flex items-center justify-between gap-2"><h2 className="text-[22px] font-extrabold tracking-tight">{kind === 'photo' ? 'Our flat photos' : 'Our inspiration'}</h2><button className="pressable flex h-11 w-11 items-center justify-center rounded-full bg-surface-2" aria-label={kind === 'photo' ? 'Add flat photos' : 'Add inspiration'} onClick={() => setUpload(kind)}><Plus size={22} /></button></div>
          {rows.length ? grid(rows, !!section) : <div className="bg-surface-2 rounded-[24px] px-6 py-9 text-center"><Icon className="mx-auto mb-4" size={30} strokeWidth={1.4} /><h3 className="text-lg font-bold">{kind === 'photo' ? 'Every home starts somewhere' : 'What feels like home?'}</h3><p className="text-ink-2 mx-auto mt-2 max-w-xs text-sm">{kind === 'photo' ? 'The empty room. The first lamp. The corner you love. Keep those moments here.' : 'Colours, cosy corners, a beautiful chair. Collect the things you love, together.'}</p><Button className="mt-5" variant="ink" onClick={() => setUpload(kind)}>{kind === 'photo' ? 'Add our first photos' : 'Add our first inspiration'}</Button></div>}
          <div className="mt-2 flex items-center justify-between">{kind === 'inspiration' ? <button className="pressable text-ink-2 min-h-11 text-sm font-semibold" onClick={() => setEditing('link')}>Save a link</button> : <span />}{!section && rows.length > 0 && <button className="pressable flex min-h-11 items-center gap-1 text-sm font-bold" onClick={() => openSection(kind)}>View all <ChevronRight size={17} /></button>}</div>
        </section>
      })}
      {!loading && (!section || section === 'transformations') && <section className="mb-8" aria-label="Before and after transformations"><div className="mb-4 flex items-center justify-between"><h2 className="text-[22px] font-extrabold tracking-tight">Before & after</h2><button className="pressable flex h-11 w-11 items-center justify-center rounded-full bg-surface-2" aria-label="Create transformation" onClick={() => photos.length < 2 ? toast.show('Add two flat photos first, then pair them here.') : setPair('new')}><Plus size={22} /></button></div>
        {transformations.length ? <div className="grid gap-5 sm:grid-cols-2">{(section ? transformations : transformations.slice(0, 2)).map(t => {
          const before = visuals.find(v => v.id === t.before_id); const after = visuals.find(v => v.id === t.after_id)
          if (!before || !after) return null
          return <button key={t.id} className="pressable text-left" onClick={() => setComparison(t)}><div className="grid grid-cols-2 gap-1 overflow-hidden rounded-[22px]"><MediaImage path={before.thumbnail_path} alt="Before" className="aspect-[3/4] w-full object-contain bg-surface-2" /><MediaImage path={after.thumbnail_path} alt="After" className="aspect-[3/4] w-full object-contain bg-surface-2" /></div><div className="mt-2 flex justify-between text-xs font-semibold text-ink-2"><span>Before</span><span>After</span></div><p className="mt-2 font-bold">{t.title || 'Look how far we’ve come'}</p></button>
        })}</div> : <div className="bg-surface-2 rounded-[24px] px-6 py-9 text-center"><Sparkles className="mx-auto mb-4" size={30} strokeWidth={1.4} /><h3 className="text-lg font-bold">Little changes. A big difference.</h3><p className="text-ink-2 mx-auto mt-2 max-w-xs text-sm">Pair two flat photos to see your room coming together.</p><Button variant="ink" className="mt-5" onClick={() => photos.length < 2 ? setUpload('photo') : setPair('new')}>{photos.length < 2 ? 'Add flat photos' : 'Make a comparison'}</Button></div>}
        {!section && transformations.length > 2 && <button className="pressable mt-3 min-h-11 font-bold" onClick={() => openSection('transformations')}>View all transformations</button>}
      </section>}
      {more && <Button variant="secondary" block onClick={loadMore}>Load more photos</Button>}
    </div>
    {upload && <UploadSheet kind={upload} householdId={householdId} roomId={room.id} onClose={() => setUpload(null)} onSaved={load} />}
    {editing && <VisualEditor visual={editing === 'link' ? null : editing} householdId={householdId} roomId={room.id} onClose={() => setEditing(null)} onSaved={load} />}
    {viewer && grouped[viewer.kind].some(p => p.photo_path) && <PhotoViewer photos={grouped[viewer.kind].filter(p => p.photo_path)} initial={viewer.id} onClose={() => setViewer(null)} />}
    {pair && <TransformationSheet photos={photos} existing={pair === 'new' ? undefined : pair} householdId={householdId} roomId={room.id} onClose={() => setPair(null)} onSaved={load} />}
    {menu && <Sheet open onClose={() => setMenu(null)} title={menu.title || 'Photo options'} busy={busy}><div className="flex flex-col gap-2"><Button variant="secondary" onClick={() => { setEditing(menu); setMenu(null) }}>Edit details</Button>{menu.source_url && <a className="pressable min-h-12 py-3 text-center font-semibold" href={menu.source_url} target="_blank" rel="noopener noreferrer">Open source link</a>}<div className="flex gap-2"><Button variant="secondary" block disabled={grouped[menu.kind][0]?.id === menu.id || busy} icon={<ArrowUp size={18} />} onClick={() => void move(menu, -1)}>Move earlier</Button><Button variant="secondary" block disabled={grouped[menu.kind].at(-1)?.id === menu.id || busy} icon={<ArrowDown size={18} />} onClick={() => void move(menu, 1)}>Move later</Button></div><Button variant="danger" onClick={() => { setRemoving(menu); setMenu(null) }}>Remove</Button></div></Sheet>}
    {comparison && <Sheet open onClose={() => setComparison(null)} title={comparison.title || 'Before & after'}>{(() => { const before = visuals.find(v => v.id === comparison.before_id); const after = visuals.find(v => v.id === comparison.after_id); return before && after ? <Comparison before={before} after={after} /> : <p>This comparison has changed. Close it to refresh.</p> })()}{comparison.notes && <p className="text-ink-2 mt-4">{comparison.notes}</p>}<div className="mt-5 flex gap-2"><Button variant="secondary" block onClick={() => { setPair(comparison); setComparison(null) }}>Edit</Button><Button variant="danger" block onClick={() => setRemoving(comparison)}>Remove</Button></div></Sheet>}
    <ConfirmSheet open={!!removing} title={removing && 'kind' in removing ? 'Remove this photo or idea?' : 'Remove this transformation?'} body={removing && 'kind' in removing ? transformations.some(t => t.before_id === removing.id || t.after_id === removing.id) ? 'This also removes comparisons using this photo. The other photos will stay.' : 'This removes it from the shared room gallery.' : 'The original flat photos will stay in your gallery.'} confirmLabel="Remove" danger busy={busy} onConfirm={() => void remove()} onClose={() => setRemoving(null)} />
  </>
}
