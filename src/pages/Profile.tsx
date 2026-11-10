import { Camera, Check, Search, Trash2 } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useAuth } from '@/auth/AuthProvider'
import { Avatar } from '@/components/Avatar'
import { PageHeader } from '@/components/AppShell'
import { useToast } from '@/components/Toast'
import { Button, Field } from '@/components/ui'
import { PROFILE_ICONS, ProfileIcon } from '@/design/icons'
import { MEMBER_COLORS } from '@/design/tokens'
import { contrast, normaliseHex, readableOn, tooLightOnWhite } from '@/lib/color'
import { prepareAvatar, validateAvatarFile } from '@/lib/image'
import { errorMessage, supabase } from '@/lib/supabase'
import { useHousehold } from '@/household/HouseholdProvider'

export function ProfilePage() {
  const { user } = useAuth()
  const { me, updateProfile } = useHousehold()
  const toast = useToast()
  const ids = { name: useId(), hex: useId(), search: useId() }
  const fileRef = useRef<HTMLInputElement>(null)

  const [name, setName] = useState(me?.display_name ?? '')
  const [color, setColor] = useState(me?.accent_color ?? '#3657E8')
  const [hexInput, setHexInput] = useState(me?.accent_color ?? '#3657E8')
  const [icon, setIcon] = useState(me?.icon ?? 'sparkles')
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  // Keep the form in sync if the profile changes elsewhere (another device).
  const [syncedFrom, setSyncedFrom] = useState(me?.updated_at)
  if (me && me.updated_at !== syncedFrom) {
    setSyncedFrom(me.updated_at)
    setName(me.display_name)
    setColor(me.accent_color)
    setHexInput(me.accent_color)
    setIcon(me.icon)
  }

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview)
  }, [preview])

  const dirty = me && (name.trim() !== me.display_name || color !== me.accent_color || icon !== me.icon)
  const isCustom = !MEMBER_COLORS.some((c) => c.hex.toLowerCase() === color.toLowerCase())

  const icons = useMemo(() => {
    const q = query.trim().toLowerCase()
    return Object.entries(PROFILE_ICONS).filter(
      ([key, v]) => !q || key.includes(q) || v.label.toLowerCase().includes(q) || v.tags.includes(q),
    )
  }, [query])

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !user) return
    const invalid = validateAvatarFile(file)
    if (invalid) return toast.error(invalid)
    setUploading(true)
    try {
      const { blob, ext, type } = await prepareAvatar(file)
      const localUrl = URL.createObjectURL(blob)
      setPreview(localUrl)
      const path = `${user.id}/avatar-${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from('avatars').upload(path, blob, { contentType: type, upsert: false })
      if (upErr) throw upErr
      const old = me?.avatar_path
      const res = await updateProfile({ avatar_path: path })
      if (!res.ok) {
        await supabase.storage.from('avatars').remove([path])
        throw new Error(res.error)
      }
      if (old && old !== path) void supabase.storage.from('avatars').remove([old])
      toast.success('Photo updated')
    } catch (err) {
      setPreview(null)
      toast.error(errorMessage(err, 'Couldn’t upload that photo.'))
    } finally {
      setUploading(false)
    }
  }

  const removePhoto = async () => {
    const old = me?.avatar_path
    if (!old) return
    setUploading(true)
    const res = await updateProfile({ avatar_path: null })
    setUploading(false)
    if (!res.ok) return toast.error(res.error)
    setPreview(null)
    void supabase.storage.from('avatars').remove([old])
    toast.show('Photo removed')
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return setNameError('Your flatmates need something to call you.')
    if (trimmed.length > 40) return setNameError('Keep it under 40 characters.')
    setSaving(true)
    const res = await updateProfile({ display_name: trimmed, accent_color: color, icon })
    setSaving(false)
    if (!res.ok) return toast.error(res.error)
    toast.success('Profile saved')
  }

  const applyHex = (value: string) => {
    setHexInput(value)
    const n = normaliseHex(value)
    if (n) setColor(n)
  }

  const previewProfile = me ? { ...me, display_name: name || me.display_name, accent_color: color } : null
  const iconOnWhite = tooLightOnWhite(color) ? '#111111' : color

  return (
    <>
      <PageHeader title="Profile" hideTitleUntilScroll />
      <form onSubmit={save} className="px-4 lg:max-w-xl lg:px-0" noValidate>
        <div className="flex flex-col items-center pt-2 pb-8">
          <div className="relative">
            <Avatar profile={previewProfile} size={112} src={preview ?? undefined} />
            {uploading && (
              <span className="absolute inset-0 flex items-center justify-center rounded-full bg-white/60" aria-hidden>
                <span className="border-ink h-7 w-7 animate-spin rounded-full border-[3px] border-t-transparent" />
              </span>
            )}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              aria-label="Change photo"
              className="pressable bg-ink absolute -right-1 -bottom-1 flex h-11 w-11 items-center justify-center rounded-full text-white ring-4 ring-white"
            >
              <Camera size={20} aria-hidden />
            </button>
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="sr-only" onChange={onPick} tabIndex={-1} />
          <p className="mt-4 flex items-center gap-2 text-[24px] font-extrabold tracking-[-0.02em]">
            {name.trim() || 'Your name'}
            <ProfileIcon name={icon} size={22} strokeWidth={2.2} style={{ color: iconOnWhite }} aria-hidden />
          </p>
          <p className="text-ink-2 text-[15px]">{user?.email}</p>
          {me?.avatar_path && (
            <button type="button" onClick={removePhoto} disabled={uploading} className="text-ink-2 mt-2 inline-flex min-h-11 items-center gap-1.5 text-[15px] font-semibold">
              <Trash2 size={16} aria-hidden /> Remove photo
            </button>
          )}
        </div>

        <div className="flex flex-col gap-8">
          <Field label="Display name" htmlFor={ids.name} error={nameError}>
            <input
              id={ids.name}
              className="field font-semibold"
              value={name}
              maxLength={40}
              onChange={(e) => {
                setName(e.target.value)
                setNameError(null)
              }}
              aria-invalid={!!nameError}
              autoComplete="nickname"
            />
          </Field>

          <fieldset>
            <legend className="mb-3 text-[14px] font-semibold">Your colour</legend>
            <div className="grid grid-cols-6 gap-3" role="radiogroup" aria-label="Your colour">
              {MEMBER_COLORS.map((c) => {
                const selected = c.hex.toLowerCase() === color.toLowerCase()
                return (
                  <button
                    key={c.hex}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={c.label}
                    onClick={() => {
                      setColor(c.hex)
                      setHexInput(c.hex)
                    }}
                    className="pressable flex aspect-square items-center justify-center rounded-full"
                    style={{ backgroundColor: c.hex, color: readableOn(c.hex) }}
                  >
                    {selected && <Check size={20} strokeWidth={3} aria-hidden />}
                  </button>
                )
              })}
            </div>
            <div className="mt-4 flex items-center gap-3">
              <span
                className="h-12 w-12 shrink-0 rounded-full"
                style={{ backgroundColor: normaliseHex(hexInput) ?? color, boxShadow: isCustom ? '0 0 0 2.5px #fff, 0 0 0 4.5px #111' : undefined }}
                aria-hidden
              />
              <label htmlFor={ids.hex} className="sr-only">
                Custom colour (hex)
              </label>
              <input
                id={ids.hex}
                className="field font-mono uppercase"
                value={hexInput}
                maxLength={7}
                onChange={(e) => applyHex(e.target.value)}
                aria-invalid={!normaliseHex(hexInput)}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                placeholder="#3657E8"
              />
            </div>
            {!normaliseHex(hexInput) ? (
              <p className="text-danger mt-2 text-[14px]">Use a 6-digit hex colour like #3657E8.</p>
            ) : contrast(color, '#FFFFFF') < 1.6 ? (
              <p className="text-ink-2 mt-2 text-[14px]">Very light colours are hard to see on white — we’ll use dark text and icons with it.</p>
            ) : null}
          </fieldset>

          <fieldset>
            <legend className="mb-3 text-[14px] font-semibold">Your icon</legend>
            <div className="relative mb-3">
              <Search size={18} className="text-ink-2 pointer-events-none absolute top-1/2 left-4 -translate-y-1/2" aria-hidden />
              <label htmlFor={ids.search} className="sr-only">
                Search icons
              </label>
              <input
                id={ids.search}
                className="field pl-11"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search icons"
                autoComplete="off"
              />
            </div>
            <div className="grid grid-cols-5 gap-2 sm:grid-cols-7" role="radiogroup" aria-label="Your icon">
              {icons.map(([key, { icon: Icon, label }]) => {
                const selected = icon === key
                return (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={label}
                    title={label}
                    onClick={() => setIcon(key)}
                    className="pressable flex aspect-square items-center justify-center rounded-2xl transition-colors"
                    style={selected ? { backgroundColor: color, color: readableOn(color) } : { backgroundColor: 'var(--color-surface-2)' }}
                  >
                    <Icon size={24} strokeWidth={1.9} aria-hidden />
                  </button>
                )
              })}
              {icons.length === 0 && <p className="text-ink-2 col-span-full py-4 text-center">No icons match “{query}”.</p>}
            </div>
          </fieldset>
        </div>

        {/* Save bar appears only when there is something to save. */}
        <div
          className={`bg-surface border-line sticky z-20 -mx-4 mt-8 border-t px-4 pt-3 pb-3 transition-[opacity,transform] duration-200 lg:mx-0 lg:border-t-0 lg:px-0 ${
            dirty ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-2 opacity-0'
          }`}
          style={{ bottom: 'calc(var(--bottom-nav-h) + var(--safe-bottom))' }}
          aria-hidden={!dirty}
        >
          <Button type="submit" size="lg" block loading={saving} disabled={!dirty || !normaliseHex(hexInput)} tabIndex={dirty ? 0 : -1}>
            Save profile
          </Button>
        </div>
      </form>
    </>
  )
}
