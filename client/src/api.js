const storeKey = (sid) => `returncheck:${sid}`

export function saveKeys(sid, keys) {
  try {
    sessionStorage.setItem(storeKey(sid), JSON.stringify(keys))
  } catch {
    // Private mode: keys then live only in memory for this page.
    memory[sid] = keys
  }
}

const memory = {}

export function loadKeys(sid) {
  try {
    const raw = sessionStorage.getItem(storeKey(sid))
    if (raw) return JSON.parse(raw)
  } catch {
    // fall through to memory
  }
  return memory[sid] || null
}

export async function request(path, { method = 'POST', role, key, body } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (key) headers[role === 'renter' ? 'x-renter-key' : 'x-staff-key'] = key
  const res = await fetch(`/api${path}`, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) })
  const json = await res.json().catch(() => ({ success: false, message: 'Bad response from server.' }))
  if (!res.ok || json.success === false) throw new Error(json.message || `Request failed (${res.status})`)
  return json.data
}

export const money = (cents) => `$${(cents / 100).toFixed(2)}`

export const toBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result).split(',')[1])
  reader.onerror = reject
  reader.readAsDataURL(file)
})
