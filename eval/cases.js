// The 24-pair evaluation set (plan 7-4 / 10-2): 12 pairs with new damage (6 scratches, 3 dents, 3 front-element
// marks) and 12 without (4 of them carry a mark that was already there at check-out), under 2 lighting setups.
// The pairs here are SYNTHETIC drawings made by eval/generate.js. The plan asks for real camera photos; those
// are a person's job. Drop real pairs into eval/pairs-real/ with the same file naming and run with --dir.
const SCRATCH = (x, y, w) => ({ kind: 'scratch', x, y, w, h: 5 })
const DENT = (x, y, w, h) => ({ kind: 'dent', x, y, w, h })
const MARK = (x, y, w, h) => ({ kind: 'mark', x, y, w, h })

const damage = [
  ['top_plate', SCRATCH(150, 180, 150)], ['top_plate', SCRATCH(300, 230, 120)], ['lens_barrel', SCRATCH(180, 200, 170)],
  ['lens_barrel', SCRATCH(330, 170, 110)], ['top_plate', SCRATCH(210, 270, 140)], ['lens_barrel', SCRATCH(120, 250, 160)],
  ['top_plate', DENT(380, 190, 70, 46)], ['lens_barrel', DENT(260, 210, 60, 50)], ['top_plate', DENT(170, 250, 64, 44)],
  ['lens_front', MARK(260, 150, 70, 70)], ['lens_front', MARK(300, 210, 60, 60)], ['lens_front', MARK(220, 190, 80, 64)],
]
const clean = ['top_plate', 'lens_barrel', 'lens_front', 'top_plate', 'lens_barrel', 'lens_front', 'top_plate', 'lens_barrel']
const old = [['top_plate', SCRATCH(160, 200, 130)], ['lens_barrel', DENT(300, 200, 64, 46)], ['lens_front', MARK(280, 180, 70, 60)], ['lens_barrel', SCRATCH(200, 240, 150)]]

export const CASES = [
  ...damage.map(([zone, defect], i) => ({ id: `D${String(i + 1).padStart(2, '0')}`, expected: 'damage', zone, defect, preExisting: false, lighting: i % 2 ? 'dim' : 'warm' })),
  ...clean.map((zone, i) => ({ id: `N${String(i + 1).padStart(2, '0')}`, expected: 'none', zone, defect: null, preExisting: false, lighting: i % 2 ? 'dim' : 'warm' })),
  ...old.map(([zone, defect], i) => ({ id: `P${String(i + 1).padStart(2, '0')}`, expected: 'none', zone, defect, preExisting: true, lighting: i % 2 ? 'warm' : 'dim' })),
]
