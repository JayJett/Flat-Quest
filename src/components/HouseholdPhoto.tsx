import { Camera, House, ImagePlus, Trash2 } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useRef, useState } from 'react'
import { validateAvatarFile } from '@/lib/image'
import { useHousehold } from '@/household/HouseholdProvider'
import { useSignedUrl } from './Avatar'
import { ImageCropper } from './ImageCropper'
import { ConfirmSheet, Sheet } from './Sheet'
import { useToast } from './Toast'
import { Button } from './ui'

/** The shared household picture: rounded square, tap to change. */
export function HouseholdPhoto({ size = 84 }: { size?: number | string }) {
  const { household } = useHousehold()
  const url = useSignedUrl('household-media', household?.photo_path)
  const [menu, setMenu] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const show = url && failed !== url

  return (
    <>
      <button
        type="button"
        onClick={() => setMenu(true)}
        aria-label={household?.photo_path ? 'Change the flat’s photo' : 'Add a photo of the flat'}
        className="pressable bg-surface-2 text-ink-3 relative shrink-0 overflow-hidden rounded-[24px]"
        style={{ width: size, height: size }}
      >
        <AnimatePresence initial={false} mode="popLayout">
          {show ? (
            <motion.img
              key={url}
              src={url}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              onError={() => setFailed(url)}
              draggable={false}
            />
          ) : (
            <motion.span key="empty" className="absolute inset-0 flex items-center justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <House size={34} strokeWidth={1.6} aria-hidden />
            </motion.span>
          )}
        </AnimatePresence>
      </button>
      <HouseholdPhotoSheet open={menu} onClose={() => setMenu(false)} url={show ? url : null} />
    </>
  )
}

export function HouseholdPhotoSheet({ open, onClose, url }: { open: boolean; onClose: () => void; url: string | null }) {
  const { household, setHouseholdPhoto } = useHousehold()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    const invalid = validateAvatarFile(f)
    if (invalid) return toast.error(invalid)
    onClose()
    setFile(f)
  }

  return (
    <>
      <Sheet open={open} onClose={onClose} title="Flat photo">
        <div className="flex flex-col gap-4 pt-1">
          <div className="bg-surface-2 text-ink-3 mx-auto flex aspect-square w-40 items-center justify-center overflow-hidden rounded-[28px]">
            {url ? <img src={url} alt={`Photo of ${household?.name ?? 'the flat'}`} className="h-full w-full object-cover" /> : <House size={48} strokeWidth={1.5} aria-hidden />}
          </div>
          <p className="text-ink-2 text-center text-[15px]">Everyone in {household?.name} sees this photo, and anyone in the flat can change it.</p>
          <Button size="lg" block icon={url ? <Camera size={20} aria-hidden /> : <ImagePlus size={20} aria-hidden />} onClick={() => fileRef.current?.click()} data-autofocus>
            {url ? 'Choose a new photo' : 'Choose a photo'}
          </Button>
          {url && (
            <Button variant="ghost" block className="text-danger" icon={<Trash2 size={18} aria-hidden />} onClick={() => setConfirmRemove(true)}>
              Remove photo
            </Button>
          )}
          <input ref={fileRef} type="file" accept="image/*" className="sr-only" tabIndex={-1} onChange={pick} />
        </div>
      </Sheet>

      <ImageCropper
        file={file}
        title="Position the photo"
        busy={saving}
        onCancel={() => setFile(null)}
        onConfirm={async ({ blob, ext }) => {
          setSaving(true)
          const res = await setHouseholdPhoto(blob, ext)
          setSaving(false)
          if (!res.ok) return toast.error(res.error)
          setFile(null)
          toast.success('Flat photo updated')
        }}
      />

      <ConfirmSheet
        open={confirmRemove}
        title="Remove the flat photo?"
        body="It’ll be removed for everyone. You can add a new one any time."
        confirmLabel="Remove photo"
        danger
        busy={saving}
        onConfirm={async () => {
          setSaving(true)
          const res = await setHouseholdPhoto(null)
          setSaving(false)
          setConfirmRemove(false)
          if (!res.ok) return toast.error(res.error)
          onClose()
          toast.show('Photo removed')
        }}
        onClose={() => setConfirmRemove(false)}
      />
    </>
  )
}
