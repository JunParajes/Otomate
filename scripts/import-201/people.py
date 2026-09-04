"""
Turn spreadsheet ROWS into PEOPLE with employment SPELLS.

The sheet is a list of spells, not a list of people. Somebody who left and came
back appears twice — once in an active section and once in the archive — and
somebody who left twice appears three times. Importing rows directly would
create two records for one person, split their service history in half, and
leave the work schedule offering to roster a ghost.

WHY NAME IS SAFE AS THE KEY HERE, which it usually is not: 13 names appear on
more than one row, and every one of those groups agrees on BIRTH DATE. There are
no namesakes in this file. That is checked at import time rather than assumed —
if two rows share a name and disagree on a known birth date, they are treated as
different people and reported, because merging two strangers into one record is
far worse than leaving a duplicate for a human to spot.

Three shapes turn up, and they are not the same thing:

  * a genuine rehire — distinct hire dates, the earlier spell closed. Filed as
    an EmploymentPeriod so length of service and holiday eligibility restart,
    which is the rule the business gave: they start fresh, the history is kept.
  * the same spell entered twice — identical hire dates. One spell, not two.
  * one continuous stretch recorded twice — no separation between them, usually
    a transfer between the family's trading names. Also one spell, and the
    EARLIER hire date is the true one because service never broke.
"""
import datetime

FAR_PAST = datetime.date(1900, 1, 1)


class Person:
    """One human being, and every spell of employment the sheet records."""

    def __init__(self, key, rows):
        self.key = key
        self.rows = rows
        self.notes = []
        self.spells, self.merged = self._resolve(rows)

    @property
    def final(self):
        """The spell that is live: the record itself, as opposed to its history."""
        return self.spells[-1]

    @property
    def prior(self):
        """Closed spells to file, oldest first. Empty for almost everybody."""
        return self.spells[:-1]

    def _resolve(self, rows):
        """
        Order the rows into spells, folding away the ones that are not spells.

        Returns (spells, merged) where `merged` are rows whose data is worth
        keeping but which do not describe a separate period of employment.
        """
        by_hire = {}
        merged = []
        for r in sorted(rows, key=lambda r: (r['dateHired'] or FAR_PAST, r['row'])):
            hired = r['dateHired']
            if hired is None:
                # No hire date, no spell — there is nothing to file it as. Its
                # values are still worth harvesting.
                merged.append(r)
                self.notes.append(f'row {r["row"]}: no hire date, merged into the record')
                continue
            if hired in by_hire:
                # The same spell typed twice. Keep whichever row says more.
                first = by_hire[hired]
                keep, drop = (r, first) if _filled(r) > _filled(first) else (first, r)
                by_hire[hired] = keep
                merged.append(drop)
                self.notes.append(
                    f'rows {first["row"]} and {r["row"]}: same hire date — one spell, not two')
                continue
            by_hire[hired] = r

        spells = [by_hire[h] for h in sorted(by_hire)]

        # A spell that never closed cannot sit BEFORE another one: employment did
        # not break, so it is the same stretch written down twice. Fold it into
        # the one that follows and keep the earlier hire date, because that is
        # when service actually started.
        folded = []
        for i, s in enumerate(spells):
            is_last = i == len(spells) - 1
            if not is_last and not s['separatedAt']:
                nxt = spells[i + 1]
                self.notes.append(
                    f'rows {s["row"]} and {nxt["row"]}: continuous employment recorded twice '
                    f'(no separation between them) — kept as one spell from {s["dateHired"]}')
                nxt['dateHired'] = s['dateHired']
                merged.append(s)
                continue
            folded.append(s)

        if not folded:
            # Nobody in this group has a hire date. They still worked here and
            # still belong in the record — an employee with an unknown start is
            # a gap to fill in, not a person to drop on the floor. The fullest
            # row becomes the single spell and carries no dates.
            best = max(rows, key=_filled)
            merged = [r for r in merged if r is not best]
            folded = [best]
            self.notes.append(f'row {best["row"]}: no hire date anywhere for this person')
        return folded, merged

    def field(self, name):
        """
        A personal detail, taken from the newest row that has one.

        Birth date, address and government IDs belong to the person rather than
        to a spell, and the older rows often carry a value the newest one lost.
        Reading newest-first fills those gaps without letting stale data win.
        """
        for r in reversed(self.rows_newest_last()):
            if r.get(name) is not None:
                return r[name]
        return None

    def document(self, key):
        """
        A document's status, from the newest row that has an opinion about it.

        Per document rather than per row. When two rows describe one spell, the
        surviving row is whichever said more overall — which does not mean it
        said more about every single column. Taking the whole documents block
        from one row would throw away a birth certificate that the other row
        recorded, and that actually happened: rows 91 and 351 are one spell, and
        only 351 knew the certificate was on file.
        """
        for r in reversed(self.rows_newest_last()):
            status = (r.get('documents') or {}).get(key)
            if status:
                return status
        return None

    def rows_newest_last(self):
        return sorted(self.rows, key=lambda r: (r['dateHired'] or FAR_PAST, r['row']))

    def all_notes(self):
        out = list(self.notes)
        for r in self.merged:
            if r.get('remarks'):
                out.append(r['remarks'])
        return out


def _filled(row):
    return sum(1 for v in row.values() if v not in (None, '', {}))


def group(rows):
    """
    (people, conflicts).

    `conflicts` are names carried by rows that disagree on a known birth date —
    almost certainly two different people, and never merged.
    """
    buckets = {}
    for r in rows:
        key = (
            (r['lastName'] or '').strip().lower(),
            (r['firstName'] or '').strip().lower(),
            (r['middleName'] or '').strip().lower(),
        )
        buckets.setdefault(key, []).append(r)

    people, conflicts = [], []
    for key, group_rows in buckets.items():
        births = {r['birthDate'] for r in group_rows if r['birthDate']}
        if len(births) > 1:
            # Same name, different birth dates: two people. Import them as two
            # records rather than fusing strangers, and say so.
            conflicts.append((key, [r['row'] for r in group_rows]))
            people.extend(Person(key, [r]) for r in group_rows)
            continue
        people.append(Person(key, group_rows))
    return people, conflicts
