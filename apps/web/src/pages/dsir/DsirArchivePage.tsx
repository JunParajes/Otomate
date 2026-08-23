import { Link, useNavigate } from 'react-router-dom'
import { Anchor, Badge, Card, Group, SimpleGrid, Text, Stack } from '@mantine/core'
import { IconBuildingStore, IconChevronRight, IconClipboardList } from '@tabler/icons-react'
import { dsirApi } from '@/lib/dsir'
import { useResource } from '@/hooks/useResource'
import PageHeader from '@/components/PageHeader'
import DataState from '@/components/DataState'

/** "2026-08-23" → "23 Aug 2026", without pulling in a date library. */
function prettyDate(iso: string | null): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${Number(d)} ${months[Number(m) - 1]} ${y}`
}

/**
 * Finalised reports, filed by branch.
 *
 * They are deliberately not on the Daily Reports page: with ten branches
 * reporting every day, a single combined list buries the handful still being
 * worked on under thousands that are finished.
 */
export default function DsirArchivePage() {
  const navigate = useNavigate()
  const branches = useResource(dsirApi.archive)

  const rows = branches.data ?? []
  const total = rows.reduce((sum, b) => sum + b.finalizedCount, 0)

  return (
    <>
      <PageHeader
        title="Finalised Reports"
        description="Completed DSIRs, filed by branch. Open a branch to browse its reports by month."
      />

      <Group mb="md" gap="xs">
        <Anchor component={Link} to="/dsir" size="sm">
          <Group gap={6} wrap="nowrap">
            <IconClipboardList size={16} />
            <span>Back to reports in progress</span>
          </Group>
        </Anchor>
        {total > 0 && (
          <Text size="sm" c="dimmed">
            · {total} finalised report{total === 1 ? '' : 's'} across {rows.length} branch
            {rows.length === 1 ? '' : 'es'}
          </Text>
        )}
      </Group>

      <DataState
        loading={branches.loading}
        error={branches.error}
        empty={rows.length === 0}
        emptyMessage="No branches yet"
      >
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
          {rows.map(b => {
            const empty = b.finalizedCount === 0
            return (
              <Card
                key={b.branch.id}
                withBorder
                padding="lg"
                radius="md"
                // An empty branch is still shown — "nothing filed yet" is
                // information, and a branch missing from the page reads as a bug.
                style={{ cursor: empty ? 'default' : 'pointer', opacity: empty ? 0.6 : 1 }}
                onClick={() => !empty && navigate(`/dsir/archive/${b.branch.id}`)}
              >
                <Group justify="space-between" wrap="nowrap" align="flex-start">
                  <Group gap="sm" wrap="nowrap">
                    <IconBuildingStore size={20} stroke={1.6} />
                    <Stack gap={2}>
                      <Text fw={600}>{b.branch.name}</Text>
                      <Text size="xs" c="dimmed">
                        {empty
                          ? 'Nothing filed yet'
                          : `${prettyDate(b.earliestDate)} – ${prettyDate(b.latestDate)}`}
                      </Text>
                    </Stack>
                  </Group>
                  {!empty && <IconChevronRight size={16} opacity={0.5} />}
                </Group>

                <Group mt="md" gap="xs">
                  <Badge variant={empty ? 'default' : 'light'} color={empty ? 'gray' : 'crust'} size="lg">
                    {b.finalizedCount}
                  </Badge>
                  <Text size="sm" c="dimmed">
                    report{b.finalizedCount === 1 ? '' : 's'}
                  </Text>
                </Group>
              </Card>
            )
          })}
        </SimpleGrid>
      </DataState>
    </>
  )
}
