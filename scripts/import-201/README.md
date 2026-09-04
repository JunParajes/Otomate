# Importing the 201 spreadsheet

One-time migration of the employee records kept in
`EMPLOYEE'S DETAILS-PRESENT.xlsx` into Otomate.

**The spreadsheet is real people and this repo is public.** It is never committed,
and neither is the audit report — `.gitignore` blocks `*.xlsx` and
`audit-report.md`, and that rule was tested rather than assumed. Keep the file
where it already lives and pass its path on the command line.

## Setup

Needs `openpyxl`, which is not otherwise a dependency of this project:

```bash
python3 -m venv /tmp/201-venv && /tmp/201-venv/bin/pip install openpyxl
```

## 1. Audit — reads only, changes nothing

```bash
/tmp/201-venv/bin/python scripts/import-201/audit.py "/path/to/EMPLOYEE'S DETAILS-PRESENT.xlsx"
```

Two outputs, and the split is deliberate:

- **stdout** — counts only. No name, number, address or birth date, so it can be
  pasted into a chat or a shared terminal without leaking anybody.
- **`audit-report.md`**, written beside the spreadsheet — the full detail, every
  issue against the row and the person it belongs to. This is the one to work
  from, and the one to keep private.

Fix what you want fixed in the spreadsheet, run it again, repeat until the
remaining items are all deliberate decisions rather than surprises.

## What the audit is actually checking

The sheet is redundant — it stores a birth date *and* a birth year *and* an age
— and that redundancy is the most valuable thing in it. Import the dates,
recompute, compare. A disagreement means one of the two is a typo, which is the
error class you cannot otherwise see once the data is in the system.

Two findings from the first run shaped how this works:

- The **`Yr` column is a real checksum**: 191 rows agree, 1 disagrees. That one
  is worth looking at.
- The **`Age` column is not**. It was typed when each person was added and never
  recomputed, so over a sheet spanning 2024–2026 the offsets smear across four
  years. Checking it strictly produced 68 false alarms and buried the 5 genuine
  ones, so only offsets outside that drift are reported now.

## Rules the reader applies

Every rule came from looking at the actual distinct values and asking. Nothing
is guessed, and anything unrecognised is left empty for a human rather than
approximated — a wrong value that looks right is worse than a blank, because the
blank gets filled in and the wrong one gets believed.

| Situation | What happens |
|---|---|
| Text dates | Read as `MM/DD/YYYY`. Verified: 261 cells have a second component above 12 and **none** has a first component above 12, so `dd/mm` is impossible |
| Phone stored as a number | Excel ate the leading zero; 10 digits starting `9` gets it back. Anything else is reported, never padded |
| `N/A`, `complying`, `follow` in an ID or date | Imports **empty**, and the word is kept in Remarks. Empty already means "not on file"; `complying` was somebody's task and deleting it silently throws away work |
| Position | **Not mapped.** Everyone imports as `Unassigned` with the sheet's word in Remarks, until the naming is settled |
| Branch | Spelling variants collapse to the 12 real branches. A cell naming two branches is left for a human |
| Education | Level becomes the enum, the rest becomes the detail — `Senior High School (TVL)` keeps its TVL. `Km12` is a mangled `K-12`, which is Senior High |
| Chicken and Freshness | Closed. Not imported |
| Column R / column W | Employment type from R. For active/separated the **section wins**: 16 rows below the SEPARATED header still say `Active`, and every one has a real end date after its hire date. Moving a row into the archive is deliberate; leaving a cell reading `Active` is what happens when nobody edits it. Within the active block W still decides, and it correctly catches 2 people marked AWOL/END who were never moved down |
| A date wearing a word | `Rehired 07/24/2025`, `Offially in LDB 10/01/2025` — the date is taken and the words kept in Remarks. 14 of these, and discarding a good date for tidiness loses real information |

## Files

| File | What it does |
|---|---|
| `mapping.py` | The vocabulary — every spreadsheet word and what it becomes |
| `read_sheet.py` | Parsing and checking. Touches no database, so it is safe to run repeatedly |
| `audit.py` | The report |

## Tests

```bash
/tmp/201-venv/bin/python scripts/import-201/test_parsers.py
```

55 checks over the shapes actually found in the sheet. No spreadsheet needed —
every case is a literal, so this carries no personal data and runs anywhere.

The impossible cases are the point. A month of 13 must be REFUSED, not quietly
read as a day: that would invent a date which looks entirely reasonable and is
wrong. The suite was mutation-checked by flipping MM/DD to DD/MM, which breaks 9
of the checks.
