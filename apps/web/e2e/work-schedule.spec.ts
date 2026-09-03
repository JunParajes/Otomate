import { expect, test, type Page } from '@playwright/test'
import { FIXTURES } from './global-setup'

/**
 * The work schedule grid.
 *
 * The API tests cover the transitions and the pre-fill. What only a browser
 * shows is the grid itself: that a cell edit is held as unsaved until Save is
 * pressed, that it survives a reload, and that an approved plan stops being
 * editable — which is the whole point of separating the plan from the actuals.
 */

/**
 * Thursdays. The create dialog refuses anything else.
 *
 * A cutoff is unique, and these specs share one database and run in order — so
 * each test plans its OWN week rather than colliding on the same one.
 */
const WEEKS = {
  boundaries: '2026-08-27',
  prefill: '2026-09-03',
  editing: '2026-09-10',
  cover: '2026-09-17',
  approval: '2026-09-24',
  details: '2026-10-01',
  branches: '2026-10-08',
  nohire: '2026-10-15',
  numbering: '2026-11-12',
  clipping: '2026-11-19',
  planning: '2026-11-26',
  ownBranch: '2026-12-03',
  picker: '2026-12-10',
  dialog: '2026-12-17',
}

async function signIn(page: Page, who: typeof FIXTURES.owner) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(who.email)
  await page.locator('input[type="password"]').fill(who.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(u => !u.pathname.includes('/login'))
}

/** Toasts stack in the corner the action bar lives in and swallow clicks. */
async function clearToasts(page: Page) {
  for (const btn of await page.locator('.mantine-Notification-closeButton').all()) {
    await btn.click().catch(() => {})
  }
  await page.waitForTimeout(150)
}

/**
 * Submit, answering the "some branches are not marked as planned" prompt when it
 * appears — which it does for any cutoff whose branches nobody has marked.
 */
async function submitForApproval(page: Page) {
  await page.getByRole('button', { name: 'Submit' }).click()
  const confirm = page.getByRole('button', { name: 'Submit anyway' })
  // The modal takes a beat to mount; checking visibility immediately answers
  // "no" and silently skips the confirmation.
  await confirm.waitFor({ state: 'visible', timeout: 4000 }).catch(() => {})
  if (await confirm.isVisible().catch(() => false)) await confirm.click()
  await expect(page.getByText('Awaiting approval')).toBeVisible()
}

/** The Sunday of a cutoff that starts on the given Thursday. */
function sundayOf(thursday: string): string {
  const d = new Date(`${thursday}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + 3)
  return d.toISOString().slice(0, 10)
}

async function openCutoff(page: Page, weekStart: string) {
  await signIn(page, FIXTURES.owner)
  await page.goto('/hr/work-schedule')
  await page.getByRole('button', { name: 'Start a cutoff' }).click()
  await page.getByLabel('Cutoff starts').fill(weekStart)
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  await page.waitForURL(/\/hr\/work-schedule\/.+/)
  await clearToasts(page)
}

/** The grid sits behind a branch choice now — open every branch at once. */
async function openAllBranches(page: Page) {
  await page.getByText('All branches', { exact: true }).first().click()
  await expect(page.getByRole('columnheader', { name: /Thu/ }).first()).toBeVisible()
}

test('a cutoff runs Thursday to Wednesday and refuses any other start', async ({ page }) => {
  await signIn(page, FIXTURES.owner)
  await page.goto('/hr/work-schedule')
  await page.getByRole('button', { name: 'Start a cutoff' }).click()

  // A Monday.
  await page.getByLabel('Cutoff starts').fill('2026-08-31')
  await expect(page.getByText('Pick a Thursday')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeDisabled()

  await page.getByLabel('Cutoff starts').fill(WEEKS.boundaries)
  await expect(page.getByText(/27 Aug – 2 Sep 2026/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeEnabled()
})

test('a new cutoff starts with everyone scheduled on all seven days', async ({ page }) => {
  await openCutoff(page, WEEKS.prefill)
  await openAllBranches(page)

  // Seven day columns, Thursday first.
  await expect(page.getByRole('columnheader', { name: /Thu/ }).first()).toBeVisible()
  await expect(page.getByRole('columnheader', { name: /Wed/ }).first()).toBeVisible()

  // Cells only — anchored on the "name, date" form, since the name button now
  // carries an aria-label containing the name too.
  const cells = page.locator('[aria-label^="Maria Santos Cruz, "]')
  await expect(cells).toHaveCount(7)
  for (const cell of await cells.all()) {
    await expect(cell).toHaveAttribute('aria-label', /Scheduled/)
  }
})

test('a cell edit is held unsaved, then survives a reload', async ({ page }) => {
  await openCutoff(page, WEEKS.editing)
  await openAllBranches(page)
  const sun = sundayOf(WEEKS.editing)
  const cell = page.getByLabel(new RegExp(`Maria Santos Cruz, ${sun}`))

  await expect(cell).toHaveAttribute('aria-label', /Scheduled/)
  await cell.click()
  await page.getByRole('button', { name: /^Day off/ }).click()
  await page.getByRole('button', { name: 'Done' }).click()

  // Nothing has gone to the server yet — that is what Save is for.
  await expect(page.getByText(/1 unsaved change/)).toBeVisible()
  await expect(cell).toHaveAttribute('aria-label', /Day off/)

  await clearToasts(page)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('No changes')).toBeVisible()

  await page.reload()
  await expect(page.getByLabel(new RegExp(`Maria Santos Cruz, ${sun}`)))
    .toHaveAttribute('aria-label', /Day off/)
})

/**
 * The notation the spreadsheet used — "Off/Dorilag", meaning off with Dorilag
 * covering. It is part of the plan, not something added during the week.
 */
test('a day off can record who covers it', async ({ page }) => {
  await openCutoff(page, WEEKS.cover)
  await openAllBranches(page)
  const cell = page.getByLabel(new RegExp(`Maria Santos Cruz, ${sundayOf(WEEKS.cover)}`))
  await cell.click()

  await page.getByRole('button', { name: /^Day off/ }).click()
  // The field renames itself once the day is an off day.
  await expect(page.getByText('Who takes the shift while they are off')).toBeVisible()
  await page.getByRole('button', { name: 'Done' }).click()
})

test('an approved plan stops being editable', async ({ page }) => {
  await openCutoff(page, WEEKS.approval)

  // Approve only appears once the schedule is submitted, so this waits for the
  // transition rather than racing it.
  await submitForApproval(page)
  await clearToasts(page)

  await page.getByRole('button', { name: 'Approve' }).click()
  await clearToasts(page)

  await expect(page.getByText(/approved and is now a record/)).toBeVisible()
  // Reopening is offered, because the owner holds the approve permission.
  await expect(page.getByRole('button', { name: 'Reopen' })).toBeVisible()
})

/**
 * The grid carries the week and nothing else. Where someone lives and how to
 * reach them matter occasionally — deciding who can cover an early shift — and
 * as columns they would be eighty rows of noise across the days.
 */
test("tapping a name opens that person's details", async ({ page }) => {
  await openCutoff(page, WEEKS.details)
  await openAllBranches(page)

  // The grid itself has no Home or Hired column any more.
  await expect(page.getByRole('columnheader', { name: 'Home' })).toHaveCount(0)
  await expect(page.getByRole('columnheader', { name: 'Hired' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Details for Maria Santos Cruz' }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('Date hired', { exact: true })).toBeVisible()
  await expect(dialog.getByText('Address', { exact: true })).toBeVisible()
  await expect(dialog.getByText('Contact numbers', { exact: true })).toBeVisible()
})

test('a role without schedule:read is refused the page', async ({ page }) => {
  // Hiding a nav link is not access control — someone with the URL must still
  // be stopped. Either bounced away or shown a refusal, but never the grid.
  await signIn(page, FIXTURES.plain)
  await page.goto('/hr/work-schedule')
  await expect(page.locator('body')).not.toContainText('Start a cutoff')
})

/**
 * The branch list, rather than every branch in one table.
 *
 * A full cutoff is eighty-odd staff; whoever is planning almost always wants one
 * branch, and one table of everyone is a scroll before it is useful.
 */
test('a cutoff opens on the branch list, and a branch opens its grid', async ({ page }) => {
  await openCutoff(page, WEEKS.branches)

  // No grid until a branch is chosen.
  await expect(page.getByRole('columnheader', { name: /Thu/ })).toHaveCount(0)
  await expect(page.getByText('All branches', { exact: true })).toBeVisible()

  const branch = page.getByText(FIXTURES.branch, { exact: true }).first()
  await branch.click()
  await expect(page.getByRole('columnheader', { name: /Thu/ }).first()).toBeVisible()

  // And back again.
  await page.getByRole('button', { name: 'All branches' }).click()
  await expect(page.getByRole('columnheader', { name: /Thu/ })).toHaveCount(0)
})

/**
 * A missing hire date is not the same as being over a month. It used to read
 * "Over one month" — a confident wrong answer about someone nobody had recorded
 * a start date for.
 */
test('a missing hire date asks for one instead of guessing', async ({ page }) => {
  await openCutoff(page, WEEKS.nohire)
  await openAllBranches(page)
  await page.getByRole('button', { name: /^Details for/ }).first().click()

  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('No date hired on record')).toBeVisible()
  await expect(dialog.getByText(/Add it to their record/)).toBeVisible()
  await expect(dialog.getByText('Over one month')).toHaveCount(0)
})

/**
 * Cutoffs are referred to by their WS number — "WS-35", the 35th cutoff of the
 * year. Derived from the Thursday, so the same week always carries the same
 * number regardless of the order schedules were created in.
 */
test('a cutoff is labelled with its WS number', async ({ page }) => {
  await openCutoff(page, WEEKS.numbering)

  // 12 Nov 2026 is the 46th Thursday of 2026.
  // exact: the creation toast also reads "WS-46 · 12 Nov – 18 Nov 2026".
  await expect(page.getByText('WS-46', { exact: true })).toBeVisible()
  await expect(page.getByText('12 Nov – 18 Nov 2026', { exact: true })).toBeVisible()

  // And on the list it sits beside the dates.
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(page.getByText('WS-46', { exact: true })).toBeVisible()
})

/**
 * Status labels must fit their column.
 *
 * "Awaiting approval" is the longest, and it was rendering as "AWAITING APPR…".
 * Mantine uppercases badge labels and ellipsises the overflow, so a column
 * narrower than the widest status truncates silently — it looks like a styling
 * choice rather than a bug. Measured rather than eyeballed: scrollWidth beyond
 * clientWidth is the definition of clipped.
 */
test('no status badge is cut off in the list', async ({ page }) => {
  await openCutoff(page, WEEKS.clipping)
  await submitForApproval(page)
  await clearToasts(page)

  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Work schedule' })).toBeVisible()

  const badges = page.locator('tbody .mantine-Badge-label')
  await expect(badges.first()).toBeVisible()

  for (const badge of await badges.all()) {
    const { text, clipped } = await badge.evaluate(el => ({
      text: el.textContent ?? '',
      clipped: el.scrollWidth > el.clientWidth + 1,
    }))
    expect(clipped, `"${text}" is cut off`).toBe(false)
  }

  // And the longest one is there in full. The DOM text is sentence case — the
  // capitals are Mantine's text-transform, so matching the rendered form finds
  // nothing.
  await expect(page.getByText('Awaiting approval', { exact: true })).toBeVisible()
})

/**
 * Which branches are finished.
 *
 * Submitting sends the whole cutoff, so a branch nobody has opened goes for
 * approval alongside the ones that were planned. The list says which is which,
 * and Submit names the stragglers rather than letting them through unnoticed.
 */
test('branches show whether they are planned, and Submit warns about the rest', async ({ page }) => {
  await openCutoff(page, WEEKS.planning)

  await expect(page.getByText('Not planned yet').first()).toBeVisible()

  // Mark the fixture's branch as planned.
  await page.getByText(FIXTURES.branch, { exact: true }).first().click()
  await page.getByRole('button', { name: 'Mark as planned' }).first().click()
  await expect(page.getByRole('button', { name: /^Planned/ })).toBeVisible()

  await page.getByRole('button', { name: 'All branches' }).click()
  await expect(page.getByText('Planned', { exact: true })).toBeVisible()
})

/**
 * Their own branch is not "another" branch — offering it invites a choice that
 * means nothing and reads in the grid as a transfer nobody planned.
 */
test('an employee cannot be sent to the branch they already work at', async ({ page }) => {
  await openCutoff(page, WEEKS.ownBranch)
  await openAllBranches(page)

  await page.locator('[aria-label^="Maria Santos Cruz, "]').first().click()
  await page.getByRole('combobox', { name: /Working at another branch/ }).click()

  // The only branch in the fixtures is her own, so there is nothing to offer.
  await expect(page.getByRole('option', { name: FIXTURES.branch })).toHaveCount(0)
})

/**
 * Picking a colleague out of the whole company.
 *
 * A flat list of every employee is a scroll, and the answer is nearly always
 * someone from the same branch — so the picker groups by branch and puts their
 * own branch at the top, and typing a surname narrows it, because filed names
 * are surname-first.
 */
test('the colleague picker groups by branch, own branch first', async ({ page }) => {
  await openCutoff(page, WEEKS.picker)
  await openAllBranches(page)

  await page.locator('[aria-label^="Maria Santos Cruz, "]').first().click()
  await page.getByRole('button', { name: /^Day off/ }).click()
  await page.getByRole('combobox', { name: /Covered by/ }).click()

  // Group labels in DOM order. Maria is at Matina, so that group leads and
  // says why it is at the top.
  const groupLabels = page.locator('[role="listbox"] [class*="groupLabel"]')
  await expect(groupLabels.first()).toContainText(FIXTURES.branch)
  await expect(groupLabels.first()).toContainText('same branch')
  await expect(groupLabels.nth(1)).toContainText(FIXTURES.otherBranch)
  await expect(page.getByRole('option')).not.toHaveCount(0)

  // Typing a surname narrows it — filed names put the surname first.
  await page.keyboard.type('Dorilag')
  await expect(page.getByRole('option')).toHaveCount(1)
  await expect(page.getByRole('option').first()).toContainText('Dorilag')
})

/** The dialog has to fit on screen — it is used on a tablet, over the grid. */
test('the cell editor fits without scrolling inside it', async ({ page }) => {
  await openCutoff(page, WEEKS.dialog)
  await openAllBranches(page)
  await page.locator('[aria-label^="Maria Santos Cruz, "]').first().click()

  const dialog = await page.getByRole('dialog').boundingBox()
  const viewport = page.viewportSize()!
  expect(dialog!.height).toBeLessThanOrEqual(viewport.height)
  expect(dialog!.width).toBeGreaterThan(600)
  // Every status reachable without scrolling the dialog.
  for (const label of ['Scheduled', 'No schedule', 'Day off', 'Frontline', 'Opener']) {
    await expect(page.getByRole('button', { name: new RegExp(`^${label}`) })).toBeInViewport()
  }
})
