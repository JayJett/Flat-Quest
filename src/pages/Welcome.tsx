import { ArrowRight, Link2, LogOut } from 'lucide-react'
import { useEffect, useId, useMemo, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { useAuth } from '@/auth/AuthProvider'
import { FullScreenLoader } from '@/auth/guards'
import { Switch } from '@/components/ItemSheet'
import { useToast } from '@/components/Toast'
import { Button, Field } from '@/components/ui'
import { bundledChecklist, runImport } from '@/household/importChecklist'
import { useHousehold } from '@/household/HouseholdProvider'
import { supabase } from '@/lib/supabase'
import { AuthLayout } from './SignIn'

interface InvitePreview {
  household_name: string
  member_count: number
  is_member: boolean
  spaces_left: number
}

/** Extracts an invite code from a pasted link or bare code. */
export function parseInviteCode(input: string): string | null {
  const t = input.trim()
  if (!t) return null
  try {
    const u = new URL(t)
    const code = u.searchParams.get('code') ?? u.pathname.split('/join/')[1]
    return code ? decodeURIComponent(code) : null
  } catch {
    return /^[A-Za-z0-9_-]{16,64}$/.test(t) ? t : null
  }
}

export function WelcomePage() {
  const { state, me, household, createHousehold, reload } = useHousehold()
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const ids = { name: useId(), address: useId(), invite: useId() }
  const rows = useMemo(() => bundledChecklist(), [])
  const roomCount = useMemo(() => new Set(rows.map((r) => r.room)).size, [rows])

  const [step, setStep] = useState<'choose' | 'create' | 'join'>('choose')
  const [name, setName] = useState('9 Rua Kai Wai')
  const [address, setAddress] = useState('Brooklyn, Wellington')
  const [withChecklist, setWithChecklist] = useState(true)
  const [invite, setInvite] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (state === 'loading') return <FullScreenLoader />
  if (state === 'ready' && household && !busy) return <Navigate to="/" replace />

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return setError('Give your flat a name.')
    setBusy(true)
    setError(null)
    const res = await createHousehold(name.trim().slice(0, 60), address.trim().slice(0, 120))
    if (!res.ok) {
      setBusy(false)
      return setError(res.error)
    }
    if (withChecklist) {
      const imp = await runImport(res.data, rows)
      if (!imp.ok) toast.error(`Your flat was created, but the checklist import failed: ${imp.error}. You can retry from Settings.`)
      else toast.success(`Imported ${imp.data.itemsCreated} items across ${imp.data.roomsCreated} rooms`)
      await reload()
    }
    setBusy(false)
    navigate('/', { replace: true })
  }

  const join = (e: React.FormEvent) => {
    e.preventDefault()
    const code = parseInviteCode(invite)
    if (!code) return setError('Paste the full invite link your flatmate sent you.')
    navigate(`/join?code=${encodeURIComponent(code)}`)
  }

  return (
    <AuthLayout>
      {step === 'choose' && (
        <>
          <p className="text-ink-2 text-[17px] font-medium">Kia ora{me?.display_name ? `, ${me.display_name}` : ''}</p>
          <h1 className="mt-1 text-[40px] leading-[1.05] font-light tracking-[-0.03em]">
            Let’s find
            <br />
            <span className="font-extrabold">your flat</span>
          </h1>
          <div className="mt-10 flex flex-col gap-3">
            <button
              onClick={() => setStep('create')}
              className="pressable bg-accent flex min-h-[88px] items-center justify-between gap-4 rounded-[var(--radius-card)] px-5 text-left text-white"
            >
              <span>
                <span className="block text-[18px] font-bold">Set up our flat</span>
                <span className="block text-[15px] text-white/85">Start the shared checklist</span>
              </span>
              <ArrowRight size={22} aria-hidden />
            </button>
            <button
              onClick={() => setStep('join')}
              className="pressable bg-surface-2 flex min-h-[88px] items-center justify-between gap-4 rounded-[var(--radius-card)] px-5 text-left"
            >
              <span>
                <span className="block text-[18px] font-bold">I have an invite link</span>
                <span className="text-ink-2 block text-[15px]">Join a flatmate’s household</span>
              </span>
              <Link2 size={22} aria-hidden />
            </button>
          </div>
          <button
            onClick={() => void signOut()}
            className="text-ink-2 mt-8 inline-flex min-h-11 items-center gap-2 self-center text-[15px] font-medium"
          >
            <LogOut size={18} aria-hidden /> Sign out
          </button>
        </>
      )}

      {step === 'create' && (
        <form onSubmit={create} className="flex flex-col gap-5" noValidate>
          <h1 className="text-display font-bold">Set up your flat</h1>
          <Field label="Flat name" htmlFor={ids.name}>
            <input id={ids.name} className="field font-semibold" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          </Field>
          <Field label="Suburb or address" htmlFor={ids.address} hint="Only visible to your flatmates">
            <input id={ids.address} className="field" value={address} onChange={(e) => setAddress(e.target.value)} maxLength={120} />
          </Field>
          <label className="bg-surface-2 flex cursor-pointer items-center justify-between gap-4 rounded-[var(--radius-control)] p-4">
            <span>
              <span className="block font-semibold">Start with our checklist</span>
              <span className="text-ink-2 block text-[14px]">
                {rows.length} items across {roomCount} rooms, from the Flat Quest Google Sheet
              </span>
            </span>
            <Switch checked={withChecklist} onChange={setWithChecklist} label="Start with our checklist" />
          </label>
          {error && <p role="alert" className="text-danger font-medium">{error}</p>}
          <Button type="submit" size="lg" block loading={busy}>
            Create flat
          </Button>
          <Button type="button" variant="ghost" block onClick={() => { setStep('choose'); setError(null) }}>
            Back
          </Button>
        </form>
      )}

      {step === 'join' && (
        <form onSubmit={join} className="flex flex-col gap-5" noValidate>
          <h1 className="text-display font-bold">Join your flat</h1>
          <p className="text-ink-2 -mt-2">Ask a flatmate to send you an invite from the Flatmates screen, then paste it here.</p>
          <Field label="Invite link" htmlFor={ids.invite} error={error}>
            <input
              id={ids.invite}
              className="field"
              value={invite}
              onChange={(e) => { setInvite(e.target.value); setError(null) }}
              placeholder="https://…/join?code=…"
              autoCapitalize="off"
              autoComplete="off"
              aria-invalid={!!error}
            />
          </Field>
          <Button type="submit" size="lg" block>
            Continue
          </Button>
          <Button type="button" variant="ghost" block onClick={() => { setStep('choose'); setError(null) }}>
            Back
          </Button>
        </form>
      )}
    </AuthLayout>
  )
}

export function JoinPage() {
  const { acceptInvite } = useHousehold()
  const navigate = useNavigate()
  const toast = useToast()
  const [params] = useSearchParams()
  const code = params.get('code') ?? ''
  const [preview, setPreview] = useState<InvitePreview | 'invalid' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    if (!code) return
    void supabase.rpc('preview_household_invite', { p_code: code }).then(({ data, error: err }) => {
      if (!active) return
      const row = data?.[0]
      setPreview(err || !row ? 'invalid' : row)
    })
    return () => {
      active = false
    }
  }, [code])

  const accept = async () => {
    setBusy(true)
    const res = await acceptInvite(code)
    setBusy(false)
    if (!res.ok) return setError(res.error)
    toast.success('Welcome to the flat!')
    navigate('/', { replace: true })
  }

  const shown = code ? preview : 'invalid'
  if (shown === null) return <FullScreenLoader label="Checking invite" />
  return (
    <AuthLayout>
      {shown === 'invalid' ? (
        <>
          <h1 className="text-display font-bold">Invite not found</h1>
          <p className="text-ink-2 mt-3 text-[17px]">
            This invite link is invalid, used up or has expired. Ask a flatmate to send a fresh one.
          </p>
          <Button variant="secondary" size="lg" block className="mt-8" onClick={() => navigate('/welcome')}>
            Back
          </Button>
        </>
      ) : (
        <>
          <p className="text-ink-2 text-[17px] font-medium">You’re invited to</p>
          <h1 className="text-display mt-1 font-extrabold">{shown.household_name}</h1>
          <p className="text-ink-2 mt-2">
            {shown.member_count} {shown.member_count === 1 ? 'flatmate' : 'flatmates'} already here
          </p>
          {error && (
            <p role="alert" className="text-danger mt-4 font-medium">
              {error}
            </p>
          )}
          {!shown.is_member && shown.spaces_left <= 0 ? (
            <p className="bg-surface-2 mt-8 rounded-[var(--radius-card)] p-5 font-medium">
              This flat is already full. Ask a flatmate if they meant to invite you.
            </p>
          ) : (
            <Button size="lg" block className="mt-10" loading={busy} onClick={shown.is_member ? () => navigate('/') : accept}>
              {shown.is_member ? 'You’re already in. Open it' : 'Join the flat'}
            </Button>
          )}
        </>
      )}
    </AuthLayout>
  )
}
