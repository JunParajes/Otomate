import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { FIXTURES, FIXTURE_FILE } from './global-setup'

/**
 * Counting a stack, in a real browser.
 *
 * The parser itself is unit-tested. What is not, and cannot be, is the input
 * hook around it: `press` and `finish` are handed to the keypad once when a box
 * opens, so a closure over the draft freezes at whatever it held then and every
 * key looks like the first. That is a bug this app has had, and only a browser
 * reaches it.
 *
 * The report is seeded through the API, not built by driving four dialogs — the
 * create and add-product flows are already covered by the API tests, and getting
 * here through them would make these fail for reasons unrelated to what they
 * check.
 */

const { reportId } = JSON.parse(readFileSync(FIXTURE_FILE, 'utf8')) as { reportId: string }

async function signIn(page: Page, user: { email: string; password: string }) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(user.email)
  await page.locator('input[type="password"]').fill(user.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(u => !u.pathname.includes('/login'))
}

async function openReport(page: Page) {
  await signIn(page, FIXTURES.owner)
  await page.goto(`/dsir/${reportId}`)
  await expect(page.getByRole('button', { name: 'Add products' })).toBeVisible()
}

const producedBox = (page: Page) => page.getByLabel(`${FIXTURES.product} produced`)

test.describe('counting a stack', () => {
  test('an expression commits its result', async ({ page }) => {
    // 4x5 on the bottom, 3x4 above it. A four-function calculator says 92.
    await openReport(page)
    const produced = producedBox(page)

    await produced.click()
    await produced.fill('4*5+3*4')
    await produced.press('Tab')

    await expect(produced).toHaveValue('32')
  })

  test('× is understood, not stripped to make 45', async ({ page }) => {
    await openReport(page)
    const produced = producedBox(page)

    await produced.click()
    await produced.fill('4×5')
    await produced.press('Tab')

    await expect(produced).toHaveValue('20')
  })

  test('leaving a half-typed sum restores the previous value', async ({ page }) => {
    // Typing "4*5" passes through "4", which parses and commits on the way. Tab
    // away at "4*" and the box must not keep that 4 — a wrong count that looks
    // entirely ordinary once the red border goes.
    await openReport(page)
    const produced = producedBox(page)

    await produced.click()
    await produced.fill('40')
    await produced.press('Tab')
    await expect(produced).toHaveValue('40')

    await produced.click()
    await produced.fill('4*')
    await produced.press('Tab')
    await expect(produced).toHaveValue('40')
  })

  test('the derived sold figure follows what was typed', async ({ page }) => {
    // Sales are derived, never entered. If the row does not recompute, the
    // encoder is looking at a stale number while typing.
    await openReport(page)

    const produced = producedBox(page)
    await produced.click()
    await produced.fill('100')
    await produced.press('Tab')

    const ending = page.getByLabel(`${FIXTURES.product} ending balance`)
    await ending.click()
    await ending.fill('40')
    await ending.press('Tab')

    // 0 opening + 100 produced - 40 left = 60 sold, at ₱3.00 = ₱180.00
    const row = page.locator('tbody tr', { hasText: FIXTURES.product }).first()
    await expect(row).toContainText('60')
    await expect(row).toContainText('180')
  })
})
