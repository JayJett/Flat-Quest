import { useEffect, useId, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useAuth } from '@/auth/AuthProvider'
import { FullScreenLoader, NEXT_KEY, safeNext } from '@/auth/guards'
import { Button, Field } from '@/components/ui'
import { useToast } from '@/components/Toast'
import { errorMessage, supabase } from '@/lib/supabase'
import { AuthLayout } from './SignIn'

/**
 * Landing page for OAuth (Google) and email links. With PKCE the client
 * exchanges ?code= automatically (detectSessionInUrl); we wait for the session.
 */
export function AuthCallbackPage() {
  const [params] = useSearchParams()
  const { session, loading } = useAuth()
  const navigate = useNavigate()
  const providerError = params.get('error_description') ?? params.get('error')
  const [timedOut, setTimedOut] = useState(false)

  useEffect(() => {
    const t = window.setTimeout(() => setTimedOut(true), 12_000)
    return () => window.clearTimeout(t)
  }, [])

  useEffect(() => {
    if (loading || !session) return
    let next = safeNext(params.get('next'))
    try {
      const stored = localStorage.getItem(NEXT_KEY)
      if (next === '/' && stored) next = safeNext(stored)
      localStorage.removeItem(NEXT_KEY)
    } catch {
      /* ignore */
    }
    navigate(next, { replace: true })
  }, [loading, session, params, navigate])

  if (providerError || (timedOut && !session)) {
    return (
      <AuthLayout>
        <h1 className="text-display font-bold">Sign-in didn’t finish</h1>
        <p className="text-ink-2 mt-3 text-[17px]">
          {providerError ?? 'The link may have expired or been opened in a different browser.'}
        </p>
        <Link to="/sign-in" className="pressable bg-ink mt-8 flex min-h-14 items-center justify-center rounded-[18px] font-semibold text-white">
          Back to sign in
        </Link>
      </AuthLayout>
    )
  }
  return <FullScreenLoader label="Signing you in" />
}

export function ResetPasswordPage() {
  const { session, loading } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const id = useId()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (loading) return <FullScreenLoader />
  if (!session) {
    return (
      <AuthLayout>
        <h1 className="text-display font-bold">Link expired</h1>
        <p className="text-ink-2 mt-3">Request a new password reset link from the sign-in screen.</p>
        <Link to="/sign-in" className="text-accent mt-6 font-bold">
          Back to sign in
        </Link>
      </AuthLayout>
    )
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password.length < 8) return setError('Use at least 8 characters.')
    setBusy(true)
    const { error: err } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (err) return setError(errorMessage(err))
    toast.success('Password updated')
    navigate('/', { replace: true })
  }

  return (
    <AuthLayout>
      <h1 className="text-display font-bold">Set a new password</h1>
      <form onSubmit={submit} className="mt-8 flex flex-col gap-4" noValidate>
        <Field label="New password" htmlFor={id} error={error}>
          <input id={id} className="field" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!error} />
        </Field>
        <Button type="submit" size="lg" block loading={busy}>
          Update password
        </Button>
      </form>
    </AuthLayout>
  )
}
