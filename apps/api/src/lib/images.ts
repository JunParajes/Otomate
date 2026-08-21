import { randomUUID } from 'node:crypto'
import { mkdir, unlink } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

/**
 * Product images live on a Docker volume, not in Postgres — image bytes in a
 * column bloat every query that touches the row and make dumps enormous.
 *
 * Only the generated filename is stored in the database. The uploaded name is
 * never used: "../../etc/passwd" is a real attack.
 */
export const UPLOAD_ROOT = process.env.UPLOAD_DIR ?? '/app/uploads'
const PRODUCTS_DIR = path.join(UPLOAD_ROOT, 'products')

/** Public URL prefix; served unauthenticated so plain <img src> works. */
export const PUBLIC_PREFIX = '/uploads/products'

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024
const MAX_DIMENSION = 1200

export function imageUrl(file: string | null): string | null {
  return file ? `${PUBLIC_PREFIX}/${file}` : null
}

export async function ensureUploadDirs(): Promise<void> {
  await mkdir(PRODUCTS_DIR, { recursive: true })
}

/**
 * Re-encodes whatever was uploaded into a bounded WebP. A phone photo is
 * 4-6MB; this lands under ~150KB. Re-encoding also means we never write bytes
 * we haven't parsed — a file that isn't really an image fails here.
 */
export async function saveProductImage(buffer: Buffer): Promise<string> {
  await ensureUploadDirs()
  const filename = `${randomUUID()}.webp`

  await sharp(buffer)
    // Phone cameras store orientation in EXIF; without this, portrait photos
    // come out sideways.
    .rotate()
    .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toFile(path.join(PRODUCTS_DIR, filename))

  return filename
}

/** Best-effort: a missing file must not fail the request that replaced it. */
export async function deleteProductImage(file: string | null): Promise<void> {
  if (!file) return
  // Defence in depth — imageFile always comes from our own generator, but
  // never let a stored value escape the products directory.
  const safe = path.basename(file)
  try {
    await unlink(path.join(PRODUCTS_DIR, safe))
  } catch {
    /* already gone */
  }
}
