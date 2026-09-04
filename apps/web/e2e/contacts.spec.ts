import { expect, test, type Page } from '@playwright/test'
import { FIXTURES } from './global-setup'

/**
 * Several phone numbers on one employee.
 *
 * The API round-trip is covered by integration tests. What is only testable here
 * is the row juggling: the trailing blank row becomes a real one as soon as you
 * type in it, and removing a row has to renumber the rest. That is index
 * arithmetic over an array held in component state, which fails quietly — you
 * get the wrong number against the wrong network rather than an error.
 */

/**
 * Its OWN employee, created per test.
 *
 * This spec is about row arithmetic, so it needs to start from NO numbers —
 * "the blank row becomes row 1" is meaningless if row 1 already exists. It was
 * borrowing the shared fixture, which every other spec on this page also saves,
 * and those saves carry the contact list along with them. The result survived
 * between runs and made this file fail intermittently depending on what had run
 * before it. A spec that depends on an exact starting state has to own it.
 *
 * ONE employee for the whole file, not one per test: the second test removes a
 * number the first one saved, so they are deliberately a sequence. Isolating
 * them from each other would break the very thing they check.
 */
let recordId: string | null = null

async function openRecord(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(FIXTURES.owner.email)
  await page.locator('input[type="password"]').fill(FIXTURES.owner.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(u => !u.pathname.includes('/login'))

  const apiBase = `http://localhost:${process.env.E2E_API_PORT ?? '3994'}`
  recordId ??= await page.evaluate(async api => {
    const token = localStorage.getItem('token')
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    const positions = await (await fetch(`${api}/api/admin/positions`, { headers })).json()
    const made = await (await fetch(`${api}/api/admin/employees`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ firstName: 'Dialled', lastName: 'Numbers', positionId: positions.data[0].id }),
    })).json()
    return made.data.id as string
  }, apiBase)

  await page.goto(`/admin/employees/${recordId}`)
  // exact: the remove button's label contains the input's, by design.
  await expect(page.getByLabel('Add a contact number', { exact: true })).toBeVisible()
}

test('typing in the blank row adds a number, and it survives a reload', async ({ page }) => {
  await openRecord(page)

  await page.getByLabel('Add a contact number', { exact: true }).fill('0917 555 1234')
  await page.getByLabel('Network for contact 1', { exact: true }).fill('Globe')
  // A second row only exists once the first is real.
  await page.getByLabel('Add a contact number', { exact: true }).fill('0999 111 2222')
  await page.getByLabel('Network for contact 2', { exact: true }).fill('Smart')
  await page.getByRole('button', { name: 'Save record' }).click()
  // Reloading mid-save cancels the request, which looks identical to a value
  // that would not persist.
  await expect(page.getByText('Unsaved changes')).toHaveCount(0)

  await page.reload()
  await expect(page.getByLabel('Contact number 1', { exact: true })).toHaveValue('0917 555 1234')
  await expect(page.getByLabel('Network for contact 1', { exact: true })).toHaveValue('Globe')
  await expect(page.getByLabel('Contact number 2', { exact: true })).toHaveValue('0999 111 2222')
})

test('removing a row renumbers the rest instead of leaving a hole', async ({ page }) => {
  await openRecord(page)

  await page.getByLabel('Remove contact number 1', { exact: true }).click()
  await page.getByRole('button', { name: 'Save record' }).click()
  // Reloading mid-save cancels the request, which looks identical to a value
  // that would not persist.
  await expect(page.getByText('Unsaved changes')).toHaveCount(0)

  await page.reload()
  await expect(page.getByLabel('Contact number 1', { exact: true })).toHaveValue('0999 111 2222')
  await expect(page.getByLabel(/^Contact number \d+$/)).toHaveCount(1)
})

/**
 * The save bar is pinned rather than sitting at the end of the form.
 *
 * The 201 file is around twenty fields, so a Save button in document flow is
 * below the fold for the whole of data entry — you cannot see whether you have
 * unsaved work, and a stray tap loses it. This is layout behaviour under scroll,
 * which is only observable in a browser.
 */
test('the save bar stays pinned while scrolling, and reports unsaved work', async ({ page }) => {
  await openRecord(page)
  const save = page.getByRole('button', { name: 'Save record' })

  const before = await save.boundingBox()
  await page.mouse.wheel(0, 4000)
  await page.waitForTimeout(400)
  const after = await save.boundingBox()

  await expect(save).toBeVisible()
  expect(Math.abs(before!.y - after!.y)).toBeLessThan(2)

  // Nothing typed yet, so there is nothing to save.
  await expect(save).toBeDisabled()

  await page.getByLabel('SSS', { exact: true }).fill('34-9999999-9')
  await expect(page.getByText('Unsaved changes')).toBeVisible()
  await expect(save).toBeEnabled()
})
