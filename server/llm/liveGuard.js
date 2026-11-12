// Caps for the live model path. A "run" is one user-triggered agent action (counted once, not per tool turn).
// Two windows: per client IP per hour, and per host (this whole server) per day. When either is full, or the
// model call fails, the action completes on the recorded run or the rule-based stand-in and says why.
const HOUR_MS = 3600 * 1000
const DAY_MS = 24 * HOUR_MS
const MAX_TRACKED_IPS = 5000

export const FALLBACK_REASON = {
  LIMIT: 'live limit reached',
  ERROR: 'live model unavailable',
}

const positiveInt = (value, fallback) => {
  const n = Number.parseInt(value, 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export function readLiveLimits(env = process.env) {
  return {
    perIpHour: positiveInt(env.LLM_LIVE_PER_IP_HOUR, 10),
    perDay: positiveInt(env.LLM_LIVE_PER_DAY, 150),
  }
}

// `now` is injected so tests drive the windows with a fake clock.
export function createLiveGuard({ perIpHour, perDay, now = Date.now }) {
  const byIp = new Map()
  let day = []

  const recent = (list, t, span) => list.filter((at) => at > t - span)

  function sweep(t) {
    for (const [ip, hits] of byIp) {
      const kept = recent(hits, t, HOUR_MS)
      if (kept.length) byIp.set(ip, kept)
      else byIp.delete(ip)
    }
  }

  return {
    // Takes one run slot. Denied attempts do not use up the window.
    acquire(ip) {
      const t = now()
      const key = String(ip || 'unknown')
      day = recent(day, t, DAY_MS)
      if (byIp.size > MAX_TRACKED_IPS) sweep(t)
      const hits = recent(byIp.get(key) || [], t, HOUR_MS)
      if (hits.length >= perIpHour) return { ok: false, reason: FALLBACK_REASON.LIMIT, scope: 'ip' }
      if (day.length >= perDay) return { ok: false, reason: FALLBACK_REASON.LIMIT, scope: 'day' }
      byIp.set(key, [...hits, t])
      day = [...day, t]
      return { ok: true }
    },
    usage(ip) {
      const t = now()
      return { ip: recent(byIp.get(String(ip || 'unknown')) || [], t, HOUR_MS).length, day: recent(day, t, DAY_MS).length }
    },
  }
}
