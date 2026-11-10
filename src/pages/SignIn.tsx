import { Eye, EyeOff, Mail } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router'
import { useAuth } from '@/auth/AuthProvider'
import { NEXT_KEY, safeNext } from '@/auth/guards'
import { Wordmark } from '@/components/Logo'
import { Button, Field } from '@/components/ui'
import { errorMessage, supabase, SUPABASE_KEY, SUPABASE_URL } from '@/lib/supabase'
import { appUrl } from '@/lib/urls'

type Mode = 'sign-in' | 'sign-up' | 'forgot'

/** Asks Supabase which providers are enabled so we never show a dead button. */
function useGoogleEnabled(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  useEffect(() => {
    let active = true
    fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_KEY } })
      .then((r) => (r.ok ? r.json() : null))
      .then((s: { external?: Record<string, boolean> } | null) => {
        if (active) setEnabled(Boolean(s?.external?.google))
      })
      .catch(() => active && setEnabled(false))
    return () => {
      active = false
    }
  }, [])
  return enabled
}

function GoogleG() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  )
}

export function SignInPage() {
  const { session, loading } = useAuth()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const [mode, setMode] = useState<Mode>(params.get('mode') === 'sign-up' ? 'sign-up' : 'sign-in')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState<'email' | 'google' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState<{ email: string; kind: 'confirm' | 'reset' } | null>(null)
  const google = useGoogleEnabled()
  const ids = { name: useId(), email: useId(), password: useId() }

  useEffect(() => {
    try {
      if (next !== '/') localStorage.setItem(NEXT_KEY, next)
    } catch {
      /* ignore */
    }
  }, [next])

  if (!loading && session) return <Navigate to={next} replace />

  const callbackUrl = appUrl(`/auth/callback?next=${encodeURIComponent(next)}`)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const trimmedEmail = email.trim()
    if (!/^\S+@\S+\.\S+$/.test(trimmedEmail)) return setError('Enter a valid email address.')
    if (mode !== 'forgot' && password.length < (mode === 'sign-up' ? 8 : 1)) {
      return setError(mode === 'sign-up' ? 'Use at least 8 characters for your password.' : 'Enter your password.')
    }
    if (mode === 'sign-up' && !name.trim()) return setError('What should your flatmates call you?')
    setBusy('email')
    try {
      if (mode === 'sign-in') {
        const { error: err } = await supabase.auth.signInWithPassword({ email: trimmedEmail, password })
        if (err) throw err
      } else if (mode === 'sign-up') {
        const { data, error: err } = await supabase.auth.signUp({
          email: trimmedEmail,
          password,
          options: { data: { display_name: name.trim().slice(0, 40) }, emailRedirectTo: callbackUrl },
        })
        if (err) throw err
        if (!data.session) setSentTo({ email: trimmedEmail, kind: 'confirm' })
      } else {
        const { error: err } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
          redirectTo: appUrl(`/auth/callback?next=${encodeURIComponent('/auth/reset')}`),
        })
        if (err) throw err
        setSentTo({ email: trimmedEmail, kind: 'reset' })
      }
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const withGoogle = async () => {
    setError(null)
    setBusy('google')
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: callbackUrl },
    })
    if (err) {
      setError(errorMessage(err))
      setBusy(null)
    }
  }

  if (sentTo) {
    return (
      <AuthLayout>
        <div className="bg-accent-soft text-accent mb-6 flex h-16 w-16 items-center justify-center rounded-[22px]">
          <Mail size={30} aria-hidden />
        </div>
        <h1 className="text-display font-bold">Check your email</h1>
        <p className="text-ink-2 mt-3 text-[17px]">
          {sentTo.kind === 'confirm'
            ? `We sent a confirmation link to ${sentTo.email}. Open it on this device to finish signing up.`
            : `If there’s an account for ${sentTo.email}, a password reset link is on its way.`}
        </p>
        <Button variant="secondary" size="lg" block className="mt-8" onClick={() => { setSentTo(null); setMode('sign-in') }}>
          Back to sign in
        </Button>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      <h1 className="text-[40px] leading-[1.05] font-light tracking-[-0.03em]">
        {mode === 'sign-up' ? 'Let’s make' : mode === 'forgot' ? 'Forgot your' : 'Welcome'}
        <br />
        <span className="font-extrabold">{mode === 'sign-up' ? 'a home together' : mode === 'forgot' ? 'password?' : 'home'}</span>
      </h1>
      <p className="text-ink-2 mt-3 text-[17px]">
        {mode === 'forgot'
          ? 'We’ll email you a link to set a new one.'
          : 'Plan, claim and tick off everything the flat needs.'}
      </p>

      {mode !== 'forgot' && google && (
        <>
          <Button
            variant="secondary"
            size="lg"
            block
            className="mt-8"
            onClick={withGoogle}
            loading={busy === 'google'}
            icon={busy === 'google' ? undefined : <GoogleG />}
            disabled={busy !== null}
          >
            Continue with Google
          </Button>
          <div className="text-ink-2 my-6 flex items-center gap-3 text-[14px]">
            <span className="bg-line h-px flex-1" />
            or use email
            <span className="bg-line h-px flex-1" />
          </div>
        </>
      )}

      <form onSubmit={submit} className={`flex flex-col gap-4 ${google ? '' : 'mt-8'}`} noValidate>
        {mode === 'sign-up' && (
          <Field label="Your name" htmlFor={ids.name}>
            <input id={ids.name} className="field" value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" maxLength={40} placeholder="e.g. Jarden" />
          </Field>
        )}
        <Field label="Email" htmlFor={ids.email}>
          <input
            id={ids.email}
            className="field"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </Field>
        {mode !== 'forgot' && (
          <Field label="Password" htmlFor={ids.password}>
            <div className="relative">
              <input
                id={ids.password}
                className="field pr-14"
                type={showPassword ? 'text' : 'password'}
                autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'sign-up' ? 'At least 8 characters' : ''}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="text-ink-2 absolute inset-y-0 right-1 flex w-12 items-center justify-center"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={20} aria-hidden /> : <Eye size={20} aria-hidden />}
              </button>
            </div>
          </Field>
        )}

        {error && (
          <p role="alert" className="bg-danger-soft text-danger rounded-2xl px-4 py-3 text-[15px] font-medium">
            {error}
          </p>
        )}

        <Button type="submit" size="lg" block loading={busy === 'email'} disabled={busy !== null} className="mt-2">
          {mode === 'sign-in' ? 'Sign in' : mode === 'sign-up' ? 'Create account' : 'Send reset link'}
        </Button>
      </form>

      <div className="mt-6 flex flex-col items-center gap-1 text-[15px]">
        {mode === 'sign-in' && (
          <>
            <button className="text-ink-2 min-h-11 font-medium" onClick={() => { setMode('forgot'); setError(null) }}>
              Forgot password?
            </button>
            <p className="text-ink-2">
              New here?{' '}
              <button className="text-accent min-h-11 font-bold" onClick={() => { setMode('sign-up'); setError(null) }}>
                Create an account
              </button>
            </p>
          </>
        )}
        {mode !== 'sign-in' && (
          <p className="text-ink-2">
            Already have an account?{' '}
            <button className="text-accent min-h-11 font-bold" onClick={() => { setMode('sign-in'); setError(null) }}>
              Sign in
            </button>
          </p>
        )}
      </div>
    </AuthLayout>
  )
}

export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col px-6"
      style={{ paddingTop: 'calc(var(--safe-top) + 24px)', paddingBottom: 'calc(var(--safe-bottom) + 24px)' }}
    >
      <div className="py-2">
        <Wordmark />
      </div>
      <div className="flex flex-1 flex-col justify-center py-10">{children}</div>
    </div>
  )
}
