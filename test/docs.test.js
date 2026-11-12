import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// VERIFY.md is the record of what really ran. README, DEVPOST and the in-app Sandbox evidence panel repeat its
// status lines; these tests fail when one of them claims more (or less) than VERIFY says, instead of leaving an
// old status in a judge-facing page (REVIEW_4 E4).

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
const ids = (text) => [...text.matchAll(/\bV(\d+)b?\b/g)].map((m) => `V${m[1]}`)
const NOT_DONE = new Set(['SKIPPED', 'NOT RUN', 'SYNTHETIC PASS'])

function verifyStatuses() {
  const out = new Map()
  for (const line of read('VERIFY.md').split('\n')) {
    if (!/^\| V\d+ \|/.test(line)) continue
    const cells = line.split('|').map((c) => c.trim())
    const status = cells.at(-2).match(/^(SYNTHETIC PASS|NOT RUN|PARTIAL|SKIPPED|PASS)\b/)
    assert.ok(status, `VERIFY ${cells[1]} result starts with a status word`)
    out.set(cells[1], status[1])
  }
  return out
}

function section(text, heading) {
  const start = text.indexOf(heading)
  assert.ok(start >= 0, `section "${heading}"`)
  const next = text.indexOf('\n## ', start + heading.length)
  return text.slice(start, next < 0 ? undefined : next)
}

const bullet = (text, prefix) => {
  const line = text.split('\n').find((l) => l.startsWith(prefix))
  assert.ok(line, `line starting "${prefix}"`)
  return line
}

const STATUS = verifyStatuses()
const notDone = [...STATUS].filter(([, s]) => NOT_DONE.has(s)).map(([id]) => id)

test('verify_has_every_row_once_with_a_status', () => {
  for (let n = 1; n <= 15; n++) assert.ok(STATUS.has(`V${n}`), `V${n} row`)
})

test('readme_sandbox_evidence_matches_verify', () => {
  const s = section(read('README.md'), '## Sandbox evidence')
  for (const id of ids(bullet(s, '- PASS against the PayPal sandbox'))) assert.ok(['PASS', 'PARTIAL'].includes(STATUS.get(id)), `README PASS list: ${id} is ${STATUS.get(id)}`)
  for (const id of ids(bullet(s, '- PARTIAL'))) assert.equal(STATUS.get(id), 'PARTIAL', `README PARTIAL list: ${id}`)
  for (const id of ids(bullet(s, '- PASS with the real model'))) assert.equal(STATUS.get(id), 'PASS', `README model list: ${id}`)
  assert.deepEqual(ids(bullet(s, '- Not run')).sort(), [...notDone].sort(), 'README "Not run" names exactly the rows VERIFY has not passed')
})

test('devpost_proven_list_matches_verify', () => {
  const s = section(read('DEVPOST.md'), '## Proven in the PayPal sandbox')
  const sandbox = bullet(s, '- **PayPal sandbox:**')
  for (const m of sandbox.matchAll(/\((V\d+)(, partial)?\)/g)) assert.equal(STATUS.get(m[1]), m[2] ? 'PARTIAL' : 'PASS', `DEVPOST sandbox ${m[0]}`)
  for (const m of bullet(s, '- **Real model**').matchAll(/\((V\d+)(, synthetic only)?\)/g)) assert.equal(STATUS.get(m[1]), m[2] ? 'SYNTHETIC PASS' : 'PASS', `DEVPOST model ${m[0]}`)
  const blocked = ids(bullet(s, '- **Not run or blocked:**'))
  for (const id of notDone) assert.ok(blocked.includes(id), `DEVPOST "Not run or blocked" names ${id}`)
})

test('in_app_sandbox_evidence_matches_verify', () => {
  const src = read('client/src/components/SandboxEvidence.jsx')
  const list = (name) => ids(src.slice(src.indexOf(`export const ${name}`), src.indexOf(']', src.indexOf(`export const ${name}`))).match(/id: 'V\d+b?'/g).join(' '))
  for (const id of list('SANDBOX_PASS')) assert.ok(['PASS', 'PARTIAL'].includes(STATUS.get(id)), `app PASS list: ${id}`)
  for (const id of list('SANDBOX_PARTIAL')) assert.equal(STATUS.get(id), 'PARTIAL', `app PARTIAL list: ${id}`)
  for (const id of list('MODEL_PASS')) assert.equal(STATUS.get(id), 'PASS', `app model list: ${id}`)
  const notRun = src.split('\n').find((l) => l.includes('Not run yet'))
  assert.deepEqual(ids(notRun).sort(), [...notDone].sort(), 'app "Not run yet" names exactly the rows VERIFY has not passed')
})

test('hosting_status_is_the_same_everywhere', () => {
  const hosting = section(read('VERIFY.md'), '## Hosting')
  const result = bullet(hosting, '- **Result:')
  const [, status, url] = result.match(/Result: (PASS|FAIL|NOT RUN)[^*]*\*\* (https:\/\/\S+?) /) || []
  assert.equal(status, 'PASS', 'VERIFY hosting result')
  const mode = result.match(/Mode: ([^.]+)\./)[1]
  for (const file of ['README.md', 'DEVPOST.md']) {
    const tryIt = bullet(read(file), '**Try it:**')
    assert.ok(tryIt.includes(url), `${file} "Try it" points at the verified host ${url}`)
    assert.ok(tryIt.includes(mode), `${file} "Try it" describes the host as VERIFY does: "${mode}"`)
  }
})

test('docs_do_not_hard_code_a_test_count', () => {
  const count = /\b\d+\s+(?:automated\s+|unit\s+)?tests?\s+(?:pass|passing)\b|\btests?\s*[:=]\s*\d+\b/
  for (const file of ['README.md', 'DEVPOST.md', 'VERIFY.md']) {
    const hit = read(file).split('\n').find((line) => count.test(line))
    assert.equal(hit, undefined, `${file} hard-codes a test count: ${hit}`)
  }
})
