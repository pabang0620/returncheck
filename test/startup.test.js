import { test } from 'node:test'
import assert from 'node:assert/strict'
import { startupLine } from '../server/index.js'
import { isLicenceBannerLine, routeLicenceBanner } from '../client/src/studio/licenceNotice.js'

test('startup_line_names_the_real_port', () => {
  assert.equal(startupLine(3597, 'http://localhost:3010'), 'ReturnCheck listening on http://localhost:3597 (public URL http://localhost:3010)')
  assert.equal(startupLine(3010, 'http://localhost:3010'), 'ReturnCheck listening on http://localhost:3010')
  assert.equal(startupLine(3010, 'https://returncheck.example'), 'ReturnCheck listening on http://localhost:3010 (public URL https://returncheck.example)')
})

test('licence_banner_goes_to_warn_and_real_errors_stay_errors', () => {
  const seen = { error: [], warn: [] }
  const fake = { error: (...a) => seen.error.push(a), warn: (...a) => seen.warn.push(a) }
  routeLicenceBanner(fake)
  routeLicenceBanner(fake)
  const banner = ' License Key Not Found '.padStart(62 + 12, '*').padEnd(124, '*')
  fake.error(banner)
  fake.error('*'.repeat(124))
  fake.error('TypeError: x is undefined')
  fake.error('*'.repeat(124), 'extra')
  assert.equal(seen.warn.length, 2)
  assert.equal(seen.error.length, 2)
  assert.equal(isLicenceBannerLine(['* short *']), false)
})
