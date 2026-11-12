import Anthropic from '@anthropic-ai/sdk'
import { config, modes } from '../config.js'
import { log } from '../demo/sessions.js'
import { runAccountAgent } from './accountAgent.js'
import { createAccountClient } from './accountClient.js'
import { FALLBACK_REASON, createLiveGuard } from '../llm/liveGuard.js'
import { runClaudeAgent } from './claudeAgent.js'
import { runMockAgent } from './mockAgent.js'
import { findRecording, recordingLabel, runRecordedAgent } from './recordings.js'

// One budget for every live model path (agent runs and the Studio proxy).
export const liveGuard = createLiveGuard(config.liveLimits)

let anthropic = null
const getAnthropic = () => {
  if (!anthropic) anthropic = new Anthropic({ apiKey: config.anthropicKey })
  return anthropic
}

// The one Messages-style client for single turns (vision, Studio): the account stand-in or the API client.
let account = null
export function getLlmClient() {
  if (config.llmBackend === 'account') return (account ||= createAccountClient())
  return modes.llm === 'live' ? getAnthropic() : null
}

// Without a model: replay the recorded real run for this exact state if one exists, otherwise the rule-based
// stand-in, which is labelled as such and never as a model. `reason` says why no model ran (limit or error).
async function runOffline(ctx, phase, recordings, reason = null) {
  const suffix = reason ? ` (${reason})` : ''
  const rec = recordings !== false ? findRecording(ctx.session, phase, recordings || undefined) : null
  if (rec) {
    ctx.via = { source: 'replay', label: `${recordingLabel(rec)}${suffix}` }
    return { ...(await runRecordedAgent(ctx, phase, rec)), ...(reason ? { offline: true, fallbackReason: reason } : {}) }
  }
  ctx.via = { source: 'scripted', label: `Rule-based stand-in${reason ? suffix : ' (no model)'}` }
  return { ...(await runMockAgent(ctx, phase)), ...(reason ? { offline: true, fallbackReason: reason } : {}) }
}

// Live Claude when a key is set or the local account backend is on and a run slot is free (per IP per hour, per
// host per day). A full cap or a failed call falls back to the recorded run or the stand-in and says why (plan 5-3).
export async function runAgent({ session, gateway, phase, live = modes.llm === 'live', client = null, recordings = null, clientIp = 'unknown', guard = liveGuard }) {
  const ctx = { session, gateway, model: config.anthropicModel, anthropic: null, via: null }
  if (!live) return runOffline(ctx, phase, recordings)
  const slot = guard.acquire(clientIp)
  if (!slot.ok) {
    log(session, 'server', `Live model limit reached. Using the recorded run or the rule-based stand-in.`)
    return runOffline(ctx, phase, recordings, slot.reason)
  }
  ctx.via = { source: 'claude', label: `Live: ${modes.llmLabel}` }
  const useAccount = !client && config.llmBackend === 'account'
  const sdk = client || getLlmClient()
  ctx.anthropic = sdk
  try {
    if (useAccount) return await runAccountAgent(ctx, phase, { model: config.anthropicModel })
    return await runClaudeAgent(ctx, phase, { client: sdk, model: config.anthropicModel })
  } catch {
    log(session, 'server', 'The live model did not answer. Using the recorded run or the rule-based stand-in.')
    ctx.anthropic = null
    return runOffline(ctx, phase, recordings, FALLBACK_REASON.ERROR)
  }
}
