import ExcelJS from 'exceljs'
import { WORK_DAY_MARKS, cellMark, cutoffCode, formatCutoff, type WorkSchedule, type WorkScheduleRow } from '@otomate/shared'

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const shortDate = (iso: string) => {
  const d = new Date(`${iso}T00:00:00.000Z`)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/**
 * Excel refuses a sheet name over 31 characters or containing : \ / ? * [ ].
 * A branch called "Bangkerohan" is fine; the rule exists for the one that will
 * not be, and a thrown error at download time is a poor way to find out.
 */
function sheetName(branch: string): string {
  return branch.replace(/[:\\/?*[\]]/g, '-').slice(0, 31) || 'Branch'
}

const BORDER = {
  top: { style: 'thin' as const },
  left: { style: 'thin' as const },
  bottom: { style: 'thin' as const },
  right: { style: 'thin' as const },
}

/**
 * The work schedule as a workbook — one sheet per branch.
 *
 * Carries exactly what the printed sheet carries: the marks, and the header and
 * signature blocks that make a page mean something on its own. Remarks, covers
 * and pairings are deliberately left out, which also keeps the file clear of
 * anything behind hr:read — a spreadsheet is the easiest thing in the world to
 * forward.
 *
 * Marks come from the shared helper the screen and the print sheet use. Three
 * renderings of one fact drift apart otherwise, and the way that surfaces is a
 * file disagreeing with the app after somebody has acted on it.
 */
export function buildWorkScheduleWorkbook(
  schedule: WorkSchedule,
  groups: [string, WorkScheduleRow[]][],
  printedOn = new Date()
): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Otomate'
  workbook.created = printedOn

  const approved = schedule.status === 'APPROVED'
  const lastColumn = 2 + schedule.days.length

  for (const [branchName, rows] of groups) {
    const sheet = workbook.addWorksheet(sheetName(branchName), {
      pageSetup: {
        orientation: 'landscape',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
      },
    })

    sheet.columns = [
      { width: 28 },
      { width: 16 },
      ...schedule.days.map(() => ({ width: 11 })),
    ]

    const title = sheet.addRow(['Work Schedule'])
    title.font = { size: 16, bold: true }
    sheet.mergeCells(1, 1, 1, lastColumn)

    const branchRow = sheet.addRow([branchName])
    branchRow.font = { size: 12, bold: true }
    sheet.mergeCells(2, 1, 2, lastColumn)

    const when = sheet.addRow([
      `${cutoffCode(schedule.weekStart)}  ·  ${formatCutoff(schedule.weekStart)}  ·  Thursday to Wednesday`,
    ])
    when.font = { size: 10 }
    sheet.mergeCells(3, 1, 3, lastColumn)

    // A draft that reaches a branch gets followed, so it says so before the grid.
    if (!approved) {
      const draft = sheet.addRow(['NOT YET APPROVED — this is a draft and may still change'])
      draft.font = { size: 10, bold: true }
      sheet.mergeCells(sheet.rowCount, 1, sheet.rowCount, lastColumn)
    }

    sheet.addRow([])

    const header = sheet.addRow([
      'Employee',
      'Position',
      ...schedule.days.map(d => {
        const date = new Date(`${d}T00:00:00.000Z`)
        return `${DAY_NAMES[date.getUTCDay()]}\n${d.slice(8)}/${d.slice(5, 7)}`
      }),
    ])
    header.font = { bold: true }
    header.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    header.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' }
    header.getCell(2).alignment = { horizontal: 'left', vertical: 'middle' }
    header.eachCell(cell => { cell.border = BORDER })
    header.height = 28

    for (const row of rows) {
      const line = sheet.addRow([
        row.nameFiled,
        row.position,
        ...schedule.days.map(d => cellMark(row.days[d])),
      ])
      line.eachCell(cell => { cell.border = BORDER })
      for (let c = 3; c <= lastColumn; c++) {
        line.getCell(c).alignment = { horizontal: 'center' }
      }
    }

    // The header row stays put while a long branch is scrolled.
    sheet.views = [{ state: 'frozen', ySplit: header.number }]

    sheet.addRow([])
    const legend = sheet.addRow([
      `${WORK_DAY_MARKS.SCHEDULED} scheduled · ${WORK_DAY_MARKS.NOT_SCHEDULED} no schedule · ` +
      `${WORK_DAY_MARKS.OFF} day off · ${WORK_DAY_MARKS.OPENER} opener · ` +
      `${WORK_DAY_MARKS.CLOSER} closer · ${WORK_DAY_MARKS.FRONTLINE} frontline · ` +
      'a branch name means working at that branch that day',
    ])
    legend.font = { size: 9 }
    sheet.mergeCells(legend.number, 1, legend.number, lastColumn)

    sheet.addRow([])
    sheet.addRow([])
    const sigLabels = sheet.addRow(['Prepared by', '', 'Approved by'])
    sigLabels.font = { size: 10 }
    const sigNames = sheet.addRow([
      schedule.createdBy?.name ?? '',
      '',
      schedule.approvedBy?.name ?? '',
    ])
    sigNames.font = { bold: true }
    for (const cell of [sigNames.getCell(1), sigNames.getCell(3)]) {
      cell.border = { top: { style: 'thin' } }
    }
    if (schedule.approvedAt) {
      sheet.addRow(['', '', shortDate(schedule.approvedAt.slice(0, 10))]).font = { size: 9 }
    }

    sheet.addRow([])
    const printed = sheet.addRow([
      `Printed ${shortDate(printedOn.toISOString().slice(0, 10))} · ${branchName} · ` +
      `${cutoffCode(schedule.weekStart)} · ${rows.length} staff`,
    ])
    printed.font = { size: 9, color: { argb: 'FF666666' } }
  }

  return workbook
}

/** "WS-38 17-23 Sep 2026 Bangkerohan.xlsx" — ASCII, for a Content-Disposition header. */
export function workbookFilename(schedule: WorkSchedule, branchName: string | null): string {
  const parts = [
    cutoffCode(schedule.weekStart),
    formatCutoff(schedule.weekStart).replace(/–/g, '-'),
    branchName ?? 'All branches',
  ]
  return `${parts.join(' ').replace(/[^A-Za-z0-9 .\-]/g, '').trim()}.xlsx`
}
