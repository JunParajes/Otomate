import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ActionIcon, Alert, Badge, Button, Card, Center, Divider, Grid, Group, Loader, Select,
  Stack, Table, Text, TextInput, Textarea, Title, Tooltip,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { modals } from '@mantine/modals'
import { IconAlertTriangle, IconArrowLeft, IconCheck, IconPlus, IconTrash } from '@tabler/icons-react'
import {
  CIVIL_STATUSES, CIVIL_STATUS_LABELS,
  GENDERS, GENDER_LABELS,
  EDUCATION_LEVELS, EDUCATION_LEVEL_LABELS,
  EMPLOYMENT_TYPES, EMPLOYMENT_TYPE_LABELS,
  PAYOUT_METHODS, PAYOUT_METHOD_LABELS,
  SALARY_RATE_TYPES, SALARY_RATE_LABELS,
  CONTACT_LABEL_SUGGESTIONS,
  POSITION_LABELS,
  ageOn, cmToFeetInches, currentSalary, feetInchesToCm, formatLengthOfService, formatMoney,
  lengthOfService, probationStatus,
  type CivilStatus, type EducationLevel, type Employee, type EmploymentType, type Gender,
  type PayoutMethod,
  type SalaryRateType, type UpdateEmployeeHrInput,
} from '@otomate/shared'
import { employeeApi } from '@/lib/employees'
import { useSession } from '@/lib/session'
import MoneyInput from '@/components/MoneyInput'
import StickyActionBar, { pageWithActionBar } from '@/components/StickyActionBar'
import classes from './EmployeeDetailPage.module.css'

/**
 * The section index, in the order the sections appear. Kept beside the markup
 * rather than derived from it: an anchor that silently stops matching a section
 * id would scroll nowhere and look like nothing happened.
 */
const SECTIONS = [
  { id: 'personal', label: 'Personal' },
  { id: 'contact', label: 'Contact' },
  { id: 'emergency', label: 'Emergency' },
  { id: 'employment', label: 'Employment' },
  { id: 'gov-ids', label: 'Gov IDs' },
  { id: 'documents', label: 'Documents' },
  { id: 'pay', label: 'Pay' },
] as const

/**
 * One titled card per section.
 *
 * The whole 201 file used to sit in a single card split by dividers, which read
 * as one unbroken wall of about thirty-five fields — dividers separate, but they
 * do not group. A card per section gives each group its own edge, so "where does
 * Personal end and Contact begin" is answerable at a glance.
 */
function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <Card withBorder padding="lg" radius="md" id={id} className={classes.section}>
      <Stack gap="md">
        <Title order={5}>{title}</Title>
        {children}
      </Stack>
    </Card>
  )
}

/**
 * Every field starts as a string so an empty box round-trips as "not set".
 *
 * `contacts` is excluded: it is a list, held in its own state, and mapping it to
 * a string here would be a lie the compiler would happily accept.
 */
type HrForm = {
  [K in Exclude<keyof UpdateEmployeeHrInput, 'contacts'>]-?: string
}

/** A stable string for "is this the same as what was saved". */
function snapshot(form: HrForm, contacts: { number: string; label: string }[]): string {
  return JSON.stringify([form, contacts.filter(c => c.number.trim() !== '')])
}

function toForm(e: Employee): HrForm {
  const hr = e.hr
  return {
    birthDate: hr?.birthDate ?? '',
    birthPlace: hr?.birthPlace ?? '',
    gender: hr?.gender ?? '',
    civilStatus: hr?.civilStatus ?? '',
    religion: hr?.religion ?? '',
    email: hr?.email ?? '',
    heightCm: hr?.heightCm != null ? String(hr.heightCm) : '',
    // Stored in grams, typed and read in kilos — the same pesos/centavos split
    // the money fields use, for the same reason: no float reaches the database.
    weightGrams: hr?.weightGrams != null ? String(hr.weightGrams / 1000) : '',
    educationLevel: hr?.educationLevel ?? '',
    educationDetail: hr?.educationDetail ?? '',
    remarks: hr?.remarks ?? '',
    confidentialityAgreementOn: hr?.confidentialityAgreementOn ?? '',
    authorityToDeductOn: hr?.authorityToDeductOn ?? '',
    birthCertificateOn: hr?.birthCertificateOn ?? '',
    marriageContractOn: hr?.marriageContractOn ?? '',
    address: hr?.address ?? '',
    emergencyName: hr?.emergencyName ?? '',
    emergencyRelation: hr?.emergencyRelation ?? '',
    emergencyContact: hr?.emergencyContact ?? '',
    sssNumber: hr?.sssNumber ?? '',
    philhealthNumber: hr?.philhealthNumber ?? '',
    pagibigNumber: hr?.pagibigNumber ?? '',
    tin: hr?.tin ?? '',
    dateHired: hr?.dateHired ?? '',
    employmentType: hr?.employmentType ?? 'PROBATIONARY',
    probationEndDate: hr?.probationEndDate ?? '',
    probationExtendedTo: hr?.probationExtendedTo ?? '',
    probationExtensionReason: hr?.probationExtensionReason ?? '',
    regularizedAt: hr?.regularizedAt ?? '',
    separatedAt: hr?.separatedAt ?? '',
    separationReason: hr?.separationReason ?? '',
    payoutMethod: hr?.payoutMethod ?? 'CASH',
    payoutAccount: hr?.payoutAccount ?? '',
  }
}

/**
 * One employee: the 201 file, and pay.
 *
 * A route rather than a modal. It started as one, which was wrong for a record
 * this size — it needs to be linkable (from a probation alert, a payslip, the
 * charges ledger in 5b), printable for a COE, and closable with the browser's
 * back gesture, which a modal breaks on a tablet. The app already treats a DSIR
 * report the same way at /dsir/:id, and an employee record carries at least as
 * much.
 *
 * It is separate from the Edit form because the two answer to different
 * permissions: adding staff is an everyday branch task, government IDs and
 * salary are not.
 */
export default function EmployeeDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setEmployee(await employeeApi.get(id))
      setLoadError(null)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load this employee')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { void load() }, [load])

  // Warn before losing a half-typed record. Same guard as the DSIR page, and for
  // the same reason: this is twenty-odd fields transcribed from paper, and
  // closing the tab should not throw them away silently. Covers reload and tab
  // close only — in-app navigation is why the bar shows "Unsaved changes".
  useEffect(() => {
    if (!dirtyRef.current) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  })

  const onSaved = (updated: Employee) => setEmployee(updated)
  const { can } = useSession()
  const canWriteHr = can('hr:write')
  const canSeeSalary = can('hr:salary:read')
  const canWriteSalary = can('hr:salary:write')

  const [form, setForm] = useState<HrForm | null>(null)
  /**
   * Phone numbers, held apart from the flat 201 form because they are a list.
   * A blank row is how you add one — no "add" button to find, which matters on
   * a tablet.
   */
  const [contacts, setContacts] = useState<{ number: string; label: string }[]>([])
  /**
   * What the record looked like when it loaded or was last saved. Compared
   * against the live form to decide whether anything is actually unsaved —
   * tracking a boolean on every keystroke would call a field typed and retyped
   * back to its original value "changed".
   */
  const [saved, setSaved] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  /** Read by the beforeunload guard, which is declared before `dirty` exists. */
  const dirtyRef = useRef(false)
  const [saving, setSaving] = useState(false)

  // New-rate fields, kept apart from the 201 form: they post to a different
  // endpoint and must not be swept into a Save of the rest.
  const [basicCents, setBasicCents] = useState<number | null>(null)
  const [allowanceCents, setAllowanceCents] = useState<number | null>(null)
  const [rateType, setRateType] = useState<SalaryRateType>('DAILY')
  const [effectiveFrom, setEffectiveFrom] = useState('')
  const [rateNote, setRateNote] = useState('')
  const [addingRate, setAddingRate] = useState(false)

  useEffect(() => {
    setForm(employee ? toForm(employee) : null)
    const nextContacts = (employee?.hr?.contacts ?? []).map(c => ({ number: c.number, label: c.label ?? '' }))
    setContacts(nextContacts)
    setSaved(employee ? snapshot(toForm(employee), nextContacts) : null)
    setBasicCents(null)
    setAllowanceCents(null)
    setRateType('DAILY')
    setEffectiveFrom('')
    setRateNote('')
    setAddingRate(false)
  }, [employee?.id])

  if (loading) return <Center py="xl"><Loader /></Center>
  if (loadError || !employee || !form) {
    return (
      <Stack gap="md">
        <Group gap="sm">
          <ActionIcon variant="subtle" color="gray" onClick={() => navigate('/admin/employees')} aria-label="Back">
            <IconArrowLeft size={18} />
          </ActionIcon>
          <Title order={2} size="h4">Employee</Title>
        </Group>
        <Alert color="red" title="Could not load">{loadError ?? 'That employee does not exist.'}</Alert>
      </Stack>
    )
  }

  const set = (key: keyof HrForm) => (value: string) => setForm(f => (f ? { ...f, [key]: value } : f))
  const field = (key: keyof HrForm) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(key)(e.currentTarget.value),
    disabled: !canWriteHr,
  })

  // Derived, never stored — see ageOn/lengthOfService. Computed from the field
  // as it is being typed, so the answer appears while the date is entered.
  const age = ageOn(form.birthDate || null)
  const tenure = lengthOfService(form.dateHired || null, form.separatedAt || null)
  /**
   * Height is entered in feet and inches and stored in centimetres, so the two
   * boxes are derived from the stored value rather than being form state of
   * their own. One source of truth: typing in either box recomputes the
   * centimetres, and nothing can drift.
   */
  const heightFtIn = cmToFeetInches(form.heightCm ? Number(form.heightCm) : null)
  const setHeight = (feet: number, inches: number) => {
    // Both boxes empty means "not recorded", not a height of zero.
    if (!feet && !inches) return set('heightCm')('')
    set('heightCm')(String(feetInchesToCm(feet, inches)))
  }

  const probation = probationStatus({
    employmentType: form.employmentType as EmploymentType,
    probationEndDate: form.probationEndDate || null,
    probationExtendedTo: form.probationExtendedTo || null,
    separatedAt: form.separatedAt || null,
    isActive: employee.isActive,
  })

  async function save() {
    if (!form || !employee) return
    setSaving(true)
    try {
      // '' means "not set" — sent as null so clearing a field actually clears it.
      const payload = Object.fromEntries(
        Object.entries(form).map(([k, v]) => [k, v === '' ? null : v])
      ) as UpdateEmployeeHrInput
      // These two are enums with a default and are never null.
      payload.employmentType = form.employmentType as EmploymentType
      payload.payoutMethod = form.payoutMethod as PayoutMethod
      // Height and weight are numbers, not text. Everything else in the form is
      // a string, so these two have to be converted back explicitly — and weight
      // is typed in kilos but stored in grams.
      const toWhole = (raw: string, scale = 1): number | null => {
        const n = Number(raw.trim())
        return raw.trim() !== '' && Number.isFinite(n) ? Math.round(n * scale) : null
      }
      payload.heightCm = toWhole(form.heightCm)
      payload.weightGrams = toWhole(form.weightGrams, 1000)
      // Blank rows are how the UI offers "add another"; they are not data.
      payload.contacts = contacts
        .filter(c => c.number.trim() !== '')
        .map(c => ({ number: c.number.trim(), label: c.label.trim() || null }))

      const updated = await employeeApi.updateHr(employee.id, payload)
      onSaved(updated)
      setSaved(snapshot(form, contacts))
      setSavedAt(new Date())
      notifications.show({ color: 'green', title: 'Saved', message: `${employee.name}'s record updated` })
    } catch (e) {
      notifications.show({
        color: 'red',
        title: 'Could not save',
        message: e instanceof Error ? e.message : 'Something went wrong',
      })
    } finally {
      setSaving(false)
    }
  }

  async function addRate() {
    if (!employee || basicCents === null || !effectiveFrom) return
    setAddingRate(true)
    try {
      const updated = await employeeApi.setSalary(employee.id, {
        basicCents,
        allowanceCents: allowanceCents ?? 0,
        rateType,
        effectiveFrom,
        note: rateNote.trim() || null,
      })
      onSaved(updated)
      setBasicCents(null)
      setAllowanceCents(null)
      setEffectiveFrom('')
      setRateNote('')
      notifications.show({ color: 'green', title: 'Pay rate recorded', message: `Effective ${effectiveFrom}` })
    } catch (e) {
      notifications.show({
        color: 'red',
        title: 'Could not record the rate',
        message: e instanceof Error ? e.message : 'Something went wrong',
      })
    } finally {
      setAddingRate(false)
    }
  }

  function confirmRemoveRate(salaryId: string, from: string) {
    if (!employee) return
    modals.openConfirmModal({
      title: 'Remove this pay rate?',
      children: (
        <Text size="sm">
          The rate effective {from} will be deleted. Use this only for a rate entered
          by mistake — correcting an amount is done by re-entering the same start date.
        </Text>
      ),
      labels: { confirm: 'Remove', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: () => void employeeApi
        .removeSalary(employee.id, salaryId)
        .then(onSaved)
        .catch((e: unknown) => notifications.show({
          color: 'red',
          title: 'Could not remove',
          message: e instanceof Error ? e.message : 'Something went wrong',
        })),
    })
  }

  const history = employee.salaryHistory ?? []
  const current = currentSalary(history)

  const dirty = saved !== null && saved !== snapshot(form, contacts)
  dirtyRef.current = dirty

  return (
    <Stack gap="md" className={canWriteHr ? pageWithActionBar : undefined}>
      <Group gap="sm" wrap="nowrap">
        <ActionIcon variant="subtle" color="gray" onClick={() => navigate('/admin/employees')} aria-label="Back to employees">
          <IconArrowLeft size={18} />
        </ActionIcon>
        <Stack gap={2} style={{ minWidth: 0 }}>
          <Group gap="xs" wrap="nowrap">
            <Title order={2} size="h4">{employee.name}</Title>
            <Badge variant="light" color={employee.isActive ? 'green' : 'gray'}>
              {employee.isActive ? 'Active' : 'Inactive'}
            </Badge>
          </Group>
          <Text size="sm" c="dimmed">
            {[POSITION_LABELS[employee.position], employee.branch?.name ?? 'Unassigned'].join(' · ')}
          </Text>
        </Stack>
      </Group>

      {/*
        A section index. The 201 file runs to about thirty-five fields, which on
        a tablet is a lot of scrolling to reach the pay rate. Anchors rather than
        tabs: everything stays on one page, so one Save still covers the whole
        record and the unsaved-changes guard keeps working.

        It sits OUTSIDE the Card deliberately — Mantine's Card sets
        `overflow: hidden`, and an overflow-clipped ancestor silently disables
        position: sticky on everything inside it.
      */}
      <Group gap={6} className={classes.sectionNav}>
        {SECTIONS.map(sec => (
          <Button
            key={sec.id}
            variant="default"
            size="compact-xs"
            onClick={() => document.getElementById(sec.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          >
            {sec.label}
          </Button>
        ))}
      </Group>

      {probation.state !== 'none' && (
        <Alert
          color={probation.state === 'overdue' ? 'red' : 'orange'}
          icon={<IconAlertTriangle size={18} />}
        >
          {probation.state === 'overdue'
            ? `Probation ended ${Math.abs(probation.daysLeft ?? 0)} day(s) ago and this record is still probationary. ` +
              'Staff not acted on by the deadline become regular by operation of law.'
            : `Probation ends in ${probation.daysLeft} day(s). Decide before the deadline — ` +
              'after it, regularisation happens whether or not it was intended.'}
        </Alert>
      )}

        {/*
          Section order follows the paper form HR transcribes from: who they are,
          how to reach them, who to call in an emergency, their terms, their ID
          numbers, their paperwork, then pay. Fields are grouped by the question
          they answer rather than by when they were added to the app.
        */}
        <Section id="personal" title="Personal">
          <Grid gap="sm">
            <Grid.Col span={{ base: 8, sm: 3 }}>
              <TextInput label="Date of birth" type="date" {...field('birthDate')} />
            </Grid.Col>
            {/*
              Age is its own read-only box rather than a line of description text
              under the date.

              A Mantine `description` renders BETWEEN the label and the input, so
              the single field carrying one sits lower than everything else on
              the row — the date box no longer lined up with birth place, gender
              or civil status beside it.

              Still derived on every render from the date next to it: never
              stored, never editable, and skipped in the tab order so it does not
              interrupt someone tabbing through the form.
            */}
            <Grid.Col span={{ base: 4, sm: 1 }}>
              <TextInput
                label="Age"
                readOnly
                tabIndex={-1}
                variant="filled"
                placeholder="—"
                value={age !== null ? String(age) : ''}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 3 }}>
              <TextInput label="Birth place" placeholder="Davao City" {...field('birthPlace')} />
            </Grid.Col>
            {/* Narrower than the rest: it holds "Male" or "Female", nothing longer. */}
            <Grid.Col span={{ base: 12, sm: 2 }}>
              <Select
                label="Gender"
                data={GENDERS.map(g => ({ value: g, label: GENDER_LABELS[g] }))}
                value={form.gender || null}
                onChange={v => set('gender')((v as Gender) ?? '')}
                disabled={!canWriteHr}
                clearable
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 3 }}>
              <Select
                label="Civil status"
                data={CIVIL_STATUSES.map(c => ({ value: c, label: CIVIL_STATUS_LABELS[c] }))}
                value={form.civilStatus || null}
                onChange={v => set('civilStatus')((v as CivilStatus) ?? '')}
                disabled={!canWriteHr}
                clearable
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 4 }}>
              <TextInput label="Religion" {...field('religion')} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 4 }}>
              <Select
                label="Educational attainment"
                data={EDUCATION_LEVELS.map(l => ({ value: l, label: EDUCATION_LEVEL_LABELS[l] }))}
                value={form.educationLevel || null}
                onChange={v => set('educationLevel')((v as EducationLevel) ?? '')}
                disabled={!canWriteHr}
                clearable
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 4 }}>
              <TextInput
                label="Course or strand"
                placeholder="BS Hotel and Restaurant Management"
                {...field('educationDetail')}
              />
            </Grid.Col>
            {/*
              Feet and inches, because that is how height is said here — nobody
              reports "170 centimetres". Two number boxes rather than a text box
              parsing 5'7": a numeric keypad on a tablet beats reaching for the
              apostrophe and quote marks, and there is nothing to mis-parse.

              Centimetres remain what is STORED, and are shown read-only beside
              them so the conversion is visible rather than a black box. The
              round trip is lossless for whole inches — see the height helpers.
            */}
            <Grid.Col span={{ base: 3, sm: 2 }}>
              <TextInput
                label="Height"
                type="number"
                inputMode="numeric"
                min={0}
                placeholder="5"
                rightSection={<Text size="xs" c="dimmed">ft</Text>}
                value={heightFtIn ? String(heightFtIn.feet) : ''}
                disabled={!canWriteHr}
                onChange={e => {
                  const feet = Number(e.currentTarget.value)
                  setHeight(Number.isFinite(feet) ? feet : 0, heightFtIn?.inches ?? 0)
                }}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 3, sm: 2 }}>
              <TextInput
                label="&nbsp;"
                aria-label="Height in inches"
                type="number"
                inputMode="numeric"
                min={0}
                max={11}
                placeholder="7"
                rightSection={<Text size="xs" c="dimmed">in</Text>}
                value={heightFtIn ? String(heightFtIn.inches) : ''}
                disabled={!canWriteHr}
                onChange={e => {
                  const inches = Number(e.currentTarget.value)
                  setHeight(heightFtIn?.feet ?? 0, Number.isFinite(inches) ? inches : 0)
                }}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 6, sm: 2 }}>
              <TextInput
                label="&nbsp;"
                aria-label="Height in centimetres"
                readOnly
                tabIndex={-1}
                variant="filled"
                placeholder="—"
                rightSection={<Text size="xs" c="dimmed">cm</Text>}
                value={form.heightCm || ''}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 6, sm: 3 }}>
              <TextInput
                label="Weight"
                type="number"
                inputMode="decimal"
                step="0.1"
                placeholder="62.5"
                rightSection={<Text size="xs" c="dimmed">kg</Text>}
                {...field('weightGrams')}
              />
            </Grid.Col>
          </Grid>
        </Section>

        {/*
          Contacts, email and address together: they answer one question, and the
          email used to sit three rows below the address for no reason other than
          the order the fields were built in.
        */}
        <Section id="contact" title="How to reach them">
          <Grid gap="sm">
            <Grid.Col span={{ base: 12, sm: 6 }}>
            <Stack gap={6}>
              <Text size="sm" fw={500}>
                Contact numbers
                <Text component="span" size="xs" c="dimmed"> — dual SIM is common; note the network</Text>
              </Text>
              {[...contacts, { number: '', label: '' }].map((c, i) => (
                <Group key={i} gap="xs" wrap="nowrap" align="flex-start">
                  <TextInput
                    aria-label={i < contacts.length ? `Contact number ${i + 1}` : 'Add a contact number'}
                    placeholder="0917 555 1234"
                    style={{ flex: 2 }}
                    value={c.number}
                    disabled={!canWriteHr}
                    onChange={e => {
                      const next = [...contacts]
                      const value = e.currentTarget.value
                      // Typing in the trailing blank row turns it into a real one.
                      if (i === contacts.length) next.push({ number: value, label: '' })
                      else next[i] = { ...next[i]!, number: value }
                      setContacts(next)
                    }}
                  />
                  <TextInput
                    aria-label={`Network for contact ${i + 1}`}
                    placeholder="Network"
                    list="contact-labels"
                    style={{ flex: 1 }}
                    value={c.label}
                    disabled={!canWriteHr || i === contacts.length}
                    onChange={e => {
                      const next = [...contacts]
                      next[i] = { ...next[i]!, label: e.currentTarget.value }
                      setContacts(next)
                    }}
                  />
                  {canWriteHr && i < contacts.length && (
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      mt={4}
                      aria-label={`Remove contact number ${i + 1}`}
                      onClick={() => setContacts(contacts.filter((_, j) => j !== i))}
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  )}
                </Group>
              ))}
              <datalist id="contact-labels">
                {CONTACT_LABEL_SUGGESTIONS.map(n => <option key={n} value={n} />)}
              </datalist>
            </Stack>
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6 }}>
              <Stack gap="sm">
                <TextInput label="Email address" type="email" placeholder="name@example.com" {...field('email')} />
                <Textarea label="Address" autosize minRows={3} {...field('address')} />
              </Stack>
            </Grid.Col>
          </Grid>
        </Section>

        <Section id="emergency" title="In an emergency">
          <Grid gap="sm">
            <Grid.Col span={{ base: 12, sm: 4 }}>
              <TextInput label="Emergency contact" {...field('emergencyName')} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 4 }}>
              <TextInput label="Relationship" {...field('emergencyRelation')} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 4 }}>
              <TextInput label="Their number" {...field('emergencyContact')} />
            </Grid.Col>
          </Grid>
        </Section>

        <Section id="employment" title="Employment">
          <Grid gap="sm">
            <Grid.Col span={{ base: 8, sm: 3 }}>
              <TextInput label="Date hired" type="date" {...field('dateHired')} />
            </Grid.Col>
            {/* Derived like Age, and read-only for the same reason — see the note there. */}
            <Grid.Col span={{ base: 4, sm: 3 }}>
              <TextInput
                label="Length of service"
                readOnly
                tabIndex={-1}
                variant="filled"
                placeholder="—"
                value={tenure ? formatLengthOfService(tenure) : ''}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 3 }}>
              <Select
                label="Employment type"
                data={EMPLOYMENT_TYPES.map(t => ({ value: t, label: EMPLOYMENT_TYPE_LABELS[t] }))}
                value={form.employmentType}
                onChange={v => set('employmentType')(v ?? 'PROBATIONARY')}
                disabled={!canWriteHr}
                allowDeselect={false}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 3 }}>
              <TextInput label="Probation ends" type="date" {...field('probationEndDate')} />
            </Grid.Col>
          </Grid>

          {/*
            A Grid of its own, not more columns in the one above.

            "Why it was extended" only renders when there is an extension, and in
            a single flowing Grid its absence let the following fields ride up
            into this row and pushed "Reason for leaving" onto a line by itself.
            One Grid per visual row means the layout cannot depend on whether a
            conditional field happens to be showing.
          */}
          <Grid gap="sm">
            <Grid.Col span={{ base: 12, sm: 3 }}>
              <TextInput label="Probation extended to" type="date" {...field('probationExtendedTo')} />
            </Grid.Col>
            {/*
              Shown only once an extension exists. An extension is a decision
              about someone's job, and a date with no reason beside it is
              unusable at the review — but the box has no business cluttering
              the form for the majority who were never extended.
            */}
            {form.probationExtendedTo && (
              <Grid.Col span={{ base: 12, sm: 9 }}>
                <TextInput
                  label="Why it was extended"
                  placeholder="What has to improve, and by when"
                  {...field('probationExtensionReason')}
                />
              </Grid.Col>
            )}
          </Grid>

          <Grid gap="sm">
            <Grid.Col span={{ base: 12, sm: 3 }}>
              <TextInput label="Regularised on" type="date" {...field('regularizedAt')} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 3 }}>
              <TextInput label="Separated on" type="date" {...field('separatedAt')} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6 }}>
              <TextInput label="Reason for leaving" {...field('separationReason')} />
            </Grid.Col>
          </Grid>
          {/*
            The guidance that used to sit under two of these fields as
            `description` text. It was pushing those inputs a row-height below
            their neighbours, which reads as a broken layout rather than as
            help. Same information, one place, nothing knocked out of line.
          */}
          <Text size="xs" c="dimmed">
            Probation caps at six months by law. Fill in "Probation extended to" only if that
            deadline was formally moved — the original date stays as it was, so the record still
            shows what was first agreed.
          </Text>
        </Section>

        <Section id="gov-ids" title="Government IDs">
          <Grid gap="sm">
            <Grid.Col span={{ base: 12, sm: 3 }}>
              <TextInput label="SSS" placeholder="34-1234567-8" {...field('sssNumber')} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 3 }}>
              <TextInput label="PhilHealth" {...field('philhealthNumber')} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 3 }}>
              <TextInput label="Pag-IBIG" {...field('pagibigNumber')} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 3 }}>
              <TextInput label="TIN" {...field('tin')} />
            </Grid.Col>
          </Grid>
        </Section>

        {/*
          Held as dates rather than ticks. A tick tells you nothing a year later;
          the date answers "signed under which contract?" and still reads as
          "yes" simply by being filled in.
        */}
        <Section id="documents" title="Documents & notes">
          <Grid gap="sm">
            <Grid.Col span={{ base: 12, sm: 3 }}>
              <TextInput
                label="Confidentiality agreement"
                type="date"
                description="Date signed"
                {...field('confidentialityAgreementOn')}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 3 }}>
              <TextInput
                label="Authority to deduct"
                type="date"
                description="Date signed"
                {...field('authorityToDeductOn')}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 3 }}>
              <TextInput
                label="Birth certificate"
                type="date"
                description="Date received"
                {...field('birthCertificateOn')}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 3 }}>
              <TextInput
                label="Marriage contract"
                type="date"
                description="Date received"
                {...field('marriageContractOn')}
              />
            </Grid.Col>
            <Grid.Col span={12}>
              <Textarea
                label="Remarks"
                description="Anything else worth knowing about this record"
                autosize
                minRows={2}
                {...field('remarks')}
              />
            </Grid.Col>
          </Grid>
        </Section>

        <Section id="pay" title="How they are paid">
          <Grid gap="sm">
            <Grid.Col span={{ base: 12, sm: 4 }}>
              <Select
                label="Payout method"
                data={PAYOUT_METHODS.map(m => ({ value: m, label: PAYOUT_METHOD_LABELS[m] }))}
                value={form.payoutMethod}
                onChange={v => set('payoutMethod')(v ?? 'CASH')}
                disabled={!canWriteHr}
                allowDeselect={false}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 8 }}>
              <TextInput label="Account" {...field('payoutAccount')} />
            </Grid.Col>
          </Grid>
          <Text size="xs" c="dimmed">
            Account is their bank account or e-wallet number, and is only needed if they are not
            paid in cash.
          </Text>
        </Section>

        {canSeeSalary && (
          <Section id="pay-rate" title="Pay rate">
            {current ? (
              <Group gap="xs">
                <Text size="sm">Currently</Text>
                <Text size="sm" fw={700}>{formatMoney(current.basicCents)}</Text>
                <Text size="sm" c="dimmed">{SALARY_RATE_LABELS[current.rateType]}</Text>
                {current.allowanceCents > 0 && (
                  <Text size="sm" c="dimmed">+ {formatMoney(current.allowanceCents)} allowance</Text>
                )}
                <Badge size="sm" variant="light">since {current.effectiveFrom}</Badge>
              </Group>
            ) : (
              <Text size="sm" c="dimmed">No pay rate recorded yet.</Text>
            )}

            {history.length > 0 && (
              <Table.ScrollContainer minWidth={520}>
                <Table verticalSpacing="xs" striped="odd">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th w={120}>From</Table.Th>
                      <Table.Th w={130}>Basic</Table.Th>
                      <Table.Th w={130}>Allowance</Table.Th>
                      <Table.Th>Note</Table.Th>
                      {canWriteSalary && <Table.Th w={50} />}
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {history.map(s => (
                      <Table.Tr key={s.id}>
                        <Table.Td><Text size="sm" ff="monospace">{s.effectiveFrom}</Text></Table.Td>
                        <Table.Td>
                          <Text size="sm">{formatMoney(s.basicCents)}</Text>
                          <Text size="xs" c="dimmed">{SALARY_RATE_LABELS[s.rateType]}</Text>
                        </Table.Td>
                        <Table.Td><Text size="sm">{formatMoney(s.allowanceCents)}</Text></Table.Td>
                        <Table.Td>
                          <Text size="xs" c="dimmed">
                            {s.note}
                            {s.recordedBy && (s.note ? ` — ${s.recordedBy.name}` : s.recordedBy.name)}
                          </Text>
                        </Table.Td>
                        {canWriteSalary && (
                          <Table.Td>
                            <Tooltip label="Remove — for a rate entered by mistake" withArrow>
                              <Button
                                variant="subtle"
                                color="red"
                                size="compact-xs"
                                onClick={() => confirmRemoveRate(s.id, s.effectiveFrom)}
                                aria-label={`Remove the rate effective ${s.effectiveFrom}`}
                              >
                                <IconTrash size={14} />
                              </Button>
                            </Tooltip>
                          </Table.Td>
                        )}
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            )}

            {canWriteSalary && (
              <Grid gap="sm" align="flex-end">
                <Grid.Col span={{ base: 12, sm: 3 }}>
                  <MoneyInput label="Basic" value={basicCents} onChange={setBasicCents} />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 3 }}>
                  <MoneyInput label="Allowance" value={allowanceCents} onChange={setAllowanceCents} />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 2 }}>
                  <Select
                    label="Per"
                    data={SALARY_RATE_TYPES.map(r => ({ value: r, label: SALARY_RATE_LABELS[r] }))}
                    value={rateType}
                    onChange={v => setRateType((v as SalaryRateType) ?? 'DAILY')}
                    allowDeselect={false}
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 2 }}>
                  <TextInput
                    label="Effective from"
                    type="date"
                    value={effectiveFrom}
                    onChange={e => setEffectiveFrom(e.currentTarget.value)}
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 2 }}>
                  <Button
                    fullWidth
                    leftSection={<IconPlus size={16} />}
                    disabled={basicCents === null || basicCents <= 0 || !effectiveFrom}
                    loading={addingRate}
                    onClick={() => void addRate()}
                  >
                    Add
                  </Button>
                </Grid.Col>
                <Grid.Col span={12}>
                  <TextInput
                    label="Why it changed"
                    placeholder="Regularised, annual increase, promoted…"
                    value={rateNote}
                    onChange={e => setRateNote(e.currentTarget.value)}
                  />
                </Grid.Col>
              </Grid>
            )}
            <Text size="xs" c="dimmed">
              Rates are kept as history. A new rate never rewrites an old one, so past
              payroll keeps the figure it was actually computed on.
            </Text>
          </Section>
        )}

      {canWriteHr && (
        <StickyActionBar
          status={
            dirty ? (
              <Text size="sm" c="orange">Unsaved changes</Text>
            ) : savedAt ? (
              <Group gap={4} wrap="nowrap">
                <IconCheck size={14} color="var(--mantine-color-green-6)" />
                <Text size="sm" c="dimmed">
                  Saved {savedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </Group>
            ) : (
              <Text size="sm" c="dimmed">No changes yet</Text>
            )
          }
        >
          <Button variant="default" onClick={() => navigate('/admin/employees')}>Back</Button>
          <Button loading={saving} disabled={!dirty} onClick={() => void save()}>
            Save record
          </Button>
        </StickyActionBar>
      )}
    </Stack>
  )
}
