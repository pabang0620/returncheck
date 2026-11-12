const locks = new Map()

// Serialize every money move on one rental so approvals, charges and refunds never interleave.
export function withRentalLock(rentalId, fn) {
  const previous = locks.get(rentalId) || Promise.resolve()
  const run = previous.then(fn, fn)
  const tail = run.catch(() => {})
  locks.set(rentalId, tail)
  tail.then(() => { if (locks.get(rentalId) === tail) locks.delete(rentalId) })
  return run
}
