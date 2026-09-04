"""
Import the 201 spreadsheet into a LOCAL Otomate instance.

    # a token for the local admin
    curl -s -X POST http://localhost:3001/api/auth/login \
      -H 'Content-Type: application/json' \
      -d "{\"email\":\"admin@otomate.local\",\"password\":\"$SEED_ADMIN_PASSWORD\"}" \
      | python3 -c "import json,sys;print(json.load(sys.stdin)['data']['token'])" > /tmp/otomate.token

    python3 scripts/import-201/import.py "<sheet>.xlsx"            # look, change nothing
    python3 scripts/import-201/import.py "<sheet>.xlsx" --commit   # actually write

Everything goes through the API, so the same Zod validation and permission
checks apply as when a person types it. Data that could not be entered by hand
does not get in this way either — and a rejected field is a bug in the mapping
worth knowing about rather than something to route around.

ONE RECORD PER PERSON. The sheet lists SPELLS, not people: somebody who left and
came back appears twice, once in an active section and once in the archive. Rows
are grouped into people first (see people.py, and note that name is only safe as
a key here because every duplicated name agrees on birth date), then each
person's earlier spells are filed through the app's own separate/rehire
endpoints. That is what makes the history real: a filed spell restarts service
and holiday eligibility, which is the rule the business gave — they come back
fresh, and the old spell is kept rather than overwritten.

IDEMPOTENT on the person's name, so this can be re-run after correcting the
sheet without duplicating anybody.
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import people as people_mod  # noqa: E402
import read_sheet  # noqa: E402

DEFAULT_API = 'http://localhost:3001'
PLACEHOLDER_POSITION = 'Unassigned'


def guard_target(api: str, allow_remote: bool) -> str:
    """
    Anything but localhost has to be asked for by name.

    This writes several hundred real people into whatever it is pointed at. The
    guard is not that remote is forbidden — the production import is the whole
    point of the script — but that reaching it must be deliberate, spelled out
    on the command line, and impossible to arrive at by forgetting a flag.
    """
    local = 'localhost' in api or '127.0.0.1' in api
    if local:
        return api
    if not allow_remote:
        raise SystemExit(
            f'Refusing to write to {api}: pass --i-mean-it to import somewhere '
            f'that is not this machine.')
    return api


class ApiError(Exception):
    pass


def req(method, path, body=None, token=None, _tries=0, api=None):
    """
    One API call, waiting out the rate limiter rather than failing under it.

    The API allows 1000 requests per 15 minutes — generous for a person clicking
    around, and this import is roughly 700 in a burst. Re-running inside the
    same window therefore trips it. Backing off is right rather than raising the
    limit: the limiter is a flood backstop protecting a machine that also serves
    eleven branches, and a migration script is the thing that should yield.
    """
    r = urllib.request.Request(
        f'{api or DEFAULT_API}{path}', method=method,
        headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'},
        data=json.dumps(body).encode() if body else None)
    try:
        return json.load(urllib.request.urlopen(r))['data']
    except urllib.error.HTTPError as e:
        if e.code == 429 and _tries < 40:
            if _tries == 0:
                print('  rate limited — waiting for the window to clear…', flush=True)
            time.sleep(30)
            return req(method, path, body, token, _tries + 1, api)
        raise ApiError(f'{method} {path} -> {e.code}: {e.read().decode()[:300]}')


def person_key(last, first, middle):
    return ((last or '').strip().lower(), (first or '').strip().lower(),
            (middle or '').strip().lower())


def _iso(d):
    return d.isoformat() if d else None


def hr_payload(person, spell):
    """
    The 201 fields for the record as it stands at `spell`.

    Personal details come from the person (newest row that has one, so an older
    row can fill a gap the newest one lost); employment details come from the
    spell being written.
    """
    f = person.field
    body = {
        'birthDate': _iso(f('birthDate')),
        'birthPlace': f('birthPlace'),
        'gender': f('gender'),
        'civilStatus': f('civilStatus'),
        'religion': f('religion'),
        'address': f('address'),
        'email': f('email'),
        'heightCm': f('heightCm'),
        'weightGrams': f('weightGrams'),
        'educationLevel': f('educationLevel'),
        'educationDetail': f('educationDetail'),
        'emergencyName': f('emergencyName'),
        'emergencyContact': f('emergencyContact'),
        'sssNumber': f('sss'),
        'philhealthNumber': f('philhealth'),
        'pagibigNumber': f('hdmf'),
        'tin': f('tin'),
        'dateHired': _iso(spell['dateHired']),
        'remarks': _remarks(person, spell),
    }
    if spell['employmentType']:
        body['employmentType'] = spell['employmentType']
    for key, field in (('confidentiality', 'confidentialityAgreement'),
                       ('authority', 'authorityToDeduct'),
                       ('birth_cert', 'birthCertificate'),
                       ('marriage', 'marriageContract')):
        status = spell['documents'].get(key) or person.document(key)
        if status:
            body[field] = status
    phone = f('phone')
    if phone:
        # Labelled so it is obvious later that it came off the spreadsheet rather
        # than being confirmed with the person.
        body['contacts'] = [{'number': phone, 'label': 'Mobile'}]
    return {k: v for k, v in body.items() if v is not None}


def _remarks(person, spell):
    """Everything rescued from cells that could not become values, plus merge notes."""
    parts = []
    if spell.get('remarks'):
        parts.append(spell['remarks'])
    parts.extend(person.all_notes())
    text = ' · '.join(dict.fromkeys(p for p in parts if p))
    return text[:2000] or None


def build(person, token, positions, branches, api):
    """
    Create one person and replay their employment history through the app.

    Earlier spells are laid down with separate/rehire rather than written
    straight into the history table, so they go through the same checks a person
    would hit — including the refusal to rehire somebody before the day they
    left, which catches the two overlapping sequences in the sheet.
    """
    final = person.final
    # A last day earlier than the hire date is not a date we can use, and the API
    # rightly refuses it. Checked here rather than caught, so the record is never
    # left half-built: without this the employee is created, the separation
    # fails, and somebody who has left sits in the roster as active.
    for spell in person.spells:
        if _unusable_separation(spell):
            person.notes.append(
                f'row {spell["row"]}: last day {spell["separatedAt"]} is before the hire date '
                f'{spell["dateHired"]} — marked as left, but the date needs correcting')

    payload = {
        'firstName': person.field('firstName') or '?',
        'middleName': person.field('middleName'),
        'lastName': person.field('lastName') or '?',
        'suffix': person.field('suffix'),
        'positionId': positions[PLACEHOLDER_POSITION],
        'branchId': branches.get(final['branch']) if final['branch'] else None,
        'isActive': True,  # separated at the end, through the real action
    }
    # The sheet's "No." column is NOT imported. It is filled on 36 of 349 rows,
    # is not unique across them, and nobody uses it — an identifier that applies
    # to a tenth of the roster is worse than none, because it looks like a key.
    eid = req('POST', '/api/admin/employees', payload, token=token, api=api)['id']

    # Walk the spells oldest first, closing each one and reopening the next.
    for i, spell in enumerate(person.spells):
        req('PATCH', f'/api/admin/employees/{eid}/hr', hr_payload(person, spell), token=token, api=api)
        is_last = i == len(person.spells) - 1
        if not is_last and _unusable_separation(spell):
            # Cannot be closed, so cannot be filed as a prior spell. Skipping the
            # rehire keeps the record coherent — one open spell — rather than
            # inventing a history the dates do not support.
            continue
        if not is_last:
            nxt = person.spells[i + 1]
            req('POST', f'/api/admin/employees/{eid}/separate', {
                'separatedOn': _iso(spell['separatedAt']),
                'separationReason': spell['separationReason'],
            }, token=token, api=api)
            req('POST', f'/api/admin/employees/{eid}/rehire', {
                'dateHired': _iso(nxt['dateHired']),
                'employmentType': nxt['employmentType'] or 'PROBATIONARY',
            }, token=token, api=api)

    if not final['isActive']:
        if final['separatedAt'] and not _unusable_separation(final):
            req('POST', f'/api/admin/employees/{eid}/separate', {
                'separatedOn': _iso(final['separatedAt']),
                'separationReason': final['separationReason'],
            }, token=token, api=api)
        else:
            # Left, but with no usable last day — the sheet never recorded one
            # (common for AWOL: somebody stops coming and nobody writes a date)
            # or the one it has predates the hire date. Mark them inactive
            # rather than inventing a day they left.
            req('PATCH', f'/api/admin/employees/{eid}', {'isActive': False}, token=token, api=api)
    return eid


def _unusable_separation(spell):
    """A last day before the hire date. One row in the sheet has this."""
    return bool(spell['separatedAt'] and spell['dateHired']
                and spell['separatedAt'] < spell['dateHired'])


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('sheet')
    ap.add_argument('--only', choices=('active', 'separated', 'all'), default='all',
                    help='which people to import, by whether their LATEST spell is open')
    ap.add_argument('--commit', action='store_true', help='actually write')
    ap.add_argument('--api', default=DEFAULT_API, help='the Otomate API to write to')
    ap.add_argument('--i-mean-it', dest='allow_remote', action='store_true',
                    help='required to write anywhere that is not this machine')
    ap.add_argument('--create-branches', action='store_true',
                    help="create any branch the sheet names that does not exist yet")
    ap.add_argument('--token-file', default='/tmp/otomate.token')
    args = ap.parse_args()

    api = guard_target(args.api, args.allow_remote)
    token = open(args.token_file).read().strip()
    rows, _, _ = read_sheet.read(args.sheet)
    everyone, conflicts = people_mod.group(rows)

    wanted = [p for p in everyone
              if args.only == 'all' or (args.only == 'active') == bool(p.final['isActive'])]

    positions = {p['name']: p['id'] for p in req('GET', '/api/admin/positions', token=token, api=api)}
    if PLACEHOLDER_POSITION not in positions:
        # Everyone lands here until the real position names are settled, so a
        # fresh database needs it made rather than being told to go and do it.
        if args.commit:
            positions[PLACEHOLDER_POSITION] = req(
                'POST', '/api/admin/positions',
                {'name': PLACEHOLDER_POSITION}, token=token, api=api)['id']
            print(f'  created the "{PLACEHOLDER_POSITION}" position')
        else:
            print(f'  would create the "{PLACEHOLDER_POSITION}" position')
            positions[PLACEHOLDER_POSITION] = '(pending)'
    branches = {b['name']: b['id'] for b in req('GET', '/api/admin/branches', token=token, api=api)}

    existing = {}
    for e in req('GET', '/api/admin/employees?includeInactive=true', token=token, api=api):
        existing[person_key(e['lastName'], e['firstName'], e.get('middleName'))] = e['id']

    unknown = sorted({p.final['branch'] for p in wanted
                      if p.final['branch'] and p.final['branch'] not in branches})
    if unknown and not args.create_branches:
        raise SystemExit(
            f'Branches not in Otomate: {unknown}\n'
            f'Pass --create-branches to have them made from the sheet, or correct the '
            f'names in scripts/import-201/mapping.py.')
    if unknown:
        # Created from the sheet, which is the point on a clean database: the
        # spreadsheet's branch names become the branch list, so no reconciling
        # is needed between what HR types and what the app calls a place.
        print(f'  branches to create ({len(unknown)}): {", ".join(unknown)}')
        if args.commit:
            for name in unknown:
                branches[name] = req('POST', '/api/admin/branches',
                                     {'name': name}, token=token, api=api)['id']
            print(f'  created {len(unknown)} branches')

    rehired = [p for p in everyone if len(p.spells) > 1]
    folded = [p for p in everyone if p.merged]

    print(f'{"COMMIT" if args.commit else "DRY RUN"} · {api} · {len(rows)} rows -> '
          f'{len(everyone)} people · importing {len(wanted)}')
    print(f'  already in the database : {len(existing)}')
    print(f'  people with prior spells: {len(rehired)} '
          f'({sum(len(p.spells) - 1 for p in rehired)} spells to file)')
    print(f'  rows folded as duplicates or continuous service: '
          f'{sum(len(p.merged) for p in folded)} across {len(folded)} people')
    if conflicts:
        print(f'  SAME NAME, DIFFERENT BIRTH DATE — kept apart: {len(conflicts)}')
        for key, at in conflicts:
            print(f'    rows {at}')

    if not args.commit:
        print(f'\n  would create: {sum(1 for p in wanted if person_key(*p.key) not in existing)}')
        print(f'  would skip (already present): '
              f'{sum(1 for p in wanted if person_key(*p.key) in existing)}')
        print('\nNothing was written. Re-run with --commit to apply.')
        return

    created = skipped = failed = 0
    for p in wanted:
        if p.key in existing:
            skipped += 1
            continue
        try:
            build(p, token, positions, branches, api)
            created += 1
        except ApiError as e:
            failed += 1
            print(f'  rows {[r["row"] for r in p.rows]}: {e}', file=sys.stderr)

    print(f'\n  created: {created}')
    print(f'  already present, left alone: {skipped}')
    if failed:
        print(f'  FAILED: {failed} — see above. A failure part-way through leaves the record\n        in whatever state it reached, so re-run after fixing the sheet.')


if __name__ == '__main__':
    main()
