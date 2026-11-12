import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CASES } from '../eval/cases.js'
import { boxHit, score } from '../eval/scoring.js'

describe('evaluation set', () => {
  it('has the planned shape: 24 pairs, 12 damaged (6 scratch, 3 dent, 3 front mark), 12 clean (4 pre-existing), 2 lightings', () => {
    assert.equal(CASES.length, 24)
    const damaged = CASES.filter((c) => c.expected === 'damage')
    assert.equal(damaged.length, 12)
    assert.equal(damaged.filter((c) => c.defect.kind === 'scratch').length, 6)
    assert.equal(damaged.filter((c) => c.defect.kind === 'dent').length, 3)
    assert.equal(damaged.filter((c) => c.defect.kind === 'mark').length, 3)
    assert.equal(CASES.filter((c) => c.expected === 'none').length, 12)
    assert.equal(CASES.filter((c) => c.preExisting).length, 4)
    assert.deepEqual([...new Set(CASES.map((c) => c.lighting))].sort(), ['dim', 'warm'])
    assert.equal(new Set(CASES.map((c) => c.id)).size, 24)
  })

  it('scores hits, misses, false alarms, uncertain answers and located boxes separately', () => {
    const rows = [
      { expected: 'damage', verdict: 'damage', boxHit: true },
      { expected: 'damage', verdict: 'damage', boxHit: false },
      { expected: 'damage', verdict: 'none' },
      { expected: 'damage', verdict: 'uncertain' },
      { expected: 'none', verdict: 'none', preExisting: true },
      { expected: 'none', verdict: 'damage', preExisting: true },
      { expected: 'none', verdict: 'none' },
      { expected: 'none', verdict: 'error' },
    ]
    const s = score(rows)
    assert.deepEqual([s.tp, s.fn, s.fp, s.tn, s.uncertain, s.errors, s.boxHits], [2, 1, 1, 2, 1, 1, 1])
    assert.equal(s.preExistingFalsePositives, 1)
    assert.equal(s.recall, 0.5)
    assert.equal(s.falsePositiveRate, 0.25)
  })

  it('a box counts as located when it contains the centre of the real defect', () => {
    const defect = { x: 100, y: 100, w: 60, h: 40 }
    assert.equal(boxHit({ x: 90, y: 90, w: 90, h: 70 }, defect), true)
    assert.equal(boxHit({ x: 300, y: 300, w: 50, h: 50 }, defect), false)
    assert.equal(boxHit(null, defect), false)
  })
})
