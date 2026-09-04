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
| The `No.` column | **Not imported.** Filled on 36 of 349 rows and not unique across them. An identifier that covers a tenth of the roster is worse than none, because it looks like a key |
| `Jr.` / `Sr.` | The sheet has no suffix column, so these ride along in the Surname (9) or the First Name (2). Split into `suffix` and normalised — a stray `Jr,` becomes `Jr.` Matched against a **closed list**, never "the last word": `Dela Pena`, `San Juan` and sixty-odd second given names like `Mae` and `Joy` must survive untouched |
| Column R / column W | Employment type from R. For active/separated the **section wins**: 16 rows below the SEPARATED header still say `Active`, and every one has a real end date after its hire date. Moving a row into the archive is deliberate; leaving a cell reading `Active` is what happens when nobody edits it. Within the active block W still decides, and it correctly catches 2 people marked AWOL/END who were never moved down |
| A date wearing a word | `Rehired 07/24/2025`, `Offially in LDB 10/01/2025` — the date is taken and the words kept in Remarks. 14 of these, and discarding a good date for tidiness loses real information |

## 2. Import

```bash
# look, change nothing
/tmp/201-venv/bin/python scripts/import-201/import.py "<sheet>.xlsx"
# actually write, creating any branch the sheet names
/tmp/201-venv/bin/python scripts/import-201/import.py "<sheet>.xlsx" --create-branches --commit
```

**On a clean database, let the sheet define the branch list.** `--create-branches`
makes every branch the spreadsheet names, so nothing has to be reconciled between
what HR types and what the app calls a place. Without the flag an unknown branch
stops the run rather than being invented. The `Unassigned` position is created
the same way.

### Writing somewhere that is not this machine

```bash
… --api https://otomate.uk --i-mean-it --token-file ~/.otomate-prod.token
```

Anything but localhost has to be named on the command line AND accompanied by
`--i-mean-it`. The guard is not that remote is forbidden — the production import
is the point — but that reaching production must be deliberate and impossible to
arrive at by forgetting a flag.

Everything goes through the API, so the same validation and permission checks
apply as when a person types it. Local only — it refuses any other host.

**One record per person.** The sheet lists *spells*, not people: somebody who
left and came back appears twice, once in an active section and once in the
archive, and one person appears three times. Importing rows directly would
create two records for one human, split their service history, and leave the
work schedule offering to roster a ghost.

So rows are grouped into people first, then each person's earlier spells are
laid down through the app's own separate/rehire endpoints — which is what makes
the history real. A filed spell restarts service and holiday eligibility, the
rule the business gave: they come back fresh and the old spell is kept.

342 rows become **328 people**: 8 with genuine prior spells, and 6 rows folded
because they were the same spell typed twice or one continuous stretch recorded
under two trading names.

**Name is only safe as the key because this file has no namesakes.** All 13
duplicated names agree on birth date. That is checked at import time rather than
assumed — two rows sharing a name but disagreeing on a known birth date are kept
as separate people and reported, because merging two strangers into one record
is far worse than leaving a duplicate for someone to spot.

**Idempotent**, so the loop is: fix the sheet, re-run, re-verify. A second run
creates nobody.

`--only active` / `--only separated` narrow it by whether the person's latest
spell is open.

Everyone imports into the `Unassigned` position with their real position kept in
Remarks, until the naming is settled.

## 3. Verify

```bash
/tmp/201-venv/bin/python scripts/import-201/verify.py "<sheet>.xlsx" --wave active
```

The import reporting success only means the API accepted every request. This
asks the useful question instead: **does what is now stored say the same thing as
the sheet?** It re-reads the spreadsheet from scratch and fetches every record
back through the API, so a value that changed shape in between — a date shifted
across midnight by a timezone, kilos stored as grams and read back wrong, a
leading zero lost again on the way in — shows up as a mismatch rather than as
silence.

It currently reports **328 of 328 people, 9184 field comparisons, 0 mismatches**,
and that includes the number of filed prior spells per person.

That number is only worth anything because the check was mutation-tested twice:
corrupting a height, a birth date and a document status made it report exactly
those three; deleting a filed spell, flipping someone to inactive and rewriting
a Pag-IBIG number made it report exactly those three. It also caught a real
disagreement — where the database was right and the checker was wrong — which is
how the per-document merge rule below came to be written down properly.

## Files

| File | What it does |
|---|---|
| `mapping.py` | The vocabulary — every spreadsheet word and what it becomes |
| `read_sheet.py` | Parsing and checking. Touches no database, so it is safe to run repeatedly |
| `audit.py` | The report on what will and will not import |
| `people.py` | Groups rows into people and resolves their spells |
| `import.py` | The import, dry by default |
| `verify.py` | Reads the database back and compares it to the sheet |
| `test_parsers.py` | 55 checks on the parsers, no spreadsheet needed |

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
