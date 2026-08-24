import { ActionIcon, Menu, Text } from '@mantine/core'
import { IconChevronDown, IconCopy, IconEraser } from '@tabler/icons-react'

/** The editable quantity columns a bulk action can target. */
export type QtyColumn = 'begBal' | 'produced' | 'overEnd' | 'pulledOut' | 'endBal'

interface Props {
  label: string
  column: QtyColumn
  /** The other editable columns currently on the form, for "copy from". */
  sources: { column: QtyColumn; label: string }[]
  onClear: (column: QtyColumn) => void
  onCopy: (from: QtyColumn, to: QtyColumn) => void
}

/**
 * Bulk actions on a whole column, from its heading.
 *
 * Typing the same figure down fifty rows, or zeroing a column that was ticked
 * by mistake, was previously one cell at a time. Both live here rather than in a
 * toolbar because the column being acted on is then unambiguous.
 */
export default function ColumnMenu({ label, column, sources, onClear, onCopy }: Props) {
  return (
    <Menu position="bottom-end" withArrow shadow="md" width={210}>
      <Menu.Target>
        <ActionIcon
          variant="subtle"
          color="gray"
          size="xs"
          aria-label={`Actions for the ${label} column`}
          // Never a tab stop: the encoder tabs across hundreds of cells and must
          // not land on a menu between them.
          tabIndex={-1}
        >
          <IconChevronDown size={12} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>{label}</Menu.Label>
        <Menu.Item leftSection={<IconEraser size={14} />} onClick={() => onClear(column)}>
          Set every row to 0
        </Menu.Item>
        {sources.length > 0 && (
          <>
            <Menu.Divider />
            <Menu.Label>Copy into {label} from</Menu.Label>
            {sources.map(s => (
              <Menu.Item
                key={s.column}
                leftSection={<IconCopy size={14} />}
                onClick={() => onCopy(s.column, column)}
              >
                <Text size="sm">{s.label}</Text>
              </Menu.Item>
            ))}
          </>
        )}
      </Menu.Dropdown>
    </Menu>
  )
}
