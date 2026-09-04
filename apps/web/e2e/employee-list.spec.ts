import { expect, test, type Page } from '@playwright/test'
import { FIXTURES } from './global-setup'

/**
 * The roster, at the size it actually reaches.
 *
 * The imported 201 file is 328 records, 247 of them people who have left, and
 * every one of them landed on the placeholder position. Opening on all 328 put
 * the eighty-odd staff who are actually here underneath a wall of ex-employees,
 * and giving them real positions meant opening eighty records one at a time.
 *
 * These check the three things that make that job possible: the archive is out
 * of the way, the counts are the way in to each group, and one edit can be
 * applied to many people.
 */

async function signIn(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(FIXTURES.owner.email)
  await page.locator('input[type="password"]').fill(FIXTURES.owner.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(u => !u.pathname.includes('/login'))
  // The view and archive choices persist, so set a known starting point rather
  // than inheriting whatever the last test left.
  await page.evaluate(() => {
    localStorage.removeItem('otomate.employees.view')
    localStorage.removeItem('otomate.employees.separated')
  })
  await page.goto('/admin/employees')
  await expect(page.getByRole('heading', { name: 'Employees' })).toBeVisible()
}

/**
 * Somebody who has left, so there is an archive to hide.
 *
 * A unique surname per call: these specs share a database, so a fixed name
 * accumulates across tests and runs, and the second lookup then matches two
 * people and fails on strict mode rather than on anything real.
 */
async function separatedEmployee(page: Page): Promise<string> {
  const apiBase = `http://localhost:${process.env.E2E_API_PORT ?? '3994'}`
  const surname = `Gone${Date.now() % 1000000}`
  const id = await page.evaluate(async ({ api, surname }) => {
    const token = localStorage.getItem('token')
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    const positions = await (await fetch(`${api}/api/admin/positions`, { headers })).json()
    const made = await (await fetch(`${api}/api/admin/employees`, {
      method: 'POST', headers,
      body: JSON.stringify({ firstName: 'Left', lastName: surname, positionId: positions.data[0].id }),
    })).json()
    await fetch(`${api}/api/admin/employees/${made.data.id}`, { method: 'DELETE', headers })
    return made.data.id as string
  }, { api: apiBase, surname })
  void id
  return `Left ${surname}`
}

test('the archive is hidden until asked for, and the choice sticks', async ({ page }) => {
  await signIn(page)
  const gone = await separatedEmployee(page)
  await page.reload()

  const rows = page.locator('tbody tr')
  const activeOnly = await rows.count()
  await expect(page.getByText(gone)).toHaveCount(0)

  await page.getByLabel('Show separated').check()
  await expect(page.getByText(gone)).toBeVisible()
  const withArchive = await rows.count()
  expect(withArchive).toBeGreaterThan(activeOnly)

  // Remembered, so it does not have to be set again on every visit.
  await page.reload()
  await expect(page.getByLabel('Show separated')).toBeChecked()
  await expect(page.getByText(gone)).toBeVisible()
})

test('the counts are filters, not decoration', async ({ page }) => {
  await signIn(page)
  const gone = await separatedEmployee(page)
  await page.reload()

  // Tapping "Separated" reveals the archive rather than merely reporting it.
  await page.getByText('Separated', { exact: true }).click()
  await expect(page.getByLabel('Show separated')).toBeChecked()
  await expect(page.getByText(gone)).toBeVisible()
})

test('the branch view groups people under the branch they work at', async ({ page }) => {
  await signIn(page)
  await page.getByText('By branch', { exact: true }).click()

  // A branch heading with its own count, and no table.
  await expect(page.locator('tbody tr')).toHaveCount(0)
  const headings = page.getByRole('heading', { level: 6 })
  expect(await headings.count()).toBeGreaterThan(0)

  // Remembered like the archive toggle.
  await page.reload()
  await expect(page.locator('tbody tr')).toHaveCount(0)
})

/**
 * The reason this page was rebuilt: eighty people needing the same edit.
 *
 * On employees of its own, reached by search. This test CHANGES people's
 * positions, and the positions spec asserts that the shared fixture employee is
 * a Cashier so their role cannot be deleted — reassigning the roster from here
 * broke that, in a file that never mentions this one.
 */
test('one position can be applied to several people at once', async ({ page }) => {
  await signIn(page)

  const surname = `Bulk${Date.now() % 1000000}`
  const apiBase = `http://localhost:${process.env.E2E_API_PORT ?? '3994'}`
  const target = await page.evaluate(async ({ api, surname }) => {
    const token = localStorage.getItem('token')
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    const positions = await (await fetch(`${api}/api/admin/positions`, { headers })).json()
    // A role of this test's own, so nothing else's expectations move.
    const role = await (await fetch(`${api}/api/admin/positions`, {
      method: 'POST', headers, body: JSON.stringify({ name: `Role ${surname}` }),
    })).json()
    for (const first of ['Ana', 'Ben']) {
      await fetch(`${api}/api/admin/employees`, {
        method: 'POST', headers,
        body: JSON.stringify({ firstName: first, lastName: surname, positionId: positions.data[0].id }),
      })
    }
    return role.data.name as string
  }, { api: apiBase, surname })

  await page.reload()
  await page.getByPlaceholder('Search name').fill(surname)
  const rows = page.locator('tbody tr')
  await expect(rows).toHaveCount(2)

  // Nothing selected, no toolbar — an empty one is a row of dead controls.
  await expect(page.getByText(/\d+ selected/)).toHaveCount(0)

  await page.locator('tbody input[type="checkbox"]').nth(0).check()
  await page.locator('tbody input[type="checkbox"]').nth(1).check()
  await expect(page.getByText('2 selected')).toBeVisible()

  // Apply stays shut until there is something to apply.
  const apply = page.getByRole('button', { name: /^Apply to 2/ })
  await expect(apply).toBeDisabled()

  await page.getByPlaceholder(/Set position/).click()
  await page.getByRole('option', { name: target, exact: true }).click()
  await expect(apply).toBeEnabled()

  await apply.click()
  // The confirmation says how many, because selection survives scrolling and
  // filtering and can reach people who are no longer on screen.
  await expect(page.getByRole('dialog')).toContainText('Update 2 employee')
  await page.getByRole('button', { name: 'Update 2' }).click()

  await expect(page.getByText(/\d+ selected/)).toHaveCount(0)
  await expect(page.getByText('2 employees updated')).toBeVisible()
  // Both rows now carry the new role, which is the whole point.
  await expect(rows.filter({ hasText: target })).toHaveCount(2)
})
