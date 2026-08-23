/**
 * Keeps the browser's `theme-color` in step with the user's chosen scheme.
 *
 * It matters most in the installed PWA: the standalone window's title bar is
 * painted from this value, so leaving it fixed gives a light title bar above a
 * dark app for anyone who has chosen dark against a light OS setting.
 *
 * The tag's initial value is set by the inline script in index.html before
 * first paint; this only handles later changes.
 */

// Mantine's body colours: --mantine-color-body is #fff in light and
// var(--mantine-color-dark-7) = #242424 in dark. Kept in step with the same
// pair hardcoded in the index.html bootstrap script.
const BODY_COLOR = { light: '#ffffff', dark: '#242424' } as const

const META_ID = 'theme-color-active'

export function syncThemeColor(scheme: 'light' | 'dark'): void {
  if (typeof document === 'undefined') return

  let meta = document.getElementById(META_ID) as HTMLMetaElement | null

  // Defensive: the tag ships in index.html, but recreating it costs nothing and
  // avoids a silent no-op if that file is ever edited.
  if (!meta) {
    meta = document.createElement('meta')
    meta.id = META_ID
    meta.name = 'theme-color'
    document.head.prepend(meta)
  }

  meta.content = BODY_COLOR[scheme]
}
