import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { FIXTURES, FIXTURE_FILE } from './global-setup'

/**
 * Typing into the branch dialogs.
 *
 * REGRESSION. Every field here used to blank the page on the first keystroke:
 * the handlers read `e.currentTarget.value` INSIDE the state updater, and React
 * clears `currentTarget` once the event has dispatched, so the updater — which
 * runs later — threw "Cannot read properties of null (reading 'value')". The
 * same mistake was copied across 16 handlers in two files.
 *
 * These use pressSequentially, not fill(), on purpose. `fill()` sets the value
 * in one dispatch and does NOT reproduce it — the original bug survived a test
 * written with fill() and was found by a person typing.
 */

const { branchId } = JSON.parse(readFileSync(FIXTURE_FILE, 'utf8')) as { branchId: string }

async function openBranch(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(FIXTURES.owner.email)
  await page.locator('input[type="password"]').fill(FIXTURES.owner.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(u => !u.pathname.includes('/login'))
  await page.goto(`/admin/branches/${branchId}`)
}

/** Fails the test on any uncaught React error, which is how this bug presents. */
function watchForCrashes(page: Page): string[] {
  const errs: string[] = []
  page.on('pageerror', e => errs.push(e.message))
  return errs
}

test('typing in the utility account form does not crash the page', async ({ page }) => {
  const errs = watchForCrashes(page)
  await openBranch(page)

  await page.getByRole('button', { name: 'Add account' }).click()
  for (const [label, text] of [
    ['Provider', 'Davao Light'],
    ['Account number', 'DL-449120'],
    ['Meter number', 'M-88231'],
  ] as const) {
    await page.getByLabel(label).click()
    await page.getByLabel(label).pressSequentially(text, { delay: 25 })
    await expect(page.getByLabel(label)).toHaveValue(text)
  }
  expect(errs).toEqual([])
})

test('typing in the permit form does not crash the page', async ({ page }) => {
  const errs = watchForCrashes(page)
  await openBranch(page)

  await page.getByRole('button', { name: 'Add permit' }).click()
  const number = page.getByLabel('Permit number')
  await number.click()
  await number.pressSequentially('2026-0041234', { delay: 25 })
  await expect(number).toHaveValue('2026-0041234')

  const authority = page.getByLabel('Issuing authority')
  await authority.fill('')
  await authority.pressSequentially('BFP Region XI', { delay: 25 })
  await expect(authority).toHaveValue('BFP Region XI')

  expect(errs).toEqual([])
})
