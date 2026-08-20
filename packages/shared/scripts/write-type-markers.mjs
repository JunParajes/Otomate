// Both builds emit .js files, so Node needs a per-directory marker to know which
// module system each one is. Without these, dist/esm/*.js would be parsed as
// CommonJS by any consumer that respects package.json#type.
import { writeFileSync } from 'node:fs'

writeFileSync('dist/cjs/package.json', JSON.stringify({ type: 'commonjs' }, null, 2) + '\n')
writeFileSync('dist/esm/package.json', JSON.stringify({ type: 'module' }, null, 2) + '\n')

console.log('wrote dist/{cjs,esm}/package.json type markers')
