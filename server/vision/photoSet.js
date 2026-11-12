import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { ZONE_IDS } from '../domain/rateCard.js'
import { boxHit } from '../../eval/scoring.js'

export const MAX_FILE_BYTES = 4 * 1024 * 1024
const EXTENSIONS = ['jpg', 'jpeg', 'png']
const boxSchema = z.object({ x: z.number().min(0), y: z.number().min(0), w: z.number().positive(), h: z.number().positive() })

// expected.json: what the person who shot the set knows to be true, per zone. Box is in pixels of the return photo.
export const expectedSchema = z.record(z.enum(ZONE_IDS), z.object({
  damage: z.boolean(),
  preExisting: z.boolean().optional(),
  kind: z.string().max(60).optional(),
  box: boxSchema.optional(),
}))

export function findPhoto(dir, zone, kind) {
  for (const ext of EXTENSIONS) {
    const file = path.join(dir, `${zone}_${kind}.${ext}`)
    if (fs.existsSync(file)) return file
  }
  return null
}

// Pure check of the folder contents. Returns problems as readable strings; empty list means ready to run.
export function checkSetFolder(dir) {
  const problems = []
  const files = {}
  for (const zone of ZONE_IDS) {
    for (const kind of ['checkout', 'return']) {
      const file = findPhoto(dir, zone, kind)
      if (!file) problems.push(`Missing ${zone}_${kind}.jpg (or .png)`)
      else if (fs.statSync(file).size > MAX_FILE_BYTES) problems.push(`${path.basename(file)} is over ${MAX_FILE_BYTES / 1024 / 1024} MB; export it at 1600 px on the long edge`)
      else files[`${zone}:${kind}`] = file
    }
    const closeup = findPhoto(dir, zone, 'closeup')
    if (closeup) files[`${zone}:closeup`] = closeup
  }
  const expectedFile = path.join(dir, 'expected.json')
  let expected = null
  if (!fs.existsSync(expectedFile)) problems.push('Missing expected.json (what you know is true per zone)')
  else {
    const parsed = expectedSchema.safeParse(JSON.parse(fs.readFileSync(expectedFile, 'utf8')))
    if (!parsed.success) problems.push(`expected.json: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`)
    else {
      expected = parsed.data
      for (const zone of ZONE_IDS) if (!expected[zone]) problems.push(`expected.json has no entry for ${zone}`)
    }
  }
  return { problems, files, expected }
}

// Compares one Claude zone report with what the shooter says is true. "uncertain" counts as its own bucket.
export function compareWithExpected(zone, expectedZone, report) {
  const said = report.verdict
  const truth = expectedZone.damage ? 'damage' : 'none'
  const outcome = said === 'uncertain' ? 'uncertain' : said === 'unreadable' ? 'unreadable' : said === truth ? 'match' : (truth === 'damage' ? 'miss' : 'false_alarm')
  return {
    zone,
    expected: truth,
    preExisting: Boolean(expectedZone.preExisting),
    verdict: said,
    outcome,
    confidence: report.confidence || null,
    rateCode: report.rateCode || null,
    boxHit: truth === 'damage' && said === 'damage' && expectedZone.box ? boxHit(report.box, expectedZone.box) : null,
    note: report.note,
    source: report.source,
  }
}
