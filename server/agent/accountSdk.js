import { z } from 'zod'

// Shared helpers for the local-account backend (LLM_BACKEND=account). It runs the Claude Agent SDK, which
// uses the developer's Claude Code login. The API key variables are removed from the child environment, so
// a key in .env can never be picked up and billed.
let sdk = null

export async function loadSdk() {
  if (!sdk) sdk = await import('@anthropic-ai/claude-agent-sdk')
  return sdk
}

export function withoutApiKey(env = process.env) {
  const { ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, ...rest } = env
  return rest
}

// zod raw shape for the SDK's tool(); a schema zod cannot convert falls back to a free-form object.
export function shapeFor(inputSchema) {
  try {
    const converted = z.fromJSONSchema(inputSchema)
    if (converted.shape) return converted.shape
  } catch {
    // fall through to the free-form shape
  }
  return { input: z.record(z.string(), z.any()).optional() }
}
