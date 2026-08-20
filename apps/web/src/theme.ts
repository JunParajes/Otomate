import { createTheme, type MantineColorsTuple } from '@mantine/core'

// Warm amber — reads as "bakery" without being twee, and stays legible on
// white cards at the shades Mantine uses for filled buttons (6) and hover (7).
const crust: MantineColorsTuple = [
  '#fff8e1',
  '#ffecb5',
  '#ffdf85',
  '#ffd254',
  '#ffc62e',
  '#ffbf1a',
  '#ffbb0c',
  '#e3a400',
  '#ca9100',
  '#af7c00',
]

export const theme = createTheme({
  primaryColor: 'crust',
  primaryShade: { light: 7, dark: 5 },
  colors: { crust },
  defaultRadius: 'md',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  headings: { fontWeight: '650' },
  components: {
    // Admin screens are dense and form-heavy — larger default hit targets.
    TextInput: { defaultProps: { size: 'md' } },
    PasswordInput: { defaultProps: { size: 'md' } },
    Button: { defaultProps: { size: 'md' } },
  },
})
