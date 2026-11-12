// Without a licence key AG Studio prints its trial notice as a block of console.error lines, each exactly
// 124 characters framed by '*'. That notice is expected (VERIFY V11), so it goes to console.warn instead:
// it stays in the console and the page says the same thing next to the dashboard, while console.error keeps
// only real errors. Any other console.error call passes through unchanged.
const BANNER_WIDTH = 124

export function isLicenceBannerLine(args) {
  if (args.length !== 1 || typeof args[0] !== 'string') return false
  const line = args[0]
  return line.length === BANNER_WIDTH && line.startsWith('*') && line.endsWith('*')
}

export function routeLicenceBanner(target = console) {
  if (target.error.__returnCheckLicence) return
  const original = target.error.bind(target)
  const routed = (...args) => (isLicenceBannerLine(args) ? target.warn(...args) : original(...args))
  routed.__returnCheckLicence = true
  target.error = routed
}
