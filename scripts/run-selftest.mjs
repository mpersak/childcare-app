// Runs the compiled self-test. The output is CommonJS while package.json says
// "type": "module", so the output folder gets its own package.json to say otherwise.
import { writeFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

mkdirSync('.selftest', { recursive: true })
writeFileSync('.selftest/package.json', '{"type":"commonjs"}\n')
execFileSync(process.execPath, ['.selftest/lib/selftest.js'], { stdio: 'inherit' })
