# Icon sources

`icon.svg` and `icon-maskable.svg` are the design sources. They are deliberately
**not** in `public/` — nothing references them at runtime, and anything in
`public/` is copied into the build and served.

The PNGs in `apps/web/public/` are rendered from these:

| File | From | Notes |
|------|------|-------|
| `icon-192.png`, `icon-512.png` | `icon.svg` | rounded square, manifest `purpose: any` |
| `icon-maskable-192.png`, `icon-maskable-512.png` | `icon-maskable.svg` | full bleed; the mark sits inside the 80% safe circle because launchers crop it |
| `apple-touch-icon.png` (180) | `icon-maskable.svg` at a larger scale | full square — iOS applies its own rounding |
| `favicon.svg`, `favicon-32.png`, `favicon-16.png` | a simplified variant | two thick score marks instead of three thin ones, which turn to mush below 32px |

The mark is a scored loaf: bakers slash dough before baking, and the score marks
are what make a rounded shape read as bread rather than a generic blob. Colours
come from the `crust` amber ramp in `src/theme.ts`, so the icon and the app's
primary colour cannot drift apart.

To regenerate the PNGs, render the SVGs at the sizes in the table with any
rasteriser (`sharp`, `rsvg-convert`, Inkscape). They are committed because the
build must not depend on having one installed.
