export const AVATAR_INPUT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
export const AVATAR_MAX_INPUT_BYTES = 15 * 1024 * 1024
export const AVATAR_SIZE = 512

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
 * Centre-crops to a square, scales to 512px and re-encodes (WebP, or JPEG where
 * WebP encoding isn't supported). Strips EXIF/location data as a side effect.
 */
export async function prepareAvatar(file: File): Promise<{ blob: Blob; ext: 'webp' | 'jpg'; type: string }> {
  const img = await loadImage(file)
  const side = Math.min(img.naturalWidth, img.naturalHeight)
  if (side < 64) throw new Error('That image is too small. Use one at least 64 × 64 pixels.')
  const size = Math.min(AVATAR_SIZE, side)
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Your browser couldn’t process the image.')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size)
  const toBlob = (type: string) => new Promise<Blob | null>((r) => canvas.toBlob(r, type, 0.86))
  const webp = await toBlob('image/webp')
  if (webp && webp.type === 'image/webp') return { blob: webp, ext: 'webp', type: 'image/webp' }
  const jpg = await toBlob('image/jpeg')
  if (!jpg) throw new Error('Your browser couldn’t process the image.')
  return { blob: jpg, ext: 'jpg', type: 'image/jpeg' }
}
