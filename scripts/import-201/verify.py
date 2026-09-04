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
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import read_sheet  # noqa: E402
import importlib.util  # noqa: E402
_spec = importlib.util.spec_from_file_location(
    'import_201', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'import.py'))
_mod = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(_mod)
natural_key = _mod.natural_key

API = 'http://localhost:3001'


def req(path, token):
    r = urllib.request.Request(f'{API}{path}',
                               headers={'Authorization': f'Bearer {token}'})
    return json.load(urllib.request.urlopen(r))['data']


def expected(person):
    """What the sheet says this record should contain, in the API's own shapes."""
    docs = person['documents']
    return {
        'firstName': person['firstName'],
        'lastName': person['lastName'],
        'middleName': person['middleName'],
        'isActive': bool(person['isActive']),
        'hr.birthDate': _iso(person['birthDate']),
        'hr.birthPlace': person['birthPlace'],
        'hr.gender': person['gender'],
        'hr.civilStatus': person['civilStatus'],
        'hr.religion': person['religion'],
        'hr.address': person['address'],
        'hr.email': person['email'],
        'hr.heightCm': person['heightCm'],
        'hr.weightGrams': person['weightGrams'],
        'hr.educationLevel': person['educationLevel'],
        'hr.educationDetail': person['educationDetail'],
        'hr.dateHired': _iso(person['dateHired']),
        'hr.separatedAt': _iso(person['separatedAt']),
        'hr.sssNumber': person['sss'],
        'hr.philhealthNumber': person['philhealth'],
        'hr.pagibigNumber': person['hdmf'],
        'hr.tin': person['tin'],
        'hr.emergencyName': person['emergencyName'],
        'hr.emergencyContact': person['emergencyContact'],
        'hr.confidentialityAgreement': docs['confidentiality'] or 'MISSING',
        'hr.authorityToDeduct': docs['authority'] or 'MISSING',
        'hr.birthCertificate': docs['birth_cert'] or 'MISSING',
        'hr.marriageContract': docs['marriage'] or 'MISSING',
        'phone': person['phone'],
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
    }
    for k in ('birthDate', 'birthPlace', 'gender', 'civilStatus', 'religion', 'address',
              'email', 'heightCm', 'weightGrams', 'educationLevel', 'educationDetail',
              'dateHired', 'separatedAt', 'sssNumber', 'philhealthNumber', 'pagibigNumber',
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
    people, _, _ = read_sheet.read(args.sheet)
    wanted = [p for p in people
              if args.wave == 'all' or (args.wave == 'active') == bool(p['isActive'])]

    stored = {}
    for e in req('/api/admin/employees?includeInactive=true', token):
        full = req(f"/api/admin/employees/{e['id']}", token)
        stored[natural_key({
            'lastName': full['lastName'], 'firstName': full['firstName'],
            'middleName': full['middleName'],
            'dateHired': (full.get('hr') or {}).get('dateHired'),
        })] = full

    missing, mismatches = [], []
    per_field = collections.Counter()
    for p in wanted:
        rec = stored.get(natural_key(p))
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
        print(f'  NOT IMPORTED: {len(missing)} (rows {[p["row"] for p in missing][:20]})')
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
                f.write(f'- row {p["row"]}: {p["firstName"]} {p["lastName"]}\n')
        f.write('\n## Mismatches\n\n')
        if not mismatches:
            f.write('None.\n')
        else:
            f.write('| Row | Person | Field | Sheet says | Database has |\n|---|---|---|---|---|\n')
            for p, field, w, g in mismatches:
                f.write(f'| {p["row"]} | {p["firstName"]} {p["lastName"]} | {field} '
                        f'| `{w}` | `{g}` |\n')
    print(f'\ndetail written to {out}')


if __name__ == '__main__':
    main()
