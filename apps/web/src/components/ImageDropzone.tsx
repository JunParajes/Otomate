import { ActionIcon, Box, Group, Image, Paper, Stack, Text, Tooltip } from '@mantine/core'
import { Dropzone, IMAGE_MIME_TYPE } from '@mantine/dropzone'
import { IconPhoto, IconTrash, IconUpload, IconX } from '@tabler/icons-react'

const MAX_BYTES = 8 * 1024 * 1024

interface Props {
  /** Existing stored image, if any. */
  imageUrl: string | null
  /** Locally chosen file not yet uploaded. */
  pending: File | null
  onSelect: (file: File | null) => void
  onRemoveExisting?: () => void
  disabled?: boolean
}

export default function ImageDropzone({
  imageUrl,
  pending,
  onSelect,
  onRemoveExisting,
  disabled,
}: Props) {
  const preview = pending ? URL.createObjectURL(pending) : imageUrl

  if (preview) {
    return (
      <Paper withBorder radius="md" p="xs">
        <Group wrap="nowrap" align="flex-start">
          <Image src={preview} alt="Product" w={120} h={120} fit="cover" radius="sm" />
          <Stack gap={4} style={{ flex: 1 }}>
            <Text size="sm" fw={500}>
              {pending ? pending.name : 'Current image'}
            </Text>
            <Text size="xs" c="dimmed">
              {pending
                ? `${(pending.size / 1024).toFixed(0)} KB — uploaded when you save`
                : 'Stored on the server'}
            </Text>
            <Group gap="xs" mt={4}>
              <Tooltip label="Choose a different image">
                <ActionIcon
                  variant="light"
                  disabled={disabled}
                  onClick={() => document.getElementById('image-repick')?.click()}
                >
                  <IconUpload size={16} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="Remove image">
                <ActionIcon
                  variant="light"
                  color="red"
                  disabled={disabled}
                  onClick={() => (pending ? onSelect(null) : onRemoveExisting?.())}
                >
                  <IconTrash size={16} />
                </ActionIcon>
              </Tooltip>
            </Group>
          </Stack>
        </Group>
        <input
          id="image-repick"
          type="file"
          accept="image/*"
          hidden
          onChange={e => onSelect(e.currentTarget.files?.[0] ?? null)}
        />
      </Paper>
    )
  }

  return (
    <Dropzone
      onDrop={files => onSelect(files[0] ?? null)}
      accept={IMAGE_MIME_TYPE}
      maxSize={MAX_BYTES}
      maxFiles={1}
      disabled={disabled}
      radius="md"
    >
      <Group justify="center" gap="md" mih={110} style={{ pointerEvents: 'none' }}>
        <Dropzone.Accept>
          <IconUpload size={32} stroke={1.5} />
        </Dropzone.Accept>
        <Dropzone.Reject>
          <IconX size={32} stroke={1.5} />
        </Dropzone.Reject>
        <Dropzone.Idle>
          <IconPhoto size={32} stroke={1.5} opacity={0.5} />
        </Dropzone.Idle>
        <Box>
          <Text size="sm" fw={500}>
            Drop a photo here, or click to choose
          </Text>
          <Text size="xs" c="dimmed" mt={2}>
            {/* Say what happens, so an 8MB phone photo isn't a surprise */}
            JPEG, PNG or WebP up to 8 MB. Resized automatically.
          </Text>
        </Box>
      </Group>
    </Dropzone>
  )
}
