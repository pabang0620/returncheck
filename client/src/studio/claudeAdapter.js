// AG Studio LLM adapter that talks to our server proxy, which calls Claude. AG Studio's docs only show
// an OpenAI adapter, so this one is written against the AgLlmAdapter interface in the ag-studio types.
export function claudeAdapter({ endpoint, onSource = null }) {
  return {
    executeTurn(request, options = {}) {
      const call = fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: options.signal,
        body: JSON.stringify({ instructions: request.instructions, input: request.input, tools: request.tools, toolChoice: request.toolChoice, responseFormat: request.responseFormat }),
      })
        .then(async (res) => {
          const json = await res.json()
          if (!res.ok || json.success === false) throw new Error(json.message || `Studio agent request failed (${res.status})`)
          onSource?.({ source: json.data.source, reason: json.data.reason || null })
          return json.data
        })

      const complete = call.then((data) => ({ id: `resp_${Date.now()}`, createdAt: Date.now(), status: 'completed', output: data.output, model: data.source === 'claude' ? 'claude' : 'recorded' }))

      async function* stream() {
        const data = await call
        for (const item of data.output) {
          if (item.type === 'message') {
            yield { type: 'TEXT_MESSAGE_START', messageId: item.id, role: 'assistant' }
            yield { type: 'TEXT_MESSAGE_CONTENT', messageId: item.id, delta: item.content.map((c) => c.text || '').join('') }
            yield { type: 'TEXT_MESSAGE_END', messageId: item.id }
          } else if (item.type === 'function_call') {
            yield { type: 'TOOL_CALL_START', toolCallId: item.callId, toolCallName: item.name }
            yield { type: 'TOOL_CALL_ARGS', toolCallId: item.callId, delta: item.arguments }
            yield { type: 'TOOL_CALL_END', toolCallId: item.callId }
          }
        }
      }
      return { stream: { [Symbol.asyncIterator]: stream }, complete }
    },
  }
}
