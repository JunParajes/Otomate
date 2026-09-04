"""
Read the database back and compare it against the spreadsheet, field by field.

    python3 scripts/import-201/verify.py "<sheet>.xlsx" --wave active

The import reported success, which only means the API accepted every request.
This asks the different and more useful question: does what is now stored say
the same thing as the sheet?

It re-reads the spreadsheet from scratch and fetches every record through the
API, so a value that changed shape in between — a date shifted across midnight
by a timezone, kilos stored as grams and read back as kilos, a leading zero lost
again on the way in — shows up as a mismatch rather than as silence.

stdout is counts and field names only. Any actual mismatches are written to
verify-report.md beside the spreadsheet, which names people and is therefore
private.
"""
import argparse
import collections
import json
import os
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import people as people_mod  # noqa: E402
import read_sheet  # noqa: E402


def person_key(last, first, middle):
    return ((last or '').strip().lower(), (first or '').strip().lower(),
            (middle or '').strip().lower())

API = 'http://localhost:3001'


def req(path, token, _tries=0):
    """One read, waiting out the rate limiter — see the note in import.py."""
    r = urllib.request.Request(f'{API}{path}',
                               headers={'Authorization': f'Bearer {token}'})
    try:
        return json.load(urllib.request.urlopen(r))['data']
    except urllib.error.HTTPError as e:
        if e.code == 429 and _tries < 40:
            if _tries == 0:
                print('  rate limited — waiting for the window to clear…', flush=True)
            time.sleep(30)
            return req(path, token, _tries + 1)
        raise


def expected(person):
    """
    What the sheet says this person's record should hold.

    Personal details are read the way the import reads them — newest row that
    has a value — because they belong to the person, not to a spell. Employment
    details come from the FINAL spell, which is what the live record shows; the
    earlier ones are checked separately as filed history.
    """
    f = person.field
    final = person.final
    docs = final['documents']
    return {
        'firstName': f('firstName'),
        'lastName': f('lastName'),
        'middleName': f('middleName'),
        'isActive': bool(final['isActive']),
        'hr.birthDate': _iso(f('birthDate')),
        'hr.birthPlace': f('birthPlace'),
        'hr.gender': f('gender'),
        'hr.civilStatus': f('civilStatus'),
        'hr.religion': f('religion'),
        'hr.address': f('address'),
        'hr.email': f('email'),
        'hr.heightCm': f('heightCm'),
        'hr.weightGrams': f('weightGrams'),
        'hr.educationLevel': f('educationLevel'),
        'hr.educationDetail': f('educationDetail'),
        'hr.dateHired': _iso(final['dateHired']),
        'hr.sssNumber': f('sss'),
        'hr.philhealthNumber': f('philhealth'),
        'hr.pagibigNumber': f('hdmf'),
        'hr.tin': f('tin'),
        'hr.emergencyName': f('emergencyName'),
        'hr.emergencyContact': f('emergencyContact'),
        # Per document, newest row that says anything — a folded duplicate row
        # often knows about a certificate the surviving row does not.
        'hr.confidentialityAgreement': docs['confidentiality'] or person.document('confidentiality') or 'MISSING',
        'hr.authorityToDeduct': docs['authority'] or person.document('authority') or 'MISSING',
        'hr.birthCertificate': docs['birth_cert'] or person.document('birth_cert') or 'MISSING',
        'hr.marriageContract': docs['marriage'] or person.document('marriage') or 'MISSING',
        'phone': f('phone'),
        'priorSpells': len(person.prior),
    }


def actual(record):
    hr = record.get('hr') or {}
    contacts = hr.get('contacts') or []
    got = {
        'firstName': record['firstName'],
        'lastName': record['lastName'],
        'middleName': record['middleName'],
        'isActive': record['isActive'],
        'phone': contacts[0]['number'] if contacts else None,
        'priorSpells': len(hr.get('pastEmployment') or []),
    }
    for k in ('birthDate', 'birthPlace', 'gender', 'civilStatus', 'religion', 'address',
              'email', 'heightCm', 'weightGrams', 'educationLevel', 'educationDetail',
              'dateHired', 'sssNumber', 'philhealthNumber', 'pagibigNumber',
              'tin', 'emergencyName', 'emergencyContact', 'confidentialityAgreement',
              'authorityToDeduct', 'birthCertificate', 'marriageContract'):
        got[f'hr.{k}'] = hr.get(k)
    return got


def _iso(d):
    return d.isoformat() if d else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('sheet')
    ap.add_argument('--wave', choices=('active', 'separated', 'all'), default='active')
    args = ap.parse_args()

    token = open('/tmp/otomate.token').read().strip()
    rows, _, _ = read_sheet.read(args.sheet)
    everyone, _conflicts = people_mod.group(rows)
    wanted = [p for p in everyone
              if args.wave == 'all' or (args.wave == 'active') == bool(p.final['isActive'])]

    stored = {}
    for e in req('/api/admin/employees?includeInactive=true', token):
        full = req(f"/api/admin/employees/{e['id']}", token)
        stored[person_key(full['lastName'], full['firstName'], full['middleName'])] = full

    missing, mismatches = [], []
    per_field = collections.Counter()
    for p in wanted:
        rec = stored.get(person_key(*p.key))
        if rec is None:
            missing.append(p)
            continue
        want, got = expected(p), actual(rec)
        for field, w in want.items():
            g = got.get(field)
            if (w or None) != (g or None):
                per_field[field] += 1
                mismatches.append((p, field, w, g))

    checked = len(wanted) - len(missing)
    fields = len(expected(wanted[0])) if wanted else 0
    print(f'wave "{args.wave}": {len(wanted)} people in the sheet, {checked} found in the database')
    if missing:
        print(f'  NOT IMPORTED: {len(missing)}')
    print(f'  {checked * fields} field comparisons, {len(mismatches)} mismatches')
    if per_field:
        print('\n  mismatches by field:')
        for field, n in per_field.most_common():
            print(f'    {n:>4}  {field}')
    else:
        print('\n  every field matches the spreadsheet.')

    out = os.path.join(os.path.dirname(os.path.abspath(args.sheet)), 'verify-report.md')
    with open(out, 'w', encoding='utf-8') as f:
        f.write('# 201 import — verification\n\n')
        f.write(f'Wave "{args.wave}". {checked} of {len(wanted)} people found, '
                f'{len(mismatches)} field mismatches.\n\n')
        f.write('**Contains personal data.** Do not commit.\n\n')
        if missing:
            f.write('## Not imported\n\n')
            for p in missing:
                f.write(f'- rows {[r["row"] for r in p.rows]}: {p.field("firstName")} {p.field("lastName")}\n')
        f.write('\n## Mismatches\n\n')
        if not mismatches:
            f.write('None.\n')
        else:
            f.write('| Row | Person | Field | Sheet says | Database has |\n|---|---|---|---|---|\n')
            for p, field, w, g in mismatches:
                f.write(f'| {[r["row"] for r in p.rows]} | {p.field("firstName")} '
                        f'{p.field("lastName")} | {field} | `{w}` | `{g}` |\n')
    print(f'\ndetail written to {out}')


if __name__ == '__main__':
    main()
