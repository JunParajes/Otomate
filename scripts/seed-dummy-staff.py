"""
Dummy staff for a LOCAL instance. Never point this at production.

Usage:
    # token for the local admin
    curl -s -X POST http://localhost:3001/api/auth/login \
      -H 'Content-Type: application/json' \
      -d "{\"email\":\"admin@otomate.local\",\"password\":\"$SEED_ADMIN_PASSWORD\"}" \
      | python3 -c "import json,sys;print(json.load(sys.stdin)['data']['token'])" > /tmp/otomate.token
    python3 scripts/seed-dummy-staff.py

Fills the roster to 76 staff across the existing branches and gives every one of
them a complete 201 file, so the employee list and the work-schedule grid can be
looked at with realistic volume rather than the three or four rows a hand-made
fixture ends up with. Several UI problems only appeared at this size — names
wrapping to three lines, a badge squeezed to "N..", ragged row heights.

Fixed seed, so re-running produces the same people rather than a new random
set. Everything goes through the API, so the same Zod validation and permission
checks apply as when a person types it — data that could not be entered by hand
does not get in this way either.
"""
import json, random, sys, urllib.error, urllib.request
from datetime import date, timedelta

API = 'http://localhost:3001'
if 'localhost' not in API and '127.0.0.1' not in API:
    raise SystemExit('Refusing to run against anything but a local API — this invents people.')
TOKEN = open('/tmp/otomate.token').read().strip()
TODAY = date(2026, 9, 3)
random.seed(20260903)

def req(method, path, body=None):
    r = urllib.request.Request(f'{API}{path}', method=method,
        headers={'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json'},
        data=json.dumps(body).encode() if body else None)
    try:
        return json.load(urllib.request.urlopen(r))['data']
    except urllib.error.HTTPError as e:
        raise SystemExit(f'{method} {path} -> {e.code}: {e.read().decode()[:300]}')

GIVEN_F = ['Maria','Ana','Rosario','Jocelyn','Cristina','Lorna','Marilou','Grace','Jenny','Rowena',
           'Kristine','Michelle','Liezel','Aileen','Jessa','Riza','Charmaine','Divina','Precious','Angelica','Mylene']
GIVEN_M = ['Jose','Juan','Ramon','Ricardo','Danilo','Rolando','Nestor','Arnel','Edgar','Joel',
           'Mark','Jayson','Kenneth','Rey','Alvin','Noel','Ferdinand','Emilio','Bernard','Christian']
MIDDLE = ['Santos','Cruz','Reyes','Bautista','Villanueva','Mendoza','Aquino','Castillo','Navarro','Ramos',
          'Delos Reyes','Gutierrez','Fernandez','Salazar','Ocampo','Padilla','Lozano','Marquez']
SUR = ['Dela Cruz','Garcia','Torres','Flores','Rivera','Morales','Aguilar','Valencia','Domingo','Espinosa',
       'Bataan','Maglana','Dorilag','Ecling','Sagne','Bentay','Nuyad','Dacao','Maslog','Paredes',
       'Tugade','Bacaltos','Quiblat','Amper','Lumanog','Sarmiento','Bulaong','Cabahug','Yap','Tan',
       'Uy','Lim','Ong','Balajadea','Gempesaw','Monteverde','Almendras','Duterte','Bangoy','Magsaysay']
BARANGAY = ['Bangkerohan','Buhangin','Panacan','Sasa','Toril','Matina','Agdao','Bunawan','Ma-a','Talomo',
            'Catalunan','Dumoy','Mintal','Tugbok','Calinan','Baguio District','Cabantian','Communal',
            'Ilang','Lasang','Mudiang','Tibungco']
STREET = ['Rizal St','Bonifacio St','Quezon Blvd','San Pedro St','Ilustre St','Magallanes St','R. Castillo St',
          'J.P. Laurel Ave','Cabaguio Ave','McArthur Hwy','Diversion Rd','Bajada Rd']
RELIGION = ['Roman Catholic','Iglesia ni Cristo','Seventh-day Adventist','Baptist','Islam','Born Again','UCCP']
EDU = [('HIGH_SCHOOL','High School Graduate'),('SENIOR_HIGH','ABM Strand'),('SENIOR_HIGH','TVL Strand'),
       ('VOCATIONAL','Bread and Pastry Production NC II'),('VOCATIONAL','Food and Beverage Services NC II'),
       ('COLLEGE','BS Hotel and Restaurant Management'),('COLLEGE','BS Business Administration'),
       ('COLLEGE','BS Education'),('ELEMENTARY','Elementary Graduate')]
RELATION = ['Mother','Father','Spouse','Sister','Brother','Aunt','Uncle','Cousin','Guardian']
NETWORKS = ['Globe','Smart','DITO','TNT']

def phone():
    return f"09{random.choice('1789')}{random.randint(0,9)} {random.randint(100,999)} {random.randint(1000,9999)}"

def iso(d): return d.isoformat()

branches = req('GET', '/api/admin/branches')
positions = {p['name']: p['id'] for p in req('GET', '/api/admin/positions')}
existing = req('GET', '/api/admin/employees')
print(f'  {len(branches)} branches, {len(positions)} positions, {len(existing)} employees already')

# Roughly how a bakery staffs up: one manager per branch, then floor staff.
POS_MIX = (['Baker'] * 5 + ['Frontliner'] * 5 + ['Cashier'] * 3 + ['Helper'] * 3 + ['Driver'])

used_names = {(e['firstName'], e['lastName']) for e in existing}
created = []
# Already at the roster size: only refresh the 201 details below.
target = 0 if len(existing) >= 76 else 70
attempts = 0
while len(created) < target and attempts < 2000:
    attempts += 1
    female = random.random() < 0.62      # bakery floors here skew female
    first = random.choice(GIVEN_F if female else GIVEN_M)
    last = random.choice(SUR)
    if (first, last) in used_names:
        continue
    used_names.add((first, last))
    n = len(created)
    branch = branches[n % len(branches)]
    # One manager per branch, the rest spread across the floor roles.
    role = 'Manager' if n < len(branches) else random.choice(POS_MIX)
    if role not in positions:
        role = 'Baker'
    emp = req('POST', '/api/admin/employees', {
        'firstName': first,
        'middleName': random.choice(MIDDLE),
        'lastName': last,
        'employeeCode': f'EMP-{len(existing) + len(created) + 1:03d}',
        'positionId': positions[role],
        'branchId': branch['id'],
        'isActive': True,
    })
    created.append(emp)
    if len(created) % 10 == 0:
        print(f'  created {len(created)}/{target}')

print(f'  created {len(created)} new employees')

# ---- 201 details for everyone, new and existing
everyone = req('GET', '/api/admin/employees')
print(f'  filling 201 details for {len(everyone)}')

for i, e in enumerate(everyone):
    female = e['firstName'] in GIVEN_F
    born = date(random.randint(1975, 2006), random.randint(1, 12), random.randint(1, 28))

    # Spread hire dates, and put a handful inside the last month so the
    # "under one month" eligibility flag has something to show.
    if i % 12 == 0:
        hired = TODAY - timedelta(days=random.randint(3, 27))
    else:
        hired = TODAY - timedelta(days=random.randint(40, 3600))

    probationary = (TODAY - hired).days < 180
    married = random.random() < 0.45 and (TODAY - born).days > 365 * 24

    contacts = [{'number': phone(), 'label': random.choice(NETWORKS)}]
    if random.random() < 0.4:
        contacts.append({'number': phone(), 'label': random.choice(NETWORKS)})

    edu_level, edu_detail = random.choice(EDU)
    body = {
        'birthDate': iso(born),
        'birthPlace': f'{random.choice(BARANGAY)}, Davao City',
        'gender': 'FEMALE' if female else 'MALE',
        'civilStatus': 'MARRIED' if married else random.choice(['SINGLE', 'SINGLE', 'WIDOWED', 'SEPARATED']),
        'religion': random.choice(RELIGION),
        'email': f"{e['firstName'].lower()}.{e['lastName'].split()[-1].lower()}{i}@example.com",
        'heightCm': random.randint(148, 178) if female else random.randint(158, 186),
        'weightGrams': random.randint(45000, 78000) if female else random.randint(55000, 92000),
        'educationLevel': edu_level,
        'educationDetail': edu_detail,
        'address': f'{random.randint(1, 350)} {random.choice(STREET)}, {random.choice(BARANGAY)}, Davao City',
        'contacts': contacts,
        'emergencyName': f'{random.choice(GIVEN_F + GIVEN_M)} {e["lastName"]}',
        'emergencyRelation': random.choice(RELATION),
        'emergencyContact': phone(),
        'sssNumber': f'{random.randint(2,34)}-{random.randint(1000000,9999999)}-{random.randint(0,9)}',
        'philhealthNumber': f'{random.randint(10,19)}-{random.randint(100000000,999999999)}-{random.randint(0,9)}',
        'pagibigNumber': f'{random.randint(1000,9999)}-{random.randint(1000,9999)}-{random.randint(1000,9999)}',
        'tin': f'{random.randint(100,999)}-{random.randint(100,999)}-{random.randint(100,999)}-000',
        'dateHired': iso(hired),
        'employmentType': 'PROBATIONARY' if probationary else 'REGULAR',
        'payoutMethod': random.choice(['CASH', 'CASH', 'CASH', 'BANK', 'EWALLET']),
    }
    if probationary:
        body['probationEndDate'] = iso(hired + timedelta(days=180))
        # A few had probation extended, with the reason the record needs.
        if random.random() < 0.15:
            body['probationExtendedTo'] = iso(hired + timedelta(days=240))
            body['probationExtensionReason'] = random.choice([
                'Two months more — uniform and hygiene standards.',
                'Extended after repeated lateness in August.',
                'Needs more time on the closing routine.',
            ])
    else:
        body['regularizedAt'] = iso(hired + timedelta(days=180))

    # Paperwork: most signed, some outstanding, which is the realistic state.
    if random.random() < 0.85:
        body['confidentialityAgreementOn'] = iso(hired + timedelta(days=random.randint(0, 14)))
    if random.random() < 0.8:
        body['authorityToDeductOn'] = iso(hired + timedelta(days=random.randint(0, 14)))
    if random.random() < 0.75:
        body['birthCertificateOn'] = iso(hired + timedelta(days=random.randint(0, 30)))
    if married and random.random() < 0.7:
        body['marriageContractOn'] = iso(hired + timedelta(days=random.randint(0, 60)))
    if random.random() < 0.2:
        body['remarks'] = random.choice([
            'Transferred from Matina branch.',
            'Requested permanent morning shift — childcare.',
            'Trained on the new oven.',
            'Prefers not to be scheduled on Sundays.',
            'Covers for other branches when short.',
        ])
    req('PATCH', f"/api/admin/employees/{e['id']}/hr", body)
    if (i + 1) % 20 == 0:
        print(f'  details {i + 1}/{len(everyone)}')

print(f'  done: {len(everyone)} employees with 201 details')
