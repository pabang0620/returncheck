import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAccountClient } from '../server/agent/accountClient.js'
import { ZONES } from '../server/domain/rateCard.js'
import { compareZone } from '../server/vision/compare.js'
import { inspectRaster } from '../server/domain/rasterPhoto.js'
import { CASES } from './cases.js'
import { boxHit, score } from './scoring.js'

// Runs the 24 pairs through the same compareZone() the app uses, with the local Claude Code account backend
// (never an API key). Usage: LLM_BACKEND=account node eval/run.js [--dir eval/pairs] [--only D01,N02]
const here = path.dirname(fileURLToPath(import.meta.url))
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : fallback }
const dir = path.resolve(arg('--dir', path.join(here, 'pairs')))
const only = arg('--only', '') ? new Set(arg('--only').split(',')) : null
const CONCURRENCY = 3

function loadPhoto(file) {
  const data = fs.readFileSync(file).toString('base64')
  return { ...inspectRaster(data, 'image/png'), data, sharpness: 1 }
}

async function runCase(client, c) {
  const photos = { before: loadPhoto(path.join(dir, `${c.id}_before.png`)), after: loadPhoto(path.join(dir, `${c.id}_after.png`)), closeup: null }
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const r = await compareZone({ setId: 'EVAL', zone: c.zone, zoneLabel: ZONES[c.zone].label, photos, anthropic: client })
      return { id: c.id, expected: c.expected, zone: c.zone, preExisting: c.preExisting, lighting: c.lighting, verdict: r.verdict, confidence: r.confidence || null, rateCode: r.rateCode || null, box: r.box || null, boxHit: boxHit(r.box, c.defect), source: r.source, note: r.note }
    } catch (err) {
      if (attempt === 2) return { id: c.id, expected: c.expected, zone: c.zone, preExisting: c.preExisting, lighting: c.lighting, verdict: 'error', error: String(err.message).slice(0, 200) }
    }
  }
  return null
}

const client = createAccountClient()
const queue = CASES.filter((c) => !only || only.has(c.id))
const rows = []
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (queue.length) {
    const c = queue.shift()
    rows.push(await runCase(client, c))
    process.stdout.write(`${c.id} done\n`)
  }
}))
rows.sort((a, b) => a.id.localeCompare(b.id))
const summary = score(rows)
const out = { ranAt: new Date().toISOString(), backend: 'account-mode Sonnet (local Claude Code login)', photos: 'synthetic drawings from eval/generate.js, not real camera photos', summary, rows }
fs.writeFileSync(path.join(here, 'results.json'), `${JSON.stringify(out, null, 2)}\n`)
process.stdout.write(`${JSON.stringify(summary)}\n`)
