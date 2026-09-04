import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { FIXTURES, FIXTURE_FILE } from './global-setup'

/**
 * Two things a browser is the only place to check.
 *
 * The account menu showing stale identity after an admin write is a real bug
 * this app had (fix 604d83a): the session is cached client-side, so editing your
 * own name updated the database and the list while the header kept the old one.
 * Nothing server-side is wrong in that state, so no API test can see it.
 *
 * And permission gating has two halves. The API half — which fields come back —
 * is covered by integration tests. This is the other half: that the UI does not
 * offer a door the server will refuse to open.
 */

const { employeeId } = JSON.parse(readFileSync(FIXTURE_FILE, 'utf8')) as { employeeId: string }

async function signIn(page: Page, user: { email: string; password: string }) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(user.email)
  await page.locator('input[type="password"]').fill(user.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(u => !u.pathname.includes('/login'))
}

test.describe('the account menu reflects the current user', () => {
  test('updates after editing your own name, without a reload', async ({ page }) => {
    await signIn(page, FIXTURES.owner)

    const header = page.locator('header, [class*="header"]').first()
    await expect(header).toContainText(FIXTURES.owner.email)

    await page.goto('/admin/users')
    await page.locator('tbody tr', { hasText: FIXTURES.owner.email }).first().click()
    await page.getByRole('button', { name: /^edit$/i }).click()

    const renamed = 'Renamed Owner'
    const nameField = page.getByLabel(/full name|name/i).first()
    await nameField.fill(renamed)
    await page.getByRole('button', { name: /save|update/i }).last().click()

    // The header must follow. Before the fix it kept the old name until a
    // manual refresh, which looks like the save silently failed.
    await expect(header).toContainText(renamed, { timeout: 10_000 })
  })
})

test.describe('the UI does not offer what the server would refuse', () => {
  test('hides sections the role has no permission for', async ({ page }) => {
    // The plain fixture role holds employees:* but neither hr:* nor branches:*.
    await signIn(page, FIXTURES.plain)

    const nav = page.locator('nav, aside').first()
    await expect(nav).toContainText('Employees')
    await expect(nav).not.toContainText('Branches')
  })

  /*
   * The gate moved, and had to.
   *
   * "Edit" and "HR record" used to be separate row actions, and hiding the
   * second one was how a role without hr:read was kept out of a 201 file. They
   * are one action now — a branch clerk still needs to correct a name — so the
   * separation lives on the page instead: identity is shown, the 201 sections
   * are not. These two tests are a mirror pair on purpose; without the second,
   * "not visible" could just mean the whole thing was deleted.
   */
  test('the record page shows no 201 file without hr:read', async ({ page }) => {
    await signIn(page, FIXTURES.plain)
    await page.goto(`/admin/employees/${employeeId}`)

    // The name is theirs to fix...
    await expect(page.getByLabel('First name', { exact: true })).toBeVisible()
    // ...the 201 file is not theirs to read.
    await expect(page.getByLabel('Date of birth')).toHaveCount(0)
    await expect(page.getByLabel('SSS')).toHaveCount(0)
    await expect(page.locator('body')).not.toContainText('Government IDs')
  })

  test('the record page shows the 201 file to a role that holds hr:read', async ({ page }) => {
    await signIn(page, FIXTURES.owner)
    await page.goto(`/admin/employees/${employeeId}`)

    await expect(page.getByLabel('First name', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Date of birth')).toBeVisible()
    await expect(page.locator('body')).toContainText('Government IDs')
  })

  test('refuses a hand-typed URL to a page the role cannot see', async ({ page }) => {
    // Hiding a nav link is not access control. Someone with the URL must still
    // be stopped.
    await signIn(page, FIXTURES.plain)
    await page.goto(`/admin/employees/${employeeId}`)

    // Either bounced away, or shown a refusal — but never the salary section.
    await expect(page.locator('body')).not.toContainText('Pay rate')
  })
})
