import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Badge, Button, Group, Modal, Select, Stack, Table, Text, TextInput, Tooltip,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconFileText, IconPlus } from '@tabler/icons-react'
import { formatMoney, type DsirSummary } from '@otomate/shared'
import { dsirApi } from '@/lib/dsir'
import { adminApi } from '@/lib/admin'
import { useResource } from '@/hooks/useResource'
import { useSession } from '@/lib/session'
import PageHeader from '@/components/PageHeader'
import DataState from '@/components/DataState'

const today = () => new Date().toISOString().slice(0, 10)

export default function DsirListPage() {
  const navigate = useNavigate()
  const { can } = useSession()
  const [branchFilter, setBranchFilter] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string | null>(null)
  const reports = useResource(
    () => dsirApi.list({ branchId: branchFilter, status: statusFilter }),
    [branchFilter, statusFilter]
  )
  const branches = useResource(adminApi.listBranches)

  const [creating, setCreating] = useState(false)
  const [newBranch, setNewBranch] = useState<string | null>(null)
  const [newDate, setNewDate] = useState(today())
  const [saving, setSaving] = useState(false)

  const canWrite = can('dsir:write')
  const branchOptions = (branches.data ?? []).map(b => ({ value: b.id, label: b.name }))

  async function create() {
    if (!newBranch) return
    setSaving(true)
    try {
      const report = await dsirApi.create({ branchId: newBranch, reportDate: newDate })
      notifications.show({ color: 'green', title: 'Report created', message: `${report.branch.name} — ${report.reportDate}` })
      navigate(`/dsir/${report.id}`)
    } catch (e) {
      notifications.show({ color: 'red', title: 'Failed', message: e instanceof Error ? e.message : 'Could not create the report' })
    } finally {
      setSaving(false)
    }
  }

  function variance(r: DsirSummary) {
    if (r.varianceCents === 0) return <Text size="sm" c="dimmed">—</Text>
    const short = r.varianceCents < 0
    return (
      <Text size="sm" fw={500} c={short ? 'red' : 'green'}>
        {short ? '' : '+'}{formatMoney(r.varianceCents)}
      </Text>
    )
  }

  return (
    <>
      <PageHeader
        title="Daily Reports"
        description="One DSIR per branch per day. Sales are derived from the stock counts, not entered."
        action={
          canWrite && (
            <Button
              leftSection={<IconPlus size={16} />}
              onClick={() => { setNewBranch(branchOptions[0]?.value ?? null); setNewDate(today()); setCreating(true) }}
            >
              New report
            </Button>
          )
        }
      />

      <Group mb="md" gap="sm" wrap="wrap">
        <Select placeholder="All branches" data={branchOptions} value={branchFilter} onChange={setBranchFilter} clearable w={{ base: '100%', xs: 200 }} />
        <Select
          placeholder="All statuses"
          data={[{ value: 'DRAFT', label: 'Draft' }, { value: 'FINALIZED', label: 'Finalised' }]}
          value={statusFilter}
          onChange={setStatusFilter}
          clearable
          w={{ base: '100%', xs: 170 }}
        />
      </Group>

      <DataState
        loading={reports.loading}
        error={reports.error}
        empty={reports.data?.length === 0}
        emptyMessage="No reports yet — create one to start encoding"
      >
        <Table.ScrollContainer minWidth={760}>
          <Table highlightOnHover verticalSpacing="sm" striped="odd">
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={120}>Date</Table.Th>
                <Table.Th>Branch</Table.Th>
                <Table.Th w={110}>Status</Table.Th>
                <Table.Th w={90}>Products</Table.Th>
                <Table.Th w={130}>Sales</Table.Th>
                <Table.Th w={130}>Collected</Table.Th>
                <Table.Th w={130}>Variance</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(reports.data ?? []).map(r => (
                <Table.Tr
                  key={r.id}
                  onClick={() => navigate(`/dsir/${r.id}`)}
                  style={{ cursor: 'pointer' }}
                >
                  <Table.Td><Text fw={500} ff="monospace">{r.reportDate}</Text></Table.Td>
                  <Table.Td>{r.branch.name}</Table.Td>
                  <Table.Td>
                    <Badge variant="light" color={r.status === 'FINALIZED' ? 'green' : 'yellow'}>
                      {r.status === 'FINALIZED' ? 'Finalised' : 'Draft'}
                    </Badge>
                  </Table.Td>
                  <Table.Td><Text size="sm" c="dimmed">{r.lineCount}</Text></Table.Td>
                  <Table.Td><Text size="sm" fw={500}>{formatMoney(r.salesCents)}</Text></Table.Td>
                  <Table.Td><Text size="sm">{formatMoney(r.collectionsCents)}</Text></Table.Td>
                  <Table.Td>
                    <Tooltip label="Collections minus derived sales. A shortage is deducted from staff." disabled={r.varianceCents === 0}>
                      <span>{variance(r)}</span>
                    </Tooltip>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </DataState>

      <Modal opened={creating} onClose={() => setCreating(false)} title="New daily report" centered>
        <Stack gap="md">
          <Select label="Branch" data={branchOptions} value={newBranch} onChange={setNewBranch} withAsterisk searchable />
          <TextInput
            label="Report date"
            type="date"
            value={newDate}
            onChange={e => setNewDate(e.currentTarget.value)}
            withAsterisk
            description="Back-dating is normal — forms reach the office days late"
          />
          <Text size="xs" c="dimmed">
            <IconFileText size={12} style={{ verticalAlign: 'middle' }} /> The form opens pre-filled with
            this branch's usual products, with opening balances carried from its last report.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setCreating(false)}>Cancel</Button>
            <Button onClick={create} loading={saving} disabled={!newBranch}>Create</Button>
          </Group>
        </Stack>
      </Modal>
    </>
  )
}
