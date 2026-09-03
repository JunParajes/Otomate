import { createPortal } from 'react-dom'
import {
  WORK_DAY_MARKS, cellMark, cutoffCode, formatCutoff,
  type WorkSchedule, type WorkScheduleRow,
} from '@otomate/shared'
import classes from './WorkSchedulePrintSheet.module.css'

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/**
 * The branch's paper copy.
 *
 * Not a screenshot of the grid — a document. The branches have no tablet yet, so
 * this sheet IS the schedule as far as they are concerned: it goes on a wall and
 * has to answer, on its own, which week it covers, who prepared it, who approved
 * it, and whether it is final.
 *
 * Built as its own markup rather than by printing the interactive grid. The grid
 * has sticky columns, colour-coded backgrounds and buttons in every cell, none of
 * which mean anything on paper, and most of which fight the printer.
 *
 * Designed for BLACK AND WHITE. Browsers omit background colours when printing
 * unless the person changes a setting they will not think to change, so nothing
 * here depends on colour: the marks and the rules carry it. That is only
 * possible because the mark already says what the cell means.
 */
export default function WorkSchedulePrintSheet({
  schedule,
  groups,
  printedOn = new Date(),
}: {
  schedule: WorkSchedule
  /** Branch name and its rows, already filtered to whatever was chosen. */
  groups: [string, WorkScheduleRow[]][]
  printedOn?: Date
}) {
  const approved = schedule.status === 'APPROVED'

  /*
   * Rendered into <body> rather than in place.
   *
   * Two earlier attempts failed for the same underlying reason — the sheet was
   * buried inside the app. display:none on its ancestors took the sheet with it
   * and printed a blank page; visibility:hidden let the sheet through but KEPT
   * the app's layout, so its full height went on paginating underneath and every
   * sheet came out with blank pages behind it.
   *
   * As a direct child of body it has no app ancestors to fight: hiding body's
   * other children removes both their ink and their height.
   */
  return createPortal(
    <div className={classes.sheet} data-print-sheet aria-hidden>
      {groups.map(([branchName, rows]) => (
        // Each branch is its own page: the sheet goes to that branch, and
        // nobody wants to cut a page in half to post it.
        <section key={branchName} className={classes.page}>
          <header className={classes.head}>
            <div>
              <h1 className={classes.title}>Work Schedule</h1>
              <p className={classes.branch}>{branchName}</p>
            </div>
            <div className={classes.meta}>
              <p className={classes.code}>{cutoffCode(schedule.weekStart)}</p>
              <p>{formatCutoff(schedule.weekStart)}</p>
              <p className={classes.dim}>Thursday to Wednesday</p>
            </div>
          </header>

          {/*
            A draft on a wall is worse than no sheet, because it will be followed.
            It says so across the top, not in small print at the bottom.
          */}
          {!approved && (
            <p className={classes.draft}>
              NOT YET APPROVED — this is a draft and may still change
            </p>
          )}

          <table className={classes.grid}>
            <thead>
              <tr>
                <th className={classes.nameCol}>Employee</th>
                {schedule.days.map(d => {
                  const date = new Date(`${d}T00:00:00.000Z`)
                  return (
                    <th key={d} className={classes.dayCol}>
                      <span className={classes.dayName}>{DAY_NAMES[date.getUTCDay()]}</span>
                      <span className={classes.dayDate}>{d.slice(8)}/{d.slice(5, 7)}</span>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.employeeId}>
                  <td className={classes.nameCol}>
                    <span className={classes.name}>{row.nameFiled}</span>
                    <span className={classes.position}>{row.position}</span>
                  </td>
                  {schedule.days.map(d => (
                    <td key={d} className={classes.dayCol}>{cellMark(row.days[d])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>

          {/*
            The legend earns its place precisely because this is black and white:
            the marks are doing all the work, so they have to be explained.
          */}
          <p className={classes.legend}>
            <strong>{WORK_DAY_MARKS.SCHEDULED}</strong> scheduled
            <span> · </span><strong>{WORK_DAY_MARKS.NOT_SCHEDULED}</strong> no schedule
            <span> · </span><strong>{WORK_DAY_MARKS.OFF}</strong> day off
            <span> · </span><strong>{WORK_DAY_MARKS.OPENER}</strong> opener
            <span> · </span><strong>{WORK_DAY_MARKS.CLOSER}</strong> closer
            <span> · </span><strong>{WORK_DAY_MARKS.FRONTLINE}</strong> frontline
            <span> · </span>a branch name means working at that branch that day
          </p>

          <footer className={classes.signatures}>
            <div className={classes.signature}>
              <span className={classes.sigLabel}>Prepared by</span>
              <span className={classes.sigLine} />
              <span className={classes.sigName}>{schedule.createdBy?.name ?? ''}</span>
            </div>
            <div className={classes.signature}>
              <span className={classes.sigLabel}>Approved by</span>
              <span className={classes.sigLine} />
              <span className={classes.sigName}>{schedule.approvedBy?.name ?? ''}</span>
              <span className={classes.sigDate}>
                {schedule.approvedAt ? shortDate(schedule.approvedAt.slice(0, 10)) : ''}
              </span>
            </div>
          </footer>

          {/*
            Which copy is this? Reprints happen mid-cutoff, and two sheets on a
            wall with no way to tell them apart is how the wrong one gets followed.
          */}
          <p className={classes.printed}>
            Printed {shortDate(printedOn.toISOString().slice(0, 10))}
            {' · '}{branchName}
            {' · '}{cutoffCode(schedule.weekStart)}
            {' · '}{rows.length} staff
          </p>
        </section>
      ))}
    </div>,
    document.body
  )
}
