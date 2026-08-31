import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { FIXTURES, FIXTURE_FILE } from './global-setup'

/**
 * Several phone numbers on one employee.
 *
 * The API round-trip is covered by integration tests. What is only testable here
 * is the row juggling: the trailing blank row becomes a real one as soon as you
 * type in it, and removing a row has to renumber the rest. That is index
 * arithmetic over an array held in component state, which fails quietly — you
 * get the wrong number against the wrong network rather than an error.
 */

const { employeeId } = JSON.parse(readFileSync(FIXTURE_FILE, 'utf8')) as { employeeId: string }

async function openRecord(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(FIXTURES.owner.email)
  await page.locator('input[type="password"]').fill(FIXTURES.owner.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(u => !u.pathname.includes('/login'))
  await page.goto(`/admin/employees/${employeeId}`)
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

  await page.reload()
  await expect(page.getByLabel('Contact number 1', { exact: true })).toHaveValue('0917 555 1234')
  await expect(page.getByLabel('Network for contact 1', { exact: true })).toHaveValue('Globe')
  await expect(page.getByLabel('Contact number 2', { exact: true })).toHaveValue('0999 111 2222')
})

test('removing a row renumbers the rest instead of leaving a hole', async ({ page }) => {
  await openRecord(page)

  await page.getByLabel('Remove contact number 1', { exact: true }).click()
  await page.getByRole('button', { name: 'Save record' }).click()

  await page.reload()
  await expect(page.getByLabel('Contact number 1', { exact: true })).toHaveValue('0999 111 2222')
  await expect(page.getByLabel(/^Contact number \d+$/)).toHaveCount(1)
})
