import { expect, test, type Page } from '@playwright/test'
import { FIXTURES } from './global-setup'

/**
 * The collapsed navigation rail.
 *
 * With no labels visible, the tooltip IS the label — so it has to behave. It did
 * not: the rail could end up wearing a stack of them, one per icon the pointer
 * had passed over, all left on screen at once.
 */

async function collapsedRail(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(FIXTURES.owner.email)
  await page.locator('input[type="password"]').fill(FIXTURES.owner.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(u => !u.pathname.includes('/login'))
  // The rail remembers its state, so set it rather than assume it.
  await page.evaluate(() => localStorage.setItem('otomate.nav.collapsed', '1'))
  await page.reload()
  await expect(page.locator('nav a').first()).toBeVisible()
}

/**
 * Entering several icons WITHOUT leaving them is what a hand does sliding down
 * the rail faster than the close animation. hover() cannot reproduce it — it
 * emits a leave before each enter, which is exactly why this went unnoticed.
 */
test('only one label shows at a time, however fast the rail is crossed', async ({ page }) => {
  await collapsedRail(page)

  await page.evaluate(() => {
    for (const a of document.querySelectorAll('nav a')) {
      a.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }))
      a.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false }))
    }
  })

  await expect(page.locator('.mantine-Tooltip-tooltip')).toHaveCount(1)
})

test('the label goes when the pointer leaves, including after a click', async ({ page }) => {
  await collapsedRail(page)

  const dashboard = page.locator('nav a[href="/dashboard"]')
  await dashboard.hover()
  await expect(page.locator('.mantine-Tooltip-tooltip')).toHaveCount(1)

  await dashboard.click()
  await page.mouse.move(900, 500)
  await expect(page.locator('.mantine-Tooltip-tooltip')).toHaveCount(0)
})

test('expanded, the labels are on the links and no tooltip is added', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(FIXTURES.owner.email)
  await page.locator('input[type="password"]').fill(FIXTURES.owner.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(u => !u.pathname.includes('/login'))
  await page.evaluate(() => localStorage.setItem('otomate.nav.collapsed', '0'))
  await page.reload()

  await page.locator('nav a[href="/dashboard"]').hover()
  // A tooltip over a label that is already legible is noise.
  await expect(page.locator('.mantine-Tooltip-tooltip')).toHaveCount(0)
})
