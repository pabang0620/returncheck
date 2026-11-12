import { AgStudioAiModule, createAiHarness, directLlmRunner } from 'ag-studio'
import { claudeAdapter } from './claudeAdapter.js'

export const STUDIO_MODULES = [AgStudioAiModule]

const ANALYST = `You are the Damage Analyst for a camera rental shop's morning screen. You answer questions about returns, claim items and recovery using the data sources (claim items, rentals, PayPal charges, assets). Money amounts in the data come from the rate card and from PayPal; never estimate or change them. recovered_amount is net: money charged minus money refunded. Rows marked seeded are generated history, rows marked mock or sandbox live come from the demo rental.

How you work:
- A data question: delegate_to type "data".
- A new widget (a chart, a grid, a KPI) takes two delegations, in order. First type "page": "Add one new <widget type> widget below the existing widgets on page <page id>." Its summary gives the new widget id. Then type "widget" with that new widget id: one concrete task naming the table and fields (for example "Show the sum of items.recovered_amount by items.category, title Net recovered by gear").
- Never delegate a change to an existing widget (queue, recovery, map, category) unless the user asked to change that widget. They are the desk.
- After the delegates return, summarize in two short sentences.`

// Studio agent framework: a custom lead agent that delegates to the built-in data and widget agents.
// Every model turn goes through the server proxy, so the Anthropic key stays on the server.
export function createAnalystHarness(sid) {
  const adapter = claudeAdapter({ endpoint: `/api/studio/llm?sid=${encodeURIComponent(sid || '')}` })
  return ({ api }) => createAiHarness(api, ({ tools, builtIn }) => ({
    agents: [
      directLlmRunner({ id: 'damage-analyst', name: 'Damage Analyst', description: 'Answers questions about damage and recovery and builds widgets on request', instructions: () => ANALYST, tools: () => [tools.delegateTo(['data', 'page', 'widget'])], adapter }),
      directLlmRunner({ ...builtIn.data, adapter }),
      directLlmRunner({ ...builtIn.page, adapter }),
      directLlmRunner({ ...builtIn.widget, adapter }),
    ],
    primary: 'damage-analyst',
    promptStarters: [
      { label: 'Recovery by gear', prompt: 'Add a new bar chart of net recovered dollars (charged minus refunds) by gear category' },
      { label: 'Worst zones', prompt: 'Which zones cost the most in billed damage?' },
    ],
  }))
}
