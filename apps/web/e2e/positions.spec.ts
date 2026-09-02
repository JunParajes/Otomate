import { expect, test, type Page } from '@playwright/test'
import { FIXTURES } from './global-setup'

/**
 * Managing job positions.
 *
 * The CRUD itself is covered by API tests. What is only observable in a browser
 * is the guard on the row action: Delete has to be visibly unavailable, with a
 * reason, for a position somebody holds — rather than enabled and then failing
 * with a 409 the moment it is pressed.
 */

async function openPositions(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(FIXTURES.owner.email)
  await page.locator('input[type="password"]').fill(FIXTURES.owner.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(u => !u.pathname.includes('/login'))
  await page.goto('/admin/positions')
  await expect(page.getByRole('heading', { name: 'Positions' })).toBeVisible()
}

test('the seeded positions are listed', async ({ page }) => {
  await openPositions(page)
  const rows = page.locator('tbody tr')
  await expect(rows.filter({ hasText: 'Baker' })).toHaveCount(1)
  await expect(rows.filter({ hasText: 'Frontliner' })).toHaveCount(1)
})

test('a new position can be added and then removed', async ({ page }) => {
  await openPositions(page)
  const rows = page.locator('tbody tr')
  const name = `Pastry Chef ${Date.now()}`

  await page.getByRole('button', { name: 'Add position' }).first().click()
  await page.getByLabel('Name').pressSequentially(name)
  await page.getByRole('button', { name: 'Add position', exact: true }).last().click()

  const row = rows.filter({ hasText: name })
  await expect(row).toHaveCount(1)

  // Nobody holds it, so it can go.
  await row.click()
  await page.getByRole('button', { name: 'Delete' }).first().click()
  await page.getByRole('button', { name: 'Delete' }).last().click()
  await expect(rows.filter({ hasText: name })).toHaveCount(0)
})

test('a position somebody holds cannot be deleted', async ({ page }) => {
  await openPositions(page)
  // The fixture employee is a Cashier.
  await page.locator('tbody tr').filter({ hasText: 'Cashier' }).click()

  const del = page.getByRole('button', { name: 'Delete' }).first()
  await expect(del).toBeDisabled()
  await expect(page.getByText(/move them first/i)).toBeVisible()
})

/**
 * The permission is deliberately not employees:write — adding a job role changes
 * what every branch can pick from. The fixture "plain" user has neither.
 */
test('a user without the permission is not offered the buttons', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(FIXTURES.plain.email)
  await page.locator('input[type="password"]').fill(FIXTURES.plain.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(u => !u.pathname.includes('/login'))

  await page.goto('/admin/positions')
  await expect(page.getByRole('button', { name: 'Add position' })).toHaveCount(0)
})
