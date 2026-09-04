import { createTheme, type CSSVariablesResolver, type MantineColorsTuple } from '@mantine/core'

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
    /*
     * `withBorder` resolves to --mantine-color-gray-3 directly rather than to
     * --mantine-color-default-border, so overriding the shared token alone left
     * cards on the old, fainter edge. Pointed at the same token as everything
     * else so a card's edge and an input's edge cannot drift apart.
     */
    Card: { styles: { root: { borderColor: 'var(--mantine-color-default-border)' } } },
  },
})

/**
 * Light mode gets the same two cues dark mode already had.
 *
 * A card was separated from the page by ONE thing in light mode: a 1px #dee2e6
 * border at 1.30:1. The card and the page were both pure white, so there was no
 * fill difference at all — measured at 1.00:1. Dark mode meanwhile had two cues,
 * a card lighter than the page (1.14:1) AND a border, which is why the sectioning
 * read clearly there and vanished in light. On the 201 file, which is seven
 * stacked cards, that is the difference between seeing groups and seeing a wall.
 *
 * The fix is the conventional one: tint the canvas, leave the cards white. That
 * mirrors dark mode's relationship — the card is the lighter surface, so it
 * still reads as raised — rather than greying the cards, which would make them
 * read as disabled.
 *
 * Set here rather than in a stylesheet so every card on every page gets it at
 * once. The same problem existed on Branches, Roles and the DSIR pages; fixing
 * one screen would have left the app inconsistent with itself.
 */
export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {},
  light: {
    /*
     * gray.1 as the canvas, cards stay white above it. Chosen by arithmetic
     * rather than taste: dark mode separates card from page at 1.14:1, and
     * white-on-#f1f3f5 is 1.13:1. gray.0 (#f8f9fa) only reached 1.05:1, which
     * is visible on a good monitor and not on a tablet in a bakery.
     */
    '--mantine-color-body': '#f1f3f5',
    // Inputs, dividers and the sticky section rule all read from this. A step
    // darker keeps them legible now that they sit on a tinted ground.
    '--mantine-color-default-border': '#ced4da',
  },
  dark: {},
})
