import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Anchor, Button, Group, Modal, Select, Stack, Text, TextInput,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconArchive, IconFileText, IconPlus } from '@tabler/icons-react'
import { dsirApi } from '@/lib/dsir'
import { adminApi } from '@/lib/admin'
import { useResource } from '@/hooks/useResource'
import { useSession } from '@/lib/session'
import PageHeader from '@/components/PageHeader'
import DataState from '@/components/DataState'
import DsirReportTable from '@/components/DsirReportTable'

const today = () => new Date().toISOString().slice(0, 10)

export default function DsirListPage() {
  const navigate = useNavigate()
  const { can } = useSession()
  const [branchFilter, setBranchFilter] = useState<string | null>(null)
  // Drafts only. This page is the encoder's work queue, and a finished report
  // has no business sitting in it — finalising moves it to the archive.
  const reports = useResource(
    () => dsirApi.list({ branchId: branchFilter, status: 'DRAFT' }),
    [branchFilter]
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

  return (
    <>
      <PageHeader
        title="Daily Reports"
        description="Reports still being encoded. Finalising one files it under its branch."
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

      <Group mb="md" gap="sm" wrap="wrap" justify="space-between">
        <Select
          placeholder="All branches"
          data={branchOptions}
          value={branchFilter}
          onChange={setBranchFilter}
          clearable
          w={{ base: '100%', xs: 200 }}
        />
        <Anchor component={Link} to="/dsir/archive" size="sm">
          <Group gap={6} wrap="nowrap">
            <IconArchive size={16} />
            <span>Finalised reports</span>
          </Group>
        </Anchor>
      </Group>

      <DataState
        loading={reports.loading}
        error={reports.error}
        empty={reports.data?.length === 0}
        emptyMessage="Nothing in progress — every report is finalised, or there are none yet"
      >
        <DsirReportTable reports={reports.data ?? []} showStatus={false} />
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
