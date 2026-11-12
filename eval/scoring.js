// Pure scoring for the evaluation set. A pair is "positive" when it has new damage. A zone verdict of
// "uncertain" is counted on its own (the product sends those to a person) and is neither hit nor miss.
export function boxHit(box, defect) {
  if (!box || !defect) return false
  const cx = defect.x + defect.w / 2 + 3
  const cy = defect.y + defect.h / 2
  return cx >= box.x && cx <= box.x + box.w && cy >= box.y && cy <= box.y + box.h
}

export function score(rows) {
  const positives = rows.filter((r) => r.expected === 'damage')
  const negatives = rows.filter((r) => r.expected === 'none')
  const said = (r) => r.verdict
  const tp = positives.filter((r) => said(r) === 'damage').length
  const fn = positives.filter((r) => said(r) === 'none').length
  const fp = negatives.filter((r) => said(r) === 'damage').length
  const tn = negatives.filter((r) => said(r) === 'none').length
  const uncertain = rows.filter((r) => said(r) === 'uncertain').length
  const errors = rows.filter((r) => said(r) === 'error').length
  const located = positives.filter((r) => said(r) === 'damage' && r.boxHit).length
  const oldMarks = negatives.filter((r) => r.preExisting)
  return {
    pairs: rows.length,
    tp, fn, fp, tn, uncertain, errors,
    boxHits: located,
    preExistingFalsePositives: oldMarks.filter((r) => said(r) === 'damage').length,
    preExistingPairs: oldMarks.length,
    recall: positives.length ? tp / positives.length : 0,
    falsePositiveRate: negatives.length ? fp / negatives.length : 0,
  }
}
