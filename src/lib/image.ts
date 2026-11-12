export const AVATAR_INPUT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
export const AVATAR_MAX_INPUT_BYTES = 15 * 1024 * 1024

export function validateAvatarFile(file: File): string | null {
  if (!file.type.startsWith('image/')) return 'Choose a photo (JPEG, PNG or WebP).'
  if (file.type && !AVATAR_INPUT_TYPES.includes(file.type)) return 'That image type isn’t supported. Try a JPEG or PNG.'
  if (file.size > AVATAR_MAX_INPUT_BYTES) return 'That photo is over 15 MB. Try a smaller one.'
  return null
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('We couldn’t read that image. Try a JPEG or PNG.'))
    }
    img.src = url
  })
}

/**
 * Downscales a photo (keeping its shape) to at most `maxEdge` px and re-encodes it
 * as WebP (JPEG fallback). Used for wishlist inspiration photos; strips EXIF.
 */
export async function prepareImage(file: File, maxEdge = 1280): Promise<{ blob: Blob; ext: 'webp' | 'jpg'; width: number; height: number }> {
  const img = await loadImage(file)
  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight))
  const w = Math.max(1, Math.round(img.naturalWidth * scale))
  const h = Math.max(1, Math.round(img.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Your browser couldn’t process the image.')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, w, h)
  const toBlob = (type: string) => new Promise<Blob | null>((r) => canvas.toBlob(r, type, 0.84))
  const webp = await toBlob('image/webp')
  if (webp && webp.type === 'image/webp') return { blob: webp, ext: 'webp', width: w, height: h }
  const jpg = await toBlob('image/jpeg')
  if (!jpg) throw new Error('Your browser couldn’t process the image.')
  return { blob: jpg, ext: 'jpg', width: w, height: h }
}

/** The household-media bucket rejects anything larger (see the storage migration). */
export const MEDIA_MAX_UPLOAD_BYTES = 3 * 1024 * 1024

/**
 * Product photos: validated, downscaled and re-encoded on the device (which also
 * drops EXIF/location metadata), then checked against the bucket's size limit.
 */
export async function prepareProductPhoto(file: File): Promise<{ blob: Blob; ext: 'webp' | 'jpg' }> {
  const invalid = validateAvatarFile(file)
  if (invalid) throw new Error(invalid)
  for (const edge of [1200, 900, 640]) {
    const out = await prepareImage(file, edge)
    if (out.blob.size <= MEDIA_MAX_UPLOAD_BYTES) return out
  }
  throw new Error('That photo is too large even after shrinking. Try a different one.')
}
