"""
How the 201 spreadsheet's words become Otomate's values.

Kept apart from the reader so the rules can be read, argued with and corrected
without going near the parsing. Every entry here came from looking at the actual
distinct values in the sheet and asking; none of it is guessed.

Anything NOT listed here is deliberately left empty for a human rather than
approximated. A wrong value that looks right is worse than a blank: the blank
gets filled in, the wrong one gets believed.
"""

# ─── Branches ────────────────────────────────────────────────────────────────
# The sheet spells these many ways. The values on the right are the branch names
# as they exist in Otomate; the keys are lowercased and stripped before lookup.
#
# "L3" is Landmark 3 and "TRD Puan" is Telredough Bread House in Puan — the
# short forms are what the branches are actually called, so they stay the
# display names and the long forms are aliases, not the other way round.
BRANCHES = {
    'bankerohan': 'Bankerohan', 'bangkerohan': 'Bankerohan',
    'bunawan': 'Bunawan', 'bun': 'Bunawan',
    'commissary': 'Commissary', 'commisary': 'Commissary',
    'km11': 'KM 11', 'km 11': 'KM 11',
    'km12': 'KM 12', 'km 12': 'KM 12',
    'l3': 'L3', 'landmark 3': 'L3',
    'maa': 'Maa',
    'office': 'Office',
    'pampanga': 'Pampanga', 'pam': 'Pampanga', 'pampnga': 'Pampanga',
    'panacan': 'Panacan',
    'sasa': 'Sasa',
    'trd': 'TRD Puan', 'puan': 'TRD Puan', 'trd puan': 'TRD Puan',
}

# Cells naming two branches, or a status instead of a place. Left for a human:
# "Km 11, Sasa" is a person who works across both and the sheet cannot say which
# is home, which is exactly the judgement not to automate.
BRANCH_UNRESOLVED = {'km 11, sasa', 'km 11 sasa', 'pam/ commisary', 'extra', 'awol'}

# ─── Gender / civil status ───────────────────────────────────────────────────
GENDER = {'m': 'MALE', 'f': 'FEMALE'}
CIVIL_STATUS = {
    'single': 'SINGLE',
    'married': 'MARRIED', 'maried': 'MARRIED',
    'widowed': 'WIDOWED', 'separated': 'SEPARATED',
}

# ─── Employment type, from "Employee Status" (column R) ──────────────────────
# Typos included on purpose: they are in the file, and a person who was plainly
# meant to be probationary should not import as nothing because of one letter.
EMPLOYMENT_TYPE = {
    'probationary': 'PROBATIONARY', 'probitionary': 'PROBATIONARY',
    'probtionary': 'PROBATIONARY',
    'regular': 'REGULAR', 'regural': 'REGULAR',
    'extra': 'PART_TIME', 'extra/ on call': 'PART_TIME',
}

# Values in that column that describe how somebody LEFT rather than what they
# were. They set no employment type; they corroborate the separation instead.
EXIT_WORDS = {'awol', 'resigned', 'end', 'end?', 'rehired'}

# ─── Active / separated, from "Employee Status 2" (column W) ─────────────────
# True  = still employed, False = separated, None = cannot tell, leave for a human.
ACTIVE = {
    'active': True,
    'not active': False, 'awol': False, 'awol?': False, 'awol/': False,
    'end': False, 'resigned': False, 'resigned/awol': False,
    'extra': None,
}

# The reason, in the words the business already uses. AWOL is not a tidy
# category but it is the true one, and it is 100+ of these people.
SEPARATION_REASON = {
    'awol': 'AWOL', 'awol?': 'AWOL', 'awol/': 'AWOL',
    'resigned': 'Resigned', 'resigned/awol': 'Resigned / AWOL',
    'end': 'End of contract', 'not active': None,
}

# ─── Paperwork ──────────────────────────────────────────────────────────────
# The sheet answers "do we have it?", never "since when?". So these map to a
# status and the date stays empty — see the schema note on document status.
DOCUMENT_STATUS = {
    'done': 'ON_FILE', 'yes': 'ON_FILE',
    'no': 'MISSING', 'negative': 'MISSING',
    'comply': 'MISSING', 'follow': 'MISSING',
    'n/a': 'NOT_APPLICABLE',
}
# Anything else in a document column keeps its words in Remarks and imports as
# unknown — "Yes/Not PSA" and "DON/NO ORIE" are notes, not answers.

# ─── Education ──────────────────────────────────────────────────────────────
# The level becomes the enum; whatever else the cell says becomes the detail, so
# "Senior High School (TVL)" keeps its TVL and "NC2 Graduate/Driving" keeps its
# NC2. Longest key wins, so "senior high" is not eaten by "high school".
EDUCATION_LEVELS = [
    ('post grad', 'POST_GRADUATE'), ('masteral', 'POST_GRADUATE'),
    ('senior high', 'SENIOR_HIGH'), ('seniorhigh', 'SENIOR_HIGH'),
    # K-12 completion is Grade 12 — Senior High, written in the sheet as "Km12".
    ('k-12', 'SENIOR_HIGH'), ('k12', 'SENIOR_HIGH'), ('km12', 'SENIOR_HIGH'),
    ('college', 'COLLEGE'), ('bsed', 'COLLEGE'), ('bsc', 'COLLEGE'),
    ('vocational', 'VOCATIONAL'), ('nc2', 'VOCATIONAL'), ('ncii', 'VOCATIONAL'),
    ('als', 'VOCATIONAL'),
    # "Secondary" is the Philippine term for high school.
    ('secondary', 'HIGH_SCHOOL'),
    ('high school', 'HIGH_SCHOOL'), ('high scool', 'HIGH_SCHOOL'),
    ('highschool', 'HIGH_SCHOOL'), ('high schol', 'HIGH_SCHOOL'),
    ('elementary', 'ELEMENTARY'),
]

# ─── Words meaning "we do not have this" ────────────────────────────────────
# In an ID or a date column these import as EMPTY. The word itself is kept in
# Remarks: "complying" is a task somebody was tracking, and deleting it silently
# throws away work. Empty already means "not on file" in Otomate.
NOT_A_VALUE = {
    'n/a', 'na', 'n.a.', '-', '--', 'none', 'null', 'nil', 'x',
    'comply', 'complying', 'follow', 'for follow up', 'follow up', 'pending',
    'no', 'none yet', 'wala', 'tba', '?',
}

# Companies in the sheet. Chicken and Freshness has closed — its people are not
# imported. The other three are separate sole proprietorships under one family.
COMPANIES = {
    'lemon drop bakeshop': 'Lemon Drop Bakeshop',
    'ethelredo bakeshop': 'Ethelredo Bakeshop',
    'ethelred bakeshop': 'Ethelredo Bakeshop',
    'telredough bread house': 'Telredough Bread House',
}
COMPANY_CLOSED = {'chicken and freshness'}
