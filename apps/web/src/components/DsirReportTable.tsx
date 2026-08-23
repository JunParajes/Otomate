import { useNavigate } from 'react-router-dom'
import { Badge, Table, Text, Tooltip } from '@mantine/core'
import { IconAlertTriangle } from '@tabler/icons-react'
import { formatMoney, type DsirSummary } from '@otomate/shared'

interface Props {
  reports: DsirSummary[]
  /** Off inside a single branch's archive, where every row is the same branch. */
  showBranch?: boolean
  /** Off in the archive, where every row is finalised by definition. */
  showStatus?: boolean
}

function Variance({ cents }: { cents: number }) {
  if (cents === 0) return <Text size="sm" c="dimmed">—</Text>
  const short = cents < 0
  return (
    <Text size="sm" fw={500} c={short ? 'red' : 'green'}>
      {short ? '' : '+'}{formatMoney(cents)}
    </Text>
  )
}

/**
 * Shared by the working list and the archive so the two cannot drift into
 * showing the same figures differently.
 */
export default function DsirReportTable({ reports, showBranch = true, showStatus = true }: Props) {
  const navigate = useNavigate()

  return (
    <Table.ScrollContainer minWidth={showBranch ? 880 : 760}>
      <Table highlightOnHover verticalSpacing="sm" striped="odd">
        <Table.Thead>
          <Table.Tr>
            <Table.Th w={120}>Date</Table.Th>
            {showBranch && <Table.Th>Branch</Table.Th>}
            {showStatus && <Table.Th w={110}>Status</Table.Th>}
            <Table.Th w={90}>Products</Table.Th>
            <Table.Th w={130}>Sales</Table.Th>
            <Table.Th w={130}>Collected</Table.Th>
            <Table.Th w={130}>Variance</Table.Th>
            <Table.Th w={110}>Over end</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {reports.map(r => (
            <Table.Tr key={r.id} onClick={() => navigate(`/dsir/${r.id}`)} style={{ cursor: 'pointer' }}>
              <Table.Td><Text fw={500} ff="monospace">{r.reportDate}</Text></Table.Td>
              {showBranch && <Table.Td>{r.branch.name}</Table.Td>}
              {showStatus && (
                <Table.Td>
                  <Badge variant="light" color={r.status === 'FINALIZED' ? 'green' : 'yellow'}>
                    {r.status === 'FINALIZED' ? 'Finalised' : 'Draft'}
                  </Badge>
                </Table.Td>
              )}
              <Table.Td><Text size="sm" c="dimmed">{r.lineCount}</Text></Table.Td>
              <Table.Td><Text size="sm" fw={500}>{formatMoney(r.salesCents)}</Text></Table.Td>
              <Table.Td><Text size="sm">{formatMoney(r.collectionsCents)}</Text></Table.Td>
              <Table.Td>
                <Tooltip
                  label="Collections minus derived sales. A shortage is deducted from staff."
                  disabled={r.varianceCents === 0}
                >
                  <span><Variance cents={r.varianceCents} /></span>
                </Tooltip>
              </Table.Td>
              <Table.Td>
                {r.overEndUnits > 0 ? (
                  <Tooltip label={`${r.overEndUnits} units found beyond what the books allow — worth explaining`}>
                    <Badge color="red" variant="light" leftSection={<IconAlertTriangle size={10} />}>
                      {formatMoney(r.overEndCents)}
                    </Badge>
                  </Tooltip>
                ) : (
                  <Text size="sm" c="dimmed">—</Text>
                )}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  )
}
