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
    //
    // Every control that sits on a row beside a TextInput belongs here. Mantine
    // defaults inputs to 'sm', so anything left out is a few pixels shorter and
    // will not line up with the field next to it — which is exactly how the
    // Employee code and Position fields ended up on different lines.
    //
    // Dense screens opt out explicitly rather than relying on the default: the
    // DSIR charge and collection rows pass size="xs", and QtyInput is a plain
    // native input, so neither is affected by anything set here.
    TextInput: { defaultProps: { size: 'md' } },
    PasswordInput: { defaultProps: { size: 'md' } },
    Select: { defaultProps: { size: 'md' } },
    NumberInput: { defaultProps: { size: 'md' } },
    Textarea: { defaultProps: { size: 'md' } },
    Button: { defaultProps: { size: 'md' } },
  },
})
