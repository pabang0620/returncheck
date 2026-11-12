// All money inside the server is integer cents. Only the PayPal boundary converts to decimal strings.
export const CURRENCY = 'USD'

export function toDecimal(cents) {
  if (!Number.isInteger(cents) || cents < 0) throw new Error(`Invalid cents value ${cents}`)
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`
}

export function toMoney(cents) {
  return { currency_code: CURRENCY, value: toDecimal(cents) }
}

export function fromDecimal(value) {
  return Math.round(Number(value) * 100)
}

export function sum(values) {
  return values.reduce((total, v) => total + v, 0)
}
