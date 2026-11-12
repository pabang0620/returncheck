import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { ZONE_IDS } from '../server/domain/rateCard.js'
import { checkSetFolder, compareWithExpected } from '../server/vision/photoSet.js'

function makeDir(withFiles) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'setA-'))
  if (withFiles) for (const zone of ZONE_IDS) for (const kind of ['checkout', 'return']) fs.writeFileSync(path.join(dir, `${zone}_${kind}.jpg`), 'x')
  return dir
}
const expectedAll = Object.fromEntries(ZONE_IDS.map((z) => [z, { damage: z === 'top_plate', box: { x: 10, y: 10, w: 100, h: 50 } }]))

describe('photo set A folder', () => {
  it('lists every missing file and the missing expected.json', () => {
    const { problems } = checkSetFolder(makeDir(false))
    assert.equal(problems.length, 13)
    assert.ok(problems.includes('Missing top_plate_return.jpg (or .png)'))
  })
  it('is ready with 12 photos and a complete expected.json', () => {
    const dir = makeDir(true)
    fs.writeFileSync(path.join(dir, 'expected.json'), JSON.stringify(expectedAll))
    const { problems, files } = checkSetFolder(dir)
    assert.deepEqual(problems, [])
    assert.equal(Object.keys(files).length, 12)
  })
  it('rejects an expected.json with an unknown zone or a zone left out', () => {
    const dir = makeDir(true)
    fs.writeFileSync(path.join(dir, 'expected.json'), JSON.stringify({ top_plate: { damage: true } }))
    assert.ok(checkSetFolder(dir).problems.some((p) => p.startsWith('expected.json') && p.includes('rear_lcd')))
    fs.writeFileSync(path.join(dir, 'expected.json'), JSON.stringify({ roof: { damage: true } }))
    assert.ok(checkSetFolder(dir).problems.some((p) => p.startsWith('expected.json')))
  })
})

describe('comparison with what the shooter knows', () => {
  const ex = { damage: true, box: { x: 10, y: 10, w: 100, h: 50 } }
  it('scores match, miss, false alarm and uncertain separately', () => {
    assert.equal(compareWithExpected('top_plate', ex, { verdict: 'damage', box: { x: 0, y: 0, w: 200, h: 100 } }).outcome, 'match')
    assert.equal(compareWithExpected('top_plate', ex, { verdict: 'none' }).outcome, 'miss')
    assert.equal(compareWithExpected('rear_lcd', { damage: false }, { verdict: 'damage' }).outcome, 'false_alarm')
    assert.equal(compareWithExpected('rear_lcd', { damage: false }, { verdict: 'uncertain' }).outcome, 'uncertain')
  })
  it('checks the box only when damage is expected and found', () => {
    assert.equal(compareWithExpected('top_plate', ex, { verdict: 'damage', box: { x: 500, y: 500, w: 20, h: 20 } }).boxHit, false)
    assert.equal(compareWithExpected('rear_lcd', { damage: false }, { verdict: 'none' }).boxHit, null)
  })
})
