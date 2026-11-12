// Seeds photo set A (AI-generated photorealistic test images from Flow, not real photos): checks photo-sets/A, sends each zone pair through the same compareZone() the app
// uses with the local Claude Code account (Sonnet, never an API key), and records the comparison with what the
// shooter says is true in photo-sets/A/results.json. Usage: node scripts/seed-photo-set-a.js [--check] [--dir photo-sets/A]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : fallback }
const dir = path.resolve(arg('--dir', path.join(here, '..', 'photo-sets', 'A')))
const checkOnly = process.argv.includes('--check')
const write = (text) => process.stdout.write(`${text}\n`)

const { checkSetFolder, compareWithExpected } = await import('../server/vision/photoSet.js')
const { problems, files, expected } = checkSetFolder(dir)
if (problems.length) {
  write(`Photo set A is not ready (${dir}):`)
  for (const p of problems) write(`  - ${p}`)
  write('See docs/PHOTO_SET_A.md for the shooting checklist and file names.')
  process.exit(1)
}
write('Photo set A folder is complete: 12 photos and expected.json.')
if (checkOnly) process.exit(0)

process.env.LLM_BACKEND = 'account'
delete process.env.FORCE_MOCK
for (const name of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']) process.env[name] = ''
const { createAccountClient } = await import('../server/agent/accountClient.js')
const { ZONES, ZONE_IDS } = await import('../server/domain/rateCard.js')
const { compareZone } = await import('../server/vision/compare.js')
const { inspectRaster } = await import('../server/domain/rasterPhoto.js')

function loadPhoto(file) {
  const data = fs.readFileSync(file).toString('base64')
  const mediaType = /\.png$/i.test(file) ? 'image/png' : 'image/jpeg'
  return { ...inspectRaster(data, mediaType), data, sharpness: 1 }
}

const client = createAccountClient()
const rows = []
for (const zone of ZONE_IDS) {
  const photos = { before: loadPhoto(files[`${zone}:checkout`]), after: loadPhoto(files[`${zone}:return`]), closeup: files[`${zone}:closeup`] ? loadPhoto(files[`${zone}:closeup`]) : null }
  const report = await compareZone({ setId: 'REAL-A', zone, zoneLabel: ZONES[zone].label, photos, anthropic: client })
  rows.push(compareWithExpected(zone, expected[zone], report))
  write(`${zone}: ${report.verdict} (${rows.at(-1).outcome})`)
}
const count = (outcome) => rows.filter((r) => r.outcome === outcome).length
const summary = { zones: rows.length, match: count('match'), miss: count('miss'), falseAlarm: count('false_alarm'), uncertain: count('uncertain'), unreadable: count('unreadable'), boxHits: rows.filter((r) => r.boxHit).length }
const out = { ranAt: new Date().toISOString(), backend: 'account-mode Sonnet (local Claude Code login)', photos: 'AI-generated photorealistic test images (Flow), not real photos, set A', summary, rows }
fs.writeFileSync(path.join(dir, 'results.json'), `${JSON.stringify(out, null, 2)}\n`)
write(JSON.stringify(summary))
write(`Recorded to ${path.join(dir, 'results.json')}. Quote these numbers as one set of six zones, not a detection rate.`)
