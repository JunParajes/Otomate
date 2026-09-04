"""
Import the 201 spreadsheet into a LOCAL Otomate instance.

    # a token for the local admin
    curl -s -X POST http://localhost:3001/api/auth/login \
      -H 'Content-Type: application/json' \
      -d "{\"email\":\"admin@otomate.local\",\"password\":\"$SEED_ADMIN_PASSWORD\"}" \
      | python3 -c "import json,sys;print(json.load(sys.stdin)['data']['token'])" > /tmp/otomate.token

    # look, change nothing
    python3 scripts/import-201/import.py "<sheet>.xlsx" --wave active

    # actually write
    python3 scripts/import-201/import.py "<sheet>.xlsx" --wave active --commit

Everything goes through the API, so the same Zod validation and permission
checks apply as when a person types it. Data that could not be entered by hand
does not get in this way either — and if a field is rejected, that is a bug in
the mapping worth knowing about rather than something to route around.

TWO WAVES, deliberately.

  active     — the 82 people still employed. These feed work schedules and
               probation warnings, so every field matters and errors surface
               immediately. Small enough to check by eye against the sheet
               afterwards, which is the point.
  separated  — the 260 who have left. An archive: mostly AWOL leavers, largely
               missing IDs and phones already, and nobody's pay depends on them.

Holding both to the same standard triples the work for the half that matters
least.

IDEMPOTENT. Matching is on name plus hire date, because the sheet's "No." column
is filled on only 36 of 349 rows and cannot be a key. A person already present
is updated, not duplicated, so this can be re-run after correcting the sheet.
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import read_sheet  # noqa: E402

API = 'http://localhost:3001'
if 'localhost' not in API and '127.0.0.1' not in API:
    raise SystemExit('Refusing to run against anything but a local API.')

PLACEHOLDER_POSITION = 'Unassigned'


def req(method, path, body=None, token=None):
    r = urllib.request.Request(
        f'{API}{path}', method=method,
        headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'},
        data=json.dumps(body).encode() if body else None)
    try:
        return json.load(urllib.request.urlopen(r))['data']
    except urllib.error.HTTPError as e:
        raise SystemExit(f'{method} {path} -> {e.code}: {e.read().decode()[:400]}')


def natural_key(person):
    """
    What makes two rows the same person.

    Name alone is not enough — 13 names appear more than once in the sheet — and
    the hire date separates a rehire from a namesake. Neither is perfect, which
    is why collisions are reported rather than merged silently.
    """
    return (
        (person['lastName'] or '').strip().lower(),
        (person['firstName'] or '').strip().lower(),
        (person['middleName'] or '').strip().lower(),
        str(person['dateHired'] or ''),
    )


def hr_payload(person, branch_ids):
    """The 201 fields, as the API wants them. Only what the sheet actually says."""
    body = {
        'birthDate': _iso(person['birthDate']),
        'birthPlace': person['birthPlace'],
        'gender': person['gender'],
        'civilStatus': person['civilStatus'],
        'religion': person['religion'],
        'address': person['address'],
        'email': person['email'],
        'heightCm': person['heightCm'],
        'weightGrams': person['weightGrams'],
        'educationLevel': person['educationLevel'],
        'educationDetail': person['educationDetail'],
        'remarks': person['remarks'],
        'emergencyName': person['emergencyName'],
        'emergencyContact': person['emergencyContact'],
        'sssNumber': person['sss'],
        'philhealthNumber': person['philhealth'],
        'pagibigNumber': person['hdmf'],
        'tin': person['tin'],
        'dateHired': _iso(person['dateHired']),
        'separatedAt': _iso(person['separatedAt']),
        'separationReason': person['separationReason'],
    }
    if person['employmentType']:
        body['employmentType'] = person['employmentType']
    # A status per document. The sheet says whether we have it, never when.
    for key, field in (('confidentiality', 'confidentialityAgreement'),
                       ('authority', 'authorityToDeduct'),
                       ('birth_cert', 'birthCertificate'),
                       ('marriage', 'marriageContract')):
        if person['documents'][key]:
            body[field] = person['documents'][key]
    # One number, in the app's list of many. Labelled so it is obvious later that
    # it came from the spreadsheet rather than being confirmed with the person.
    if person['phone']:
        body['contacts'] = [{'number': person['phone'], 'label': 'Mobile'}]
    return {k: v for k, v in body.items() if v is not None}


def _iso(d):
    return d.isoformat() if d else None


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('sheet')
    ap.add_argument('--wave', choices=('active', 'separated', 'all'), default='active')
    ap.add_argument('--commit', action='store_true',
                    help='actually write. Without it nothing is changed.')
    args = ap.parse_args()

    token = open('/tmp/otomate.token').read().strip()
    people, issues, skipped = read_sheet.read(args.sheet)

    wanted = [p for p in people
              if args.wave == 'all'
              or (args.wave == 'active') == bool(p['isActive'])]

    positions = {p['name']: p['id'] for p in req('GET', '/api/admin/positions', token=token)}
    if PLACEHOLDER_POSITION not in positions:
        raise SystemExit(f'No "{PLACEHOLDER_POSITION}" position. Create it first — position '
                         f'names are still being standardised, so nobody is given a real one.')
    branches = {b['name']: b['id'] for b in req('GET', '/api/admin/branches', token=token)}

    existing = {}
    for e in req('GET', '/api/admin/employees', token=token):
        full = req('GET', f"/api/admin/employees/{e['id']}", token=token)
        existing[natural_key({
            'lastName': full['lastName'], 'firstName': full['firstName'],
            'middleName': full['middleName'],
            'dateHired': (full.get('hr') or {}).get('dateHired'),
        })] = e['id']

    print(f'{"COMMIT" if args.commit else "DRY RUN"} · wave "{args.wave}" · '
          f'{len(wanted)} of {len(people)} people')
    print(f'  already in the database: {len(existing)}')

    missing_branch = [p for p in wanted if not p['branch']]
    unknown_branch = sorted({p['branch'] for p in wanted
                             if p['branch'] and p['branch'] not in branches})
    if unknown_branch:
        raise SystemExit(f'These branches are not in Otomate: {unknown_branch}. '
                         f'Add them, or correct scripts/import-201/mapping.py.')

    collisions = {}
    for p in wanted:
        collisions.setdefault(natural_key(p), []).append(p['row'])
    clashing = {k: v for k, v in collisions.items() if len(v) > 1}

    print(f'  no branch in the sheet: {len(missing_branch)} (imported without one)')
    print(f'  same name AND hire date more than once: {len(clashing)}'
          + (f' at rows {sorted(r for v in clashing.values() for r in v)}' if clashing else ''))

    created = updated = failed = 0
    for p in wanted:
        key = natural_key(p)
        payload = {
            'firstName': p['firstName'] or '?',
            'middleName': p['middleName'],
            'lastName': p['lastName'] or '?',
            'positionId': positions[PLACEHOLDER_POSITION],
            'branchId': branches.get(p['branch']) if p['branch'] else None,
            'isActive': bool(p['isActive']),
        }
        if p['employeeCode']:
            payload['employeeCode'] = p['employeeCode']

        if not args.commit:
            created += key not in existing
            updated += key in existing
            continue

        try:
            if key in existing:
                eid = existing[key]
                req('PATCH', f'/api/admin/employees/{eid}', payload, token=token)
                updated += 1
            else:
                eid = req('POST', '/api/admin/employees', payload, token=token)['id']
                existing[key] = eid
                created += 1
            req('PATCH', f'/api/admin/employees/{eid}/hr', hr_payload(p, branches), token=token)
        except SystemExit as e:
            failed += 1
            print(f'  row {p["row"]}: {e}', file=sys.stderr)

    verb = 'would create' if not args.commit else 'created'
    print(f'\n  {verb}: {created}')
    print(f'  {"would update" if not args.commit else "updated"}: {updated}')
    if failed:
        print(f'  FAILED: {failed}')
    if not args.commit:
        print('\nNothing was written. Re-run with --commit to apply.')


if __name__ == '__main__':
    main()
