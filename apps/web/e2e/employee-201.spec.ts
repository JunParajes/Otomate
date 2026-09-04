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

test('length of service is derived from the hire date, and cannot be typed into', async ({ page }) => {
  await openRecord(page)
  const box = page.getByLabel('Length of service', { exact: true })

  await expect(box).toHaveValue('')
  await page.getByLabel('Date hired').fill('2023-04-10')
  await expect(box).toHaveValue(/yr|mo/)
  await expect(box).toHaveAttribute('readonly', '')
})

/**
 * Every field on a row shares one top edge.
 *
 * Mantine renders `description` text BETWEEN the label and the input, so adding
 * one to a single field drops that input a row-height below its neighbours. It
 * happened three times on this page — the date of birth, probation, and the
 * payout account — and it reads as a broken layout rather than as help, which is
 * exactly how someone mis-reads which box they are typing into.
 *
 * Guidance now lives in a dimmed line under its card instead. This test fails
 * the moment a `description` is added back to one field on a shared row.
 */
test('fields on the same row line up', async ({ page }) => {
  await openRecord(page)
  await page.getByLabel('Date of birth').fill('1998-04-20')
  await page.getByLabel('Date hired').fill('2023-04-10')

  const rows = [
    ['Date of birth', 'Age', 'Birth place', 'Gender', 'Civil status'],
    ['Date hired', 'Length of service', 'Employment type', 'Probation ends'],
    ['Regularised on', 'Separated on', 'Reason for leaving'],
    ['Confidentiality agreement', 'Authority to deduct', 'Birth certificate', 'Marriage contract'],
    ['Payout method', 'Account'],
    ['Height', 'Height in inches', 'Height in centimetres', 'Weight'],
  ]

  for (const row of rows) {
    const tops: number[] = []
    for (const label of row) {
      // .first(): Mantine's Select renders a visible combobox and a hidden
      // input, both carrying the label.
      const box = await page.getByLabel(label, { exact: true }).first().boundingBox()
      tops.push(box!.y)
    }
    const spread = Math.max(...tops) - Math.min(...tops)
    expect(spread, `${row.join(' / ')} should share a top edge`).toBeLessThan(2)
  }
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
  await page.getByLabel('Height', { exact: true }).pressSequentially('5')
  await page.getByLabel('Height in inches').pressSequentially('2')
  await page.getByLabel('Weight').pressSequentially('62.5')
  await page.getByLabel('Course or strand').pressSequentially('BS Hotel and Restaurant Management')
  await page.getByLabel('Remarks').pressSequentially('Transferred from Matina.')

  // The page is still alive — a blanked screen loses the heading.
  await expect(page.getByRole('button', { name: 'Save record' })).toBeEnabled()

  await page.getByRole('button', { name: 'Save record' }).click()
  await page.reload()

  await expect(page.getByLabel('Email address')).toHaveValue('maria@example.com')
  await expect(page.getByLabel('Birth place')).toHaveValue('Davao City')
  await expect(page.getByLabel('Height', { exact: true })).toHaveValue('5')
  await expect(page.getByLabel('Height in inches')).toHaveValue('2')
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

/**
 * Height is said in feet and inches here and stored in centimetres.
 *
 * The conversion is unit-tested exhaustively; what only a browser can show is
 * that the two entry boxes and the derived centimetres stay in step as you type,
 * and that a saved height comes back as the same feet and inches rather than an
 * inch short.
 */
test('height is entered in feet and inches and survives a save', async ({ page }) => {
  await openRecord(page)
  const feet = page.getByLabel('Height', { exact: true })
  const inches = page.getByLabel('Height in inches')
  const cm = page.getByLabel('Height in centimetres')

  // These specs share one database and run in order, and an earlier test saves
  // a height — so start from empty rather than appending to what it left.
  await feet.fill('')
  await inches.fill('')
  await feet.pressSequentially('5')
  await inches.pressSequentially('7')
  await expect(cm).toHaveValue('170')

  // Centimetres are stored, so they must not be editable — two sources of truth
  // for one measurement is how they end up disagreeing.
  await expect(cm).toHaveAttribute('readonly', '')

  await page.getByRole('button', { name: 'Save record' }).click()
  await page.reload()

  await expect(feet).toHaveValue('5')
  await expect(inches).toHaveValue('7')
  await expect(cm).toHaveValue('170')
})

/**
 * Paperwork: the date box only exists once the document does.
 *
 * These were four bare date fields, and on most records all four sat empty and
 * unexplained — the paper 201 files record that a document was handed in, never
 * the day. Asking "when was it signed?" about a document nobody has is noise,
 * so the question is only put once the answer can exist.
 */
test('a document asks for a date only when it is on file', async ({ page }) => {
  await openRecord(page)

  const status = page.getByRole('combobox', { name: 'Birth certificate' })
  const date = page.getByLabel('Birth certificate — date received')

  await expect(status).toHaveValue('Not on file')
  await expect(date).toHaveCount(0)

  await status.click()
  await page.getByRole('option', { name: 'On file', exact: true }).click()
  await expect(date).toBeVisible()

  await date.fill('2023-05-02')
  await page.getByRole('button', { name: 'Save record' }).click()
  await page.reload()

  await expect(page.getByRole('combobox', { name: 'Birth certificate' })).toHaveValue('On file')
  await expect(page.getByLabel('Birth certificate — date received')).toHaveValue('2023-05-02')

  // "Never needed" is a third answer, not a tidier way of saying missing.
  const marriage = page.getByRole('combobox', { name: 'Marriage contract' })
  await marriage.click()
  await page.getByRole('option', { name: 'Not applicable' }).click()
  await expect(page.getByLabel('Marriage contract — date received')).toHaveCount(0)
})
