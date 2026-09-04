"""
The parsers, checked against the shapes actually found in the spreadsheet.

    /tmp/201-venv/bin/python scripts/import-201/test_parsers.py

No spreadsheet needed — every case here is a literal, so this runs anywhere and
carries no personal data. These parsers decide what a person's hire date and
height become in a real record, and "Rehired 07/24/2025" quietly turning into
the wrong day is not the kind of mistake that announces itself. Hence the
impossible cases: a month of 13 must be REFUSED, not silently read as a day.
"""
import datetime
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from read_sheet import (  # noqa: E402
    parse_date, parse_education, parse_height_cm, parse_phone, parse_weight_grams,
    split_suffix,
)

D = datetime.date

DATES = [
    ('07/24/2025', D(2025, 7, 24)),
    # A date wearing a word. Fourteen of these, and the date in them is good.
    ('Rehired 07/24/2025', D(2025, 7, 24)),
    ('REHIRED 08/09/2026', D(2026, 8, 9)),
    ('Offially in LDB 10/01/2025', D(2025, 10, 1)),
    ('01/ 26/2026', D(2026, 1, 26)),
    ('12/31/25', D(2025, 12, 31)),
    # Words with no date in them at all.
    ('Cancel', None), ('Refresh', None), ('N/A', None),
    # MM/DD only. A 13th month is a mistake in the sheet, and reading it as a
    # day would invent a date that looks perfectly reasonable.
    ('13/05/2025', None),
    ('02/30/2026', None),
    # Two dates is a question, not an answer.
    ('to 05/01/2025 or 06/01/2025', None),
]

PHONES = [
    # Excel ate the leading zero off anything numeric. This is the common case.
    ('9171234567', '09171234567'), (9171234567, '09171234567'),
    ('0917 123 4567', '09171234567'), ('+639171234567', '09171234567'),
    ('N/A', None), ('12345', None), ('', None),
]

HEIGHTS = [("5'7", 170), ("5'11", 180), ("6'0", 183), ("5;7", 170),
           ("5'13", None), ('N/A', None)]

WEIGHTS = [('62.5', 62500), ('45', 45000), ('62.5 kg', 62500),
           ('5', None), ('999', None), ('N/A', None)]

EDUCATION = [
    ('High School Graduate', 'HIGH_SCHOOL', None),
    ('High Scool Graduate', 'HIGH_SCHOOL', None),
    ('HighSchool', 'HIGH_SCHOOL', None),
    # "Secondary" is the Philippine word for high school.
    ('Secondary_High School', 'HIGH_SCHOOL', None),
    # "Km12" is a mangled K-12 — Grade 12, so Senior High. NOT the KM 12 branch.
    ('Km12 Graduate', 'SENIOR_HIGH', None),
    ('K-12 with NCII Food Beverage', 'SENIOR_HIGH', 'NCII FOOD BEVERAGE'),
    ('Senior High School (TVL)', 'SENIOR_HIGH', 'TVL'),
    ('College Level', 'COLLEGE', None),
    ('BSED-Graduate', 'COLLEGE', None),
    ('NC2 Graduate/Driving', 'VOCATIONAL', 'DRIVING'),
    ('Elementary Graduate', 'ELEMENTARY', None),
    ('nonsense qualification', None, None),
]


SUFFIXES = [
    # The sheet has one Surname column, so the suffix rides along in it.
    ('Cruz Jr.', 'Cruz', 'Jr.'),
    ('Cruz Jr', 'Cruz', 'Jr.'),
    ('Cruz Jr,', 'Cruz', 'Jr.'),       # a stray comma, normalised
    ('Bautista Sr.', 'Bautista', 'Sr.'),
    ('Reyes III', 'Reyes', 'III'),
    # Twice it landed in the first name instead.
    ('Juan Jr.', 'Juan', 'Jr.'),
    # THE CASES THAT MUST NOT MOVE. Real two-word surnames, and second given
    # names — sixty-odd of the latter. Splitting on "the last word" would
    # mangle all of them to fix nine.
    ('Dela Pena', 'Dela Pena', None),
    ('Dela Torre', 'Dela Torre', None),
    ('San Juan', 'San Juan', None),
    ('De Luis', 'De Luis', None),
    ('Maria Mae', 'Maria Mae', None),
    ('Jane Ann', 'Jane Ann', None),
    ('Mary Joy', 'Mary Joy', None),
    ('Cruz', 'Cruz', None),
    (None, None, None),
]


def main():
    failures = []

    def check(label, got, want):
        if got != want:
            failures.append(f'{label}: got {got!r}, wanted {want!r}')

    for text, want in DATES:
        check(f'date {text!r}', parse_date(text, 1, 'hired', [], []), want)
    for text, want in PHONES:
        check(f'phone {text!r}', parse_phone(text, 1, 'phone', []), want)
    for text, want in HEIGHTS:
        check(f'height {text!r}', parse_height_cm(text, 1, []), want)
    for text, want in WEIGHTS:
        check(f'weight {text!r}', parse_weight_grams(text, 1, []), want)
    for text, name, suffix in SUFFIXES:
        got_name, got_suffix = split_suffix(text)
        check(f'suffix name {text!r}', got_name, name)
        check(f'suffix value {text!r}', got_suffix, suffix)
    for text, level, detail in EDUCATION:
        got_level, got_detail = parse_education(text, 1, [])
        check(f'education level {text!r}', got_level, level)
        check(f'education detail {text!r}', got_detail, detail)

    total = (len(DATES) + len(PHONES) + len(HEIGHTS) + len(WEIGHTS)
             + 2 * len(EDUCATION) + 2 * len(SUFFIXES))
    if failures:
        print(f'{len(failures)} of {total} checks FAILED\n')
        for f in failures:
            print(f'  {f}')
        return 1
    print(f'all {total} checks pass')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
