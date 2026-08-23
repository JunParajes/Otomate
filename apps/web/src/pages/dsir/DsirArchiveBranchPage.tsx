import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Anchor, Badge, Group, Paper, ScrollArea, Text, UnstyledButton } from '@mantine/core'
import { IconArchive } from '@tabler/icons-react'
import { formatMoney } from '@otomate/shared'
import { dsirApi } from '@/lib/dsir'
import { useResource } from '@/hooks/useResource'
import PageHeader from '@/components/PageHeader'
import DataState from '@/components/DataState'
import DsirReportTable from '@/components/DsirReportTable'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-08" → "August 2026" */
function prettyMonth(month: string): string {
  const [y, m] = month.split('-')
  const full = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December']
  return `${full[Number(m) - 1]} ${y}`
}

/** Inclusive bounds for a YYYY-MM, as the list endpoint's from/to. */
function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number)
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, '0')}` }
}

/**
 * One branch's finalised reports, a month at a time.
 *
 * Scoped by month rather than listing everything: a branch reporting daily
 * produces ~365 rows a year, and the list endpoint caps at 200 — an unscoped
 * view would silently stop showing older reports, which is worse than not
 * having the page.
 */
export default function DsirArchiveBranchPage() {
  const { branchId = '' } = useParams()
  const [month, setMonth] = useState<string | null>(null)

  const archive = useResource(dsirApi.archive)
  const months = useResource(() => dsirApi.archiveMonths(branchId), [branchId])

  const branch = (archive.data ?? []).find(b => b.branch.id === branchId)
  const monthList = months.data ?? []
  // Default to the newest month that actually has reports.
  const active = month ?? monthList[0]?.month ?? null

  const reports = useResource(() => {
    if (!active) return Promise.resolve([])
    const { from, to } = monthBounds(active)
    return dsirApi.list({ branchId, status: 'FINALIZED', from, to })
  }, [branchId, active])

  const totals = useMemo(() => {
    const rows = reports.data ?? []
    return {
      count: rows.length,
      sales: rows.reduce((s, r) => s + r.salesCents, 0),
      collected: rows.reduce((s, r) => s + r.collectionsCents, 0),
      variance: rows.reduce((s, r) => s + r.varianceCents, 0),
      overEnd: rows.reduce((s, r) => s + r.overEndCents, 0),
    }
  }, [reports.data])

  return (
    <>
      <PageHeader
        title={branch?.branch.name ?? 'Branch'}
        description={
          branch
            ? `${branch.finalizedCount} finalised report${branch.finalizedCount === 1 ? '' : 's'} on file`
            : 'Finalised reports'
        }
      />

      <Group mb="md">
        <Anchor component={Link} to="/dsir/archive" size="sm">
          <Group gap={6} wrap="nowrap">
            <IconArchive size={16} />
            <span>All branches</span>
          </Group>
        </Anchor>
      </Group>

      <DataState
        loading={months.loading}
        error={months.error}
        empty={monthList.length === 0}
        emptyMessage="This branch has no finalised reports yet"
      >
        {/* Only months that actually contain reports are offered — forms arrive
            late and irregularly, so a plain date picker would mostly land on
            empty months. */}
        <ScrollArea type="auto" mb="md" offsetScrollbars>
          <Group gap="xs" wrap="nowrap">
            {monthList.map(m => (
              <UnstyledButton key={m.month} onClick={() => setMonth(m.month)}>
                <Paper
                  withBorder
                  px="md"
                  py="xs"
                  radius="md"
                  bg={m.month === active ? 'var(--mantine-color-crust-light)' : undefined}
                  style={{ whiteSpace: 'nowrap' }}
                >
                  <Group gap="xs" wrap="nowrap">
                    <Text size="sm" fw={m.month === active ? 600 : 400}>
                      {MONTHS[Number(m.month.split('-')[1]) - 1]} {m.month.split('-')[0]}
                    </Text>
                    <Badge size="sm" variant="light" color="gray">{m.count}</Badge>
                  </Group>
                </Paper>
              </UnstyledButton>
            ))}
          </Group>
        </ScrollArea>

        {active && (
          <Paper withBorder p="md" radius="md" mb="md">
            <Group justify="space-between" wrap="wrap" gap="lg">
              <Text fw={600}>{prettyMonth(active)}</Text>
              <Group gap="xl" wrap="wrap">
                <Stat label="Reports" value={String(totals.count)} />
                <Stat label="Sales" value={formatMoney(totals.sales)} />
                <Stat label="Collected" value={formatMoney(totals.collected)} />
                {/* Zero is neither an overage nor a shortage, and labelling it
                    as one reads as though something was found. */}
                <Stat
                  label={totals.variance === 0 ? 'Variance' : totals.variance < 0 ? 'Shortage' : 'Overage'}
                  value={formatMoney(Math.abs(totals.variance))}
                  colour={totals.variance === 0 ? undefined : totals.variance < 0 ? 'red' : 'green'}
                />
                {totals.overEnd > 0 && <Stat label="Over end" value={formatMoney(totals.overEnd)} colour="red" />}
              </Group>
            </Group>
          </Paper>
        )}

        <DataState
          loading={reports.loading}
          error={reports.error}
          empty={reports.data?.length === 0}
          emptyMessage="No reports in this month"
        >
          <DsirReportTable reports={reports.data ?? []} showBranch={false} showStatus={false} />
        </DataState>
      </DataState>
    </>
  )
}

function Stat({ label, value, colour }: { label: string; value: string; colour?: string }) {
  return (
    <div>
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>{label}</Text>
      <Text fw={600} c={colour}>{value}</Text>
    </div>
  )
}
