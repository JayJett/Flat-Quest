import { ChevronRight, FileUp, LogOut, RefreshCw } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useAuth } from '@/auth/AuthProvider'
import { PageHeader } from '@/components/AppShell'
import { ConfirmSheet, Sheet } from '@/components/Sheet'
import { useToast } from '@/components/Toast'
import { Button, Field } from '@/components/ui'
import { checklistFromCsv, type ImportRow } from '@/lib/csv'
import { bundledChecklist, runImport } from '@/household/importChecklist'
import { useHousehold } from '@/household/HouseholdProvider'

export function SettingsPage() {
  const { user, signOut } = useAuth()
  const { household, members, updateHousehold, reload } = useHousehold()
  const toast = useToast()
  const navigate = useNavigate()
  const ids = { name: useId(), address: useId() }
  const isOwner = members.some((m) => m.userId === user?.id && m.role === 'owner')
  const [name, setName] = useState(household?.name ?? '')
  const [address, setAddress] = useState(household?.address ?? '')
  const [saving, setSaving] = useState(false)
  const [pending, setPending] = useState<{ rows: ImportRow[]; warnings: string[]; source: string } | null>(null)
  const [importing, setImporting] = useState(false)
  const [confirmSignOut, setConfirmSignOut] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const dirty = household && (name.trim() !== household.name || (address.trim() || null) !== household.address)

  const saveHousehold = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return toast.error('Your flat needs a name.')
    setSaving(true)
    const res = await updateHousehold({ name: name.trim().slice(0, 60), address: address.trim().slice(0, 120) || null })
    setSaving(false)
    if (res.ok) toast.success('Flat details saved')
    else toast.error(res.error)
  }

  const pickCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > 1024 * 1024) return toast.error('That file is too big for a checklist (1 MB max).')
    const text = await file.text()
    const result = checklistFromCsv(text)
    if (result.rows.length === 0) return toast.error(result.warnings[0] ?? 'No items found in that file.')
    if (result.rows.length > 1000) return toast.error('That’s more than 1000 rows — split it into smaller files.')
    setPending({ ...result, source: file.name })
  }

  const doImport = async () => {
    if (!pending || !household) return
    setImporting(true)
    const res = await runImport(household.id, pending.rows)
    setImporting(false)
    if (!res.ok) return toast.error(res.error)
    setPending(null)
    await reload()
    const { itemsCreated, roomsCreated, itemsSkipped } = res.data
    toast.success(
      itemsCreated === 0
        ? 'Already up to date — nothing new to import'
        : `Imported ${itemsCreated} item${itemsCreated === 1 ? '' : 's'}${roomsCreated ? ` and ${roomsCreated} room${roomsCreated === 1 ? '' : 's'}` : ''}${itemsSkipped ? ` (${itemsSkipped} already here)` : ''}`,
    )
  }

  return (
    <>
      <PageHeader title="Settings" hideTitleUntilScroll />
      <div className="px-4 lg:max-w-xl lg:px-0">
        <h1 className="text-display pt-2 pb-6 font-extrabold">Settings</h1>

        <section aria-labelledby="flat-h">
          <h2 id="flat-h" className="text-title mb-4 font-bold">
            Your flat
          </h2>
          <form onSubmit={saveHousehold} className="flex flex-col gap-4">
            <Field label="Flat name" htmlFor={ids.name} hint={isOwner ? undefined : 'Only the person who set up the flat can rename it.'}>
              <input id={ids.name} className="field font-semibold" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} disabled={!isOwner} />
            </Field>
            <Field label="Suburb or address" htmlFor={ids.address}>
              <input id={ids.address} className="field" value={address} onChange={(e) => setAddress(e.target.value)} maxLength={120} disabled={!isOwner} />
            </Field>
            {isOwner && (
              <Button type="submit" variant="secondary" loading={saving} disabled={!dirty} className="self-start">
                Save flat details
              </Button>
            )}
          </form>
          <Link to="/flatmates" className="pressable active:bg-surface-2 -mx-2 mt-4 flex min-h-14 items-center justify-between rounded-2xl px-2 font-semibold">
            Flatmates and invites
            <ChevronRight size={20} className="text-ink-3" aria-hidden />
          </Link>
        </section>

        <hr className="border-line my-8" />

        <section aria-labelledby="import-h">
          <h2 id="import-h" className="text-title font-bold">
            Checklist import
          </h2>
          <p className="text-ink-2 mt-1.5">
            Imports are safe to repeat: anything already imported (same room and item name) is skipped, and nothing is overwritten.
          </p>
          <div className="mt-4 flex flex-col gap-2">
            <button
              onClick={() => setPending({ rows: bundledChecklist(), warnings: [], source: 'Original Flat Quest checklist (Google Sheet)' })}
              className="pressable active:bg-surface-2 -mx-2 flex min-h-16 items-center gap-4 rounded-2xl px-2 text-left"
            >
              <RefreshCw size={22} className="shrink-0" aria-hidden />
              <span>
                <span className="block font-semibold">Restore original checklist</span>
                <span className="text-ink-2 block text-[15px]">Re-adds any of the 103 original items that were deleted</span>
              </span>
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              className="pressable active:bg-surface-2 -mx-2 flex min-h-16 items-center gap-4 rounded-2xl px-2 text-left"
            >
              <FileUp size={22} className="shrink-0" aria-hidden />
              <span>
                <span className="block font-semibold">Import from a CSV file</span>
                <span className="text-ink-2 block text-[15px]">Google Sheets → File → Download → CSV (Checklist tab)</span>
              </span>
            </button>
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" onChange={pickCsv} tabIndex={-1} />
          </div>
        </section>

        <hr className="border-line my-8" />

        <section aria-labelledby="account-h">
          <h2 id="account-h" className="text-title font-bold">
            Account
          </h2>
          <p className="text-ink-2 mt-1.5">Signed in as {user?.email}</p>
          <Link to="/profile" className="pressable active:bg-surface-2 -mx-2 mt-3 flex min-h-14 items-center justify-between rounded-2xl px-2 font-semibold">
            Edit profile
            <ChevronRight size={20} className="text-ink-3" aria-hidden />
          </Link>
          <button
            onClick={() => setConfirmSignOut(true)}
            className="pressable text-danger active:bg-danger-soft -mx-2 flex min-h-14 w-[calc(100%+16px)] items-center gap-3 rounded-2xl px-2 font-semibold"
          >
            <LogOut size={20} aria-hidden /> Sign out
          </button>
        </section>

        <p className="text-ink-2 mt-10 text-[14px]">Flat Quest · Phase 1</p>
      </div>

      <Sheet open={pending !== null} onClose={() => setPending(null)} title="Import checklist">
        {pending && (
          <div className="flex flex-col gap-4">
            <p className="text-ink-2">{pending.source}</p>
            <div className="bg-surface-2 grid grid-cols-2 gap-2 rounded-[var(--radius-card)] p-5">
              <div>
                <p className="text-[28px] font-extrabold tabular-nums">{pending.rows.length}</p>
                <p className="text-ink-2 text-[14px] font-medium">items found</p>
              </div>
              <div>
                <p className="text-[28px] font-extrabold tabular-nums">{new Set(pending.rows.map((r) => r.room)).size}</p>
                <p className="text-ink-2 text-[14px] font-medium">rooms</p>
              </div>
            </div>
            {pending.warnings.length > 0 && (
              <details className="text-[15px]">
                <summary className="min-h-11 cursor-pointer font-semibold">
                  {pending.warnings.length} note{pending.warnings.length === 1 ? '' : 's'} about this file
                </summary>
                <ul className="text-ink-2 mt-1 list-disc pl-5">
                  {pending.warnings.slice(0, 20).map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </details>
            )}
            <p className="text-ink-2 text-[15px]">“Who’s on it” and “Owned by” names are matched to flatmates’ display names; anything unmatched stays unclaimed.</p>
            <Button size="lg" block loading={importing} onClick={doImport}>
              Import
            </Button>
          </div>
        )}
      </Sheet>

      <ConfirmSheet
        open={confirmSignOut}
        title="Sign out?"
        body="You can sign back in any time — your flat’s list stays safe."
        confirmLabel="Sign out"
        danger
        onConfirm={async () => {
          setConfirmSignOut(false)
          await signOut()
          navigate('/sign-in', { replace: true })
        }}
        onClose={() => setConfirmSignOut(false)}
      />
    </>
  )
}
