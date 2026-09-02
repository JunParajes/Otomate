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

test('age fills itself from the date of birth, and cannot be typed into', async ({ page }) => {
  await openRecord(page)
  const ageBox = page.getByLabel('Age', { exact: true })

  await expect(ageBox).toHaveValue('')
  await page.getByLabel('Date of birth').fill('1998-04-20')
  await expect(ageBox).not.toHaveValue('')
  expect(Number(await ageBox.inputValue())).toBeGreaterThan(0)

  // Read-only, so it can never drift out of step with the date beside it.
  await expect(ageBox).toHaveAttribute('readonly', '')

  /*
   * And it lines up with the rest of the row. This is the whole reason it is a
   * field rather than description text: a Mantine `description` renders between
   * the label and the input, which pushed the date box below everything else on
   * the row.
   */
  const dob = (await page.getByLabel('Date of birth').boundingBox())!
  const age = (await ageBox.boundingBox())!
  const birthPlace = (await page.getByLabel('Birth place').boundingBox())!
  expect(Math.abs(dob.y - age.y)).toBeLessThan(2)
  expect(Math.abs(dob.y - birthPlace.y)).toBeLessThan(2)
})

test('length of service is derived from the hire date', async ({ page }) => {
  await openRecord(page)
  await page.getByLabel('Date hired').fill('2023-04-10')
  await expect(page.getByText(/of service/)).toBeVisible()
  // Still derived, so there is nothing to type into.
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

/**
 * The section index.
 *
 * This is here because it broke silently once already: the nav started inside
 * the Mantine Card, whose `overflow: hidden` disables position: sticky on
 * everything within it. Nothing errored — the row simply scrolled away, and the
 * page looked fine in a screenshot. Only measured positions catch that.
 */
test('the section index stays pinned and lands headings clear of itself', async ({ page }) => {
  await openRecord(page)
  const nav = page.locator('[class*="sectionNav"]')

  await page.getByRole('button', { name: 'Documents', exact: true }).click()
  await page.waitForTimeout(800)

  const navBox = await nav.boundingBox()
  const heading = await page.getByText('Documents & notes').boundingBox()

  // Still on screen after scrolling most of the way down the record.
  expect(navBox).not.toBeNull()
  expect(navBox!.y).toBeGreaterThanOrEqual(0)
  expect(navBox!.y).toBeLessThan(200)

  // And the section it jumped to is BELOW it, not hidden underneath.
  expect(heading!.y).toBeGreaterThanOrEqual(navBox!.y + navBox!.height)
})

test('every section chip actually scrolls to its section', async ({ page }) => {
  await openRecord(page)
  const nav = page.locator('[class*="sectionNav"]')

  // Chip label -> the id it should scroll to. A chip whose id no longer matches
  // a section scrolls nowhere and looks like a dead button, which is easy to
  // miss by eye and impossible to miss here.
  const chips: [string, string][] = [
    ['Pay', 'pay'],
    ['Documents', 'documents'],
    ['Gov IDs', 'gov-ids'],
    ['Employment', 'employment'],
    ['Emergency', 'emergency'],
    ['Contact', 'contact'],
    ['Personal', 'personal'],
  ]

  for (const [label, id] of chips) {
    await page.getByRole('button', { name: label, exact: true }).click()
    await page.waitForTimeout(700)

    const navBox = (await nav.boundingBox())!
    const section = (await page.locator(`#${id}`).boundingBox())!
    const viewport = page.viewportSize()!

    // The section starts below the pinned nav and inside the viewport — that is
    // what "the chip worked" means.
    expect(section.y, `${label} should land below the nav`).toBeGreaterThanOrEqual(navBox.y + navBox.height - 2)
    expect(section.y, `${label} should be on screen`).toBeLessThan(viewport.height)
  }
})

