import { Check, Copy, Link2, Share2 } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useState } from 'react'
import type { InviteSummary } from '@/lib/database.types'
import { errorMessage, supabase } from '@/lib/supabase'
import { appUrl } from '@/lib/urls'
import { useHousehold } from '@/household/HouseholdProvider'
import { ConfirmSheet } from './Sheet'
import { useToast } from './Toast'
import { Button, Spinner } from './ui'

const dateFmt = new Intl.DateTimeFormat('en-NZ', { weekday: 'short', day: 'numeric', month: 'short' })
const timeFmt = new Intl.DateTimeFormat('en-NZ', { hour: 'numeric', minute: '2-digit' })

export function expiryText(iso: string, now = Date.now()): string {
  const ms = new Date(iso).getTime() - now
  const days = Math.floor(ms / 86_400_000)
  const when = `${dateFmt.format(new Date(iso))} at ${timeFmt.format(new Date(iso))}`
  if (ms <= 0) return 'Expired'
  if (days >= 2) return `Expires ${when} (in ${days} days)`
  if (days === 1) return `Expires tomorrow, ${when}`
  return `Expires today, ${when}`
}

function peopleText(n: number): string {
  return n === 1 ? '1 more person can join' : `${n} more people can join`
}

/**
 * One invite link per household. The current link can be copied or shared again
 * (its code is kept encrypted server-side). Links made before Phase 2 can't be
 * shown again, so they get an explicit cancel-and-replace path instead.
 */
export function InvitePanel() {
  const { household, members } = useHousehold()
  const toast = useToast()
  const [invites, setInvites] = useState<InviteSummary[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [confirm, setConfirm] = useState<'cancel' | 'replace' | null>(null)
  const hid = household?.id
  const limit = household?.member_limit ?? 4
  const spaces = Math.max(0, limit - members.length)

  const load = useCallback(async () => {
    if (!hid) return
    const { data, error } = await supabase.rpc('get_household_invites', { p_household: hid })
    if (error) {
      setLoadError(errorMessage(error))
      return
    }
    setLoadError(null)
    setInvites(data ?? [])
  }, [hid])

  // Refetch when someone joins (member count changes) and when returning to the app.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch; state is only set after the request resolves
    void load()
  }, [load, members.length])
  useEffect(() => {
    const onVisible = () => document.visibilityState === 'visible' && void load()
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [load])

  const current = invites?.find((i) => !i.is_legacy && i.code)
  const legacy = invites?.filter((i) => i.is_legacy) ?? []
  const link = current?.code ? appUrl(`/join?code=${encodeURIComponent(current.code)}`) : null

  const create = async () => {
    if (!hid) return
    setBusy(true)
    const { error } = await supabase.rpc('create_household_invite', { p_household: hid })
    setBusy(false)
    if (error) {
      toast.error(errorMessage(error))
      void load()
      return
    }
    await load()
    toast.success('Invite link ready')
  }

  const revoke = async (ids: string[]) => {
    for (const id of ids) {
      const { error } = await supabase.rpc('revoke_household_invite', { p_invite: id })
      if (error && !/not found/i.test(error.message)) throw error
    }
  }

  const cancelCurrent = async () => {
    if (!current) return
    setBusy(true)
    try {
      await revoke([current.id])
      toast.show('Invite link cancelled')
    } catch (e) {
      toast.error(errorMessage(e))
    }
    setBusy(false)
    setConfirm(null)
    void load()
  }

  const replaceLegacy = async () => {
    setBusy(true)
    try {
      await revoke(legacy.map((i) => i.id))
      setConfirm(null)
      await create()
    } catch (e) {
      toast.error(errorMessage(e))
      void load()
    }
    setBusy(false)
  }

  const copy = async () => {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      toast.error('Couldn’t copy. Press and hold the link to copy it.')
    }
  }

  const share = async () => {
    if (!link) return
    try {
      await navigator.share({ title: `Join ${household?.name} on Flat Quest`, text: 'Help furnish the flat:', url: link })
    } catch {
      /* cancelled */
    }
  }

  const canShare = typeof navigator !== 'undefined' && 'share' in navigator

  return (
    <section aria-labelledby="invite-h" className="mt-9">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id="invite-h" className="text-title font-bold">
          Invite
        </h2>
        <p className="text-ink-2 text-[15px] font-medium tabular-nums">
          {members.length} of {limit} places filled
        </p>
      </div>

      {loadError ? (
        <div className="bg-danger-soft text-danger rounded-[var(--radius-card)] p-5">
          <p className="font-semibold">{loadError}</p>
          <Button size="sm" variant="secondary" className="mt-3" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      ) : invites === null ? (
        <div className="py-6">
          <Spinner label="Loading invite" />
        </div>
      ) : (
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={spaces === 0 ? 'full' : current ? 'current' : legacy.length ? 'legacy' : 'none'}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            {spaces === 0 ? (
              <div className="bg-surface-2 rounded-[var(--radius-card)] p-5">
                <p className="font-bold">Everyone’s in</p>
                <p className="text-ink-2 mt-1 text-[15px]">The flat has all {limit} flatmates, so invite links are switched off.</p>
              </div>
            ) : current && link ? (
              <div className="bg-surface-2 rounded-[var(--radius-card)] p-5">
                <p className="flex items-center gap-2 font-bold">
                  <span className="bg-green inline-block h-2 w-2 rounded-full" aria-hidden />
                  Invite link active
                </p>
                <p className="text-ink-2 mt-1 text-[15px]">
                  {peopleText(current.people_can_join)} · {expiryText(current.expires_at)}
                </p>
                <p className="bg-surface mt-4 rounded-[var(--radius-control)] px-4 py-3 text-[14px] font-medium break-all select-all">{link}</p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button variant={canShare ? 'secondary' : 'primary'} onClick={copy} icon={copied ? <Check size={18} aria-hidden /> : <Copy size={18} aria-hidden />}>
                    {copied ? 'Copied' : 'Copy link'}
                  </Button>
                  {canShare ? (
                    <Button onClick={share} icon={<Share2 size={18} aria-hidden />}>
                      Share
                    </Button>
                  ) : (
                    <span />
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setConfirm('cancel')}
                  className="text-danger mt-3 min-h-11 text-[15px] font-semibold"
                >
                  Cancel this link
                </button>
              </div>
            ) : legacy.length > 0 ? (
              <div className="bg-surface-2 rounded-[var(--radius-card)] p-5">
                <p className="font-bold">{legacy.length === 1 ? 'An earlier invite link still works' : `${legacy.length} earlier invite links still work`}</p>
                <ul className="text-ink-2 mt-2 flex flex-col gap-1 text-[15px]">
                  {legacy.map((i) => (
                    <li key={i.id}>
                      Made {dateFmt.format(new Date(i.created_at))} · used {i.use_count}× · {expiryText(i.expires_at)}
                    </li>
                  ))}
                </ul>
                <p className="text-ink-2 mt-3 text-[15px]">
                  For security, links made before this update can’t be shown again. If you still have one in a chat, it keeps working until it
                  expires. To get a link you can copy from here, replace it.
                </p>
                <Button variant="secondary" className="mt-4" block loading={busy} onClick={() => setConfirm('replace')}>
                  Cancel and make a new link
                </Button>
              </div>
            ) : (
              <div>
                <p className="text-ink-2 mb-4 text-[15px]">
                  {peopleText(spaces)}. The link lasts 7 days, and you can copy or cancel it here any time.
                </p>
                <Button size="lg" block loading={busy} onClick={create} icon={<Link2 size={20} aria-hidden />}>
                  Create invite link
                </Button>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      )}

      <ConfirmSheet
        open={confirm === 'cancel'}
        title="Cancel this invite link?"
        body="Anyone who hasn’t joined yet won’t be able to use it. You can create a new link afterwards."
        confirmLabel="Cancel link"
        danger
        busy={busy}
        onConfirm={cancelCurrent}
        onClose={() => setConfirm(null)}
      />
      <ConfirmSheet
        open={confirm === 'replace'}
        title="Replace the earlier link?"
        body="The old link will stop working straight away, so anyone you sent it to will need the new one."
        confirmLabel="Cancel old link and make a new one"
        busy={busy}
        onConfirm={replaceLegacy}
        onClose={() => setConfirm(null)}
      />
    </section>
  )
}
