import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { FIXTURES, FIXTURE_FILE } from './global-setup'

/**
 * The added 201 fields, in a browser.
 *
 * The API round-trip is covered by integration tests, so what is checked here is
 * only what a browser can show: that the derived age and length of service
 * appear as the dates are typed, that the extension reason box appears once a
 * date is set, and that typing into the new boxes does not blank the page.
 *
 * Typing is done with pressSequentially rather than fill. The last crash on this
 * screen — a stale `currentTarget` read inside a state updater — was invisible to
 * fill(), which sets the value in one event; it only broke under real
 * keystrokes.
 */

const { employeeId } = JSON.parse(readFileSync(FIXTURE_FILE, 'utf8')) as { employeeId: string }

async function openRecord(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(FIXTURES.owner.email)
  await page.locator('input[type="password"]').fill(FIXTURES.owner.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(u => !u.pathname.includes('/login'))
  await page.goto(`/admin/employees/${employeeId}`)
  await expect(page.getByRole('button', { name: 'Save record' })).toBeVisible()
}

test('age and length of service appear from the dates, without being stored', async ({ page }) => {
  await openRecord(page)

  await page.getByLabel('Date of birth').fill('1998-04-20')
  await expect(page.getByText(/\d+ years old/)).toBeVisible()

  await page.getByLabel('Date hired').fill('2023-04-10')
  await expect(page.getByText(/of service/)).toBeVisible()

  // Neither is a field anyone can type into — that is the whole point of
  // deriving them. Exact, because getByLabel matches substrings and "Age"
  // otherwise finds "Marriage contract".
  await expect(page.getByLabel('Age', { exact: true })).toHaveCount(0)
  await expect(page.getByLabel('Length of service', { exact: true })).toHaveCount(0)
})

test('the extension reason appears only once a date is set', async ({ page }) => {
  await openRecord(page)

  await expect(page.getByLabel('Why it was extended')).toHaveCount(0)
  await page.getByLabel('Probation extended to').fill('2026-11-01')
  await expect(page.getByLabel('Why it was extended')).toBeVisible()
})

test('the new text fields accept real keystrokes and save', async ({ page }) => {
  await openRecord(page)

  // pressSequentially, not fill — one React event per character.
  await page.getByLabel('Email address').pressSequentially('maria@example.com')
  await page.getByLabel('Birth place').pressSequentially('Davao City')
  await page.getByLabel('Religion').pressSequentially('Roman Catholic')
  await page.getByLabel('Height').pressSequentially('158')
  await page.getByLabel('Weight').pressSequentially('62.5')
  await page.getByLabel('Course or strand').pressSequentially('BS Hotel and Restaurant Management')
  await page.getByLabel('Remarks').pressSequentially('Transferred from Matina.')

  // The page is still alive — a blanked screen loses the heading.
  await expect(page.getByRole('button', { name: 'Save record' })).toBeEnabled()

  await page.getByRole('button', { name: 'Save record' }).click()
  await page.reload()

  await expect(page.getByLabel('Email address')).toHaveValue('maria@example.com')
  await expect(page.getByLabel('Birth place')).toHaveValue('Davao City')
  await expect(page.getByLabel('Height')).toHaveValue('158')
  // Typed in kilos, stored in grams, and read back as the same kilos.
  await expect(page.getByLabel('Weight')).toHaveValue('62.5')
  await expect(page.getByLabel('Remarks')).toHaveValue('Transferred from Matina.')
})
