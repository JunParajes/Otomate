import { expect, test } from '@playwright/test'

/**
 * The code split, held in place.
 *
 * This is the kind of thing that regresses silently: one import of a heavy
 * component from an eagerly-loaded module and the whole chunk is back on the
 * login page, with nothing to show for it but a slower first paint. It happened
 * once already while this was being set up — `@mantine/dropzone/styles.css` was
 * imported in main.tsx, which created a dependency edge from the entry chunk to
 * react-dropzone and pulled 60 KB of image-upload code into the login page.
 *
 * Runs against the production build, since that is the only place chunking
 * exists at all.
 */

async function scriptsLoadedOn(page: import('@playwright/test').Page, url: string) {
  const files: string[] = []
  page.on('response', r => {
    const u = r.url()
    if (u.endsWith('.js')) files.push(u.split('/').pop()!)
  })
  // The service worker would serve the precache and hide what a first visit
  // actually costs.
  await page.context().addInitScript(() => {
    Object.defineProperty(navigator, 'serviceWorker', { get: () => undefined })
  })
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  return files
}

test('the login page does not download pages it cannot show', async ({ page }) => {
  const files = await scriptsLoadedOn(page, '/login')

  // Only the product catalogue uploads images; only DSIR entry renders the grid.
  expect(files.some(f => f.startsWith('vendor-upload'))).toBe(false)
  expect(files.some(f => f.startsWith('DsirEntryPage'))).toBe(false)
  expect(files.some(f => f.startsWith('EmployeeDetailPage'))).toBe(false)

  // It does need React, Mantine and the entry chunk.
  expect(files.some(f => f.startsWith('vendor-react'))).toBe(true)
  expect(files.some(f => f.startsWith('index'))).toBe(true)
})

test('vendor code is split from app code, so a deploy does not invalidate it', async ({ page }) => {
  // One bundle meant every deploy re-downloaded React and Mantine on every
  // tablet, several times a day, for a one-line change.
  const files = await scriptsLoadedOn(page, '/login')
  const vendors = files.filter(f => f.startsWith('vendor'))
  expect(vendors.length).toBeGreaterThanOrEqual(2)
})
