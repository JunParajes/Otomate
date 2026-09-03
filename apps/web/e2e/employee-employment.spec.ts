import { expect, test, type Page } from '@playwright/test'
import { FIXTURES } from './global-setup'

/**
 * The employment spell, from the 201 file: probation ending, leaving, coming
 * back.
 *
 * The reported bug: after recording a separation the button still said "Record
 * separation", so it could be pressed again. The form is loaded once per
 * employee ID — deliberately, so an ordinary save does not discard what is being
 * typed — and these actions return a NEW record with the SAME id, so nothing
 * re-read it.
 */

/**
 * Its OWN employee, created per test.
 *
 * These specs share one database, and this file separates and rehires people —
 * which changes hire dates and active flags. Run against the shared fixture
 * employee it quietly broke a work-schedule test that needs somebody with NO
 * hire date. A spec that mutates state this much should not borrow it.
 */
async function freshEmployee(page: Page, firstName: string): Promise<string> {
  await page.goto('/login')
  await page.getByLabel('Email').fill(FIXTURES.owner.email)
  await page.locator('input[type="password"]').fill(FIXTURES.owner.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(u => !u.pathname.includes('/login'))

  /*
   * The API is on its own port here, and Vite bakes that into the bundle at
   * build time — so a relative "/api/..." hits the preview server and comes back
   * empty. Same base the app itself was built against.
   */
  const apiBase = `http://localhost:${process.env.E2E_API_PORT ?? '3994'}`
  return page.evaluate(async ({ name, api }) => {
    const token = localStorage.getItem('token')
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    const positions = await (await fetch(`${api}/api/admin/positions`, { headers })).json()
    const made = await (await fetch(`${api}/api/admin/employees`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        firstName: name,
        lastName: 'Spellcase',
        positionId: positions.data[0].id,
      }),
    })).json()
    return made.data.id as string
  }, { name: firstName, api: apiBase })
}

async function openEmployment(page: Page, employeeId: string) {
  await page.goto(`/admin/employees/${employeeId}`)
  await page.getByRole('button', { name: 'Employment', exact: true }).click()
}

const separateButton = (page: Page) => page.getByRole('button', { name: 'Record separation', exact: true })
const rehireButton = (page: Page) => page.getByRole('button', { name: 'Rehire', exact: true })

test('the button becomes Rehire once a separation is recorded, and back again', async ({ page }) => {
  const id = await freshEmployee(page, 'Returning')
  await openEmployment(page, id)

  // A rehire needs the original hire date — there is no spell to keep
  // otherwise, so the API refuses. Recorded first, as HR would.
  await page.getByLabel('Date hired').fill('2023-04-10')
  await page.getByRole('button', { name: 'Save record' }).click()
  await expect(page.getByText('Unsaved changes')).toHaveCount(0)

  // Employed: one way in, and no way to rehire somebody who never left.
  await expect(separateButton(page)).toBeVisible()
  await expect(rehireButton(page)).toHaveCount(0)

  await separateButton(page).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Last day').fill('2026-08-20')
  await dialog.getByLabel('Reason for leaving').fill('End of contract.')
  await dialog.getByRole('button', { name: 'Record separation' }).click()

  // The reported bug: this stayed as "Record separation" and could be pressed again.
  await expect(rehireButton(page)).toBeVisible()
  await expect(separateButton(page)).toHaveCount(0)
  // And the record on screen agrees, without a reload.
  await expect(page.getByLabel('Separated on')).toHaveValue('2026-08-20')
  await expect(page.getByLabel('Reason for leaving')).toHaveValue('End of contract.')

  await rehireButton(page).click()
  await page.getByRole('dialog').getByLabel('Starts again on').fill('2026-09-15')
  await page.getByRole('dialog').getByRole('button', { name: 'Rehire' }).click()

  await expect(separateButton(page)).toBeVisible()
  await expect(rehireButton(page)).toHaveCount(0)
  await expect(page.getByLabel('Date hired')).toHaveValue('2026-09-15')
  await expect(page.getByLabel('Separated on')).toHaveValue('')
  // The old spell is filed, not overwritten.
  await expect(page.getByText('Previously employed')).toBeVisible()
  await expect(page.getByText(/2026-08-20/)).toBeVisible()
})

/**
 * Both actions reload the record into the form, which would discard anything
 * typed and not yet saved. They wait rather than throw it away.
 */
test('the actions wait for unsaved changes to be saved', async ({ page }) => {
  const id = await freshEmployee(page, 'Unsaved')
  await openEmployment(page, id)
  await expect(separateButton(page)).toBeEnabled()

  // A value that cannot already be there, so the form is definitely dirty.
  await page.getByLabel('Religion').fill(`Checked ${Date.now()}`)
  await expect(page.getByText(/unsaved change/i).first()).toBeVisible()
  await expect(separateButton(page)).toBeDisabled()
  await expect(page.getByText('Save your changes first.')).toBeVisible()

  await page.getByRole('button', { name: 'Save record' }).click()
  await expect(page.getByText('Unsaved changes')).toHaveCount(0)
  await expect(separateButton(page)).toBeEnabled()
})

/**
 * Being made regular ends probation.
 *
 * The reported bug: a regularised employee's probation dates were still
 * editable, so a deadline could be typed against somebody who had already met
 * it — and the page then warned about it.
 *
 * The lock reads the SAVED record, not the draft. HR enters a long-serving
 * employee's whole history in one sitting: hire date, probation end and
 * regularisation, in that order. Locking on the draft would shut the fields the
 * moment the last of those was typed, mid-entry, before anything was saved.
 */
test('probation dates lock once the employee is regularised', async ({ page }) => {
  const id = await freshEmployee(page, 'Regularised')
  await openEmployment(page, id)

  const ends = page.getByLabel('Probation ends')
  const extendedTo = page.getByLabel('Probation extended to')

  // Still on probation: the dates are HR's to set, and the deadline is warned about.
  await expect(ends).toBeEnabled()
  await expect(extendedTo).toBeEnabled()

  /*
   * Relative to today, not a fixed date. The warning only appears inside its
   * window, so a hardcoded deadline stops exercising it the day it passes — and
   * the assertion goes on passing vacuously.
   */
  const inDays = (n: number) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10)
  await page.getByLabel('Date hired').fill(inDays(-120))
  await ends.fill(inDays(14))
  await expect(page.getByText(/Probation ends in \d+ day/)).toBeVisible()

  // The whole history typed in one sitting — the fields stay open until it is saved.
  await page.getByLabel('Regularised on').fill(inDays(-1))
  await expect(ends).toBeEnabled()
  // ...but the warning goes at once. There is no deadline left to miss.
  await expect(page.getByText(/Probation ends in \d+ day/)).toHaveCount(0)

  await page.getByRole('button', { name: 'Save record' }).click()
  await expect(page.getByText('Unsaved changes')).toHaveCount(0)

  // Saved and regular: the reported bug.
  await expect(ends).toBeDisabled()
  await expect(extendedTo).toBeDisabled()
  await expect(page.getByText(/probation dates are locked/)).toBeVisible()

  // Survives a reload — the lock is the record, not something the form remembered.
  await page.reload()
  await expect(page.getByLabel('Probation ends')).toBeDisabled()

  // And it is reversible: a regularisation date entered by mistake can be cleared.
  await page.getByLabel('Regularised on').fill('')
  await page.getByRole('button', { name: 'Save record' }).click()
  await expect(page.getByText('Unsaved changes')).toHaveCount(0)
  await expect(page.getByLabel('Probation ends')).toBeEnabled()
})
