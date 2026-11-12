import Anthropic from '@anthropic-ai/sdk'
import { config, modes } from '../config.js'
import { log } from '../demo/sessions.js'
import { runAccountAgent } from './accountAgent.js'
import { createAccountClient } from './accountClient.js'
import { runClaudeAgent } from './claudeAgent.js'
import { runMockAgent } from './mockAgent.js'
import { findRecording, recordingLabel, runRecordedAgent } from './recordings.js'

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

// Without a model: replay the recorded real run for this exact state if one exists, otherwise the scripted
// stand-in, which is labelled as such and never as a model.
async function runOffline(ctx, phase, recordings) {
  const rec = recordings !== false ? findRecording(ctx.session, phase, recordings || undefined) : null
  if (rec) {
    ctx.via = { source: 'replay', label: recordingLabel(rec) }
    return runRecordedAgent(ctx, phase, rec)
  }
  ctx.via = { source: 'scripted', label: 'Scripted stand-in (no model)' }
  return runMockAgent(ctx, phase)
}

// Live Claude when a key is set or the local account backend is on. A failure falls back to the recorded
// run and says so (plan 5-3).
export async function runAgent({ session, gateway, phase, live = modes.llm === 'live', client = null, recordings = null }) {
  const ctx = { session, gateway, model: config.anthropicModel, anthropic: null, via: null }
  if (live) {
    ctx.via = { source: 'claude', label: `Live: ${modes.llmLabel}` }
    const useAccount = !client && config.llmBackend === 'account'
    const sdk = client || getLlmClient()
    ctx.anthropic = sdk
    try {
      if (useAccount) return await runAccountAgent(ctx, phase, { model: config.anthropicModel })
      return await runClaudeAgent(ctx, phase, { client: sdk, model: config.anthropicModel })
    } catch (err) {
      log(session, 'server', `Claude call failed (${err.message}). Using the recorded run or the scripted stand-in.`)
      ctx.anthropic = null
      return { ...(await runOffline(ctx, phase, recordings)), offline: true }
    }
  }
  return runOffline(ctx, phase, recordings)
}
