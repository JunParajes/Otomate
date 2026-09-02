import { useState } from 'react'
import { Badge, Button, Group, Modal, Stack, Table, Text, TextInput, Textarea } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconPlus } from '@tabler/icons-react'
import { useNavigate } from 'react-router-dom'
import {
  WORK_SCHEDULE_STATUS_LABELS, cutoffCode, cutoffStartFor, formatCutoff, formatCutoffLabel,
  isCutoffStart,
} from '@otomate/shared'
import { workScheduleApi } from '@/lib/work-schedule'
import { useResource } from '@/hooks/useResource'
import { useSession } from '@/lib/session'
import PageHeader from '@/components/PageHeader'
import DataState from '@/components/DataState'

const STATUS_COLOUR = { DRAFT: 'gray', SUBMITTED: 'orange', APPROVED: 'green' } as const

/**
 * The cutoffs, newest first.
 *
 * A cutoff runs Thursday to Wednesday — the payroll week, not a convention worth
 * tidying. The date field only accepts a Thursday, and offers the right one
 * rather than making anyone count backwards.
 */
export default function WorkSchedulesPage() {
  const { can } = useSession()
  const navigate = useNavigate()
  const schedules = useResource(workScheduleApi.list)
  const [creating, setCreating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [weekStart, setWeekStart] = useState('')
  const [notes, setNotes] = useState('')

  const canWrite = can('schedule:write')
  // The Thursday of the cutoff we are in now — the one being planned, nine times
  // out of ten.
  const thisCutoff = cutoffStartFor(new Date().toISOString().slice(0, 10)) ?? ''
  const chosen = weekStart || thisCutoff
  const valid = isCutoffStart(chosen)

  async function create() {
    setSaving(true)
    try {
      const made = await workScheduleApi.create({ weekStart: chosen, notes: notes.trim() || null })
      notifications.show({ color: 'green', title: 'Schedule started', message: formatCutoffLabel(made.weekStart) })
      setCreating(false)
      navigate(`/hr/work-schedule/${made.id}`)
    } catch (e) {
      notifications.show({
        color: 'red',
        title: 'Could not start it',
        message: e instanceof Error ? e.message : 'Something went wrong',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Work schedule"
        description="The plan for each cutoff — Thursday to Wednesday. What actually happened is recorded separately."
        action={
          canWrite && (
            <Button
              leftSection={<IconPlus size={16} />}
              onClick={() => { setWeekStart(thisCutoff); setNotes(''); setCreating(true) }}
            >
              Start a cutoff
            </Button>
          )
        }
      />

      <DataState
        loading={schedules.loading}
        error={schedules.error}
        empty={schedules.data?.length === 0}
        emptyMessage="No schedules yet — start one for this cutoff"
      >
        <Table.ScrollContainer minWidth={620}>
          <Table highlightOnHover verticalSpacing="sm" striped="odd">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Cutoff</Table.Th>
                <Table.Th w={150}>Status</Table.Th>
                <Table.Th w={160}>Drafted by</Table.Th>
                <Table.Th w={160}>Approved by</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(schedules.data ?? []).map(s => (
                <Table.Tr
                  key={s.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/hr/work-schedule/${s.id}`)}
                >
                  <Table.Td>
                    <Group gap="xs" wrap="nowrap">
                      <Badge variant="light" color="blue">{cutoffCode(s.weekStart)}</Badge>
                      <Text fw={500}>{formatCutoff(s.weekStart)}</Text>
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <Badge variant="light" color={STATUS_COLOUR[s.status]}>
                      {WORK_SCHEDULE_STATUS_LABELS[s.status]}
                    </Badge>
                  </Table.Td>
                  <Table.Td><Text size="sm" c="dimmed">{s.createdBy?.name ?? '—'}</Text></Table.Td>
                  <Table.Td><Text size="sm" c="dimmed">{s.approvedBy?.name ?? '—'}</Text></Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </DataState>

      <Modal opened={creating} onClose={() => setCreating(false)} title="Start a cutoff" centered>
        <Stack gap="md">
          <TextInput
            label="Cutoff starts"
            type="date"
            description={
              valid
                ? `${cutoffCode(chosen)} — ${formatCutoff(chosen)}`
                : 'A cutoff starts on a Thursday'
            }
            error={!valid && chosen ? 'Pick a Thursday' : undefined}
            value={chosen}
            onChange={e => setWeekStart(e.currentTarget.value)}
          />
          <Textarea
            label="Notes"
            placeholder="Optional — anything the approver should know"
            autosize
            minRows={2}
            value={notes}
            onChange={e => setNotes(e.currentTarget.value)}
          />
          <Text size="xs" c="dimmed">
            Everyone active starts as scheduled on all seven days. Mark only the exceptions —
            days off, no-schedule days, and anyone sent to another branch.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setCreating(false)}>Cancel</Button>
            <Button onClick={() => void create()} loading={saving} disabled={!valid}>
              Start
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  )
}
