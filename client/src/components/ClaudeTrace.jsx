import { ModelText } from './ModelText.jsx'
const PHASE_TITLES = { inspect: 'Inspection', settle: 'Settlement' }

// What produced a run, in plain words. A recorded run is a real model run replayed; a rule-based run is not a model.
export function runLabel(run, llmLabel) {
  if (!run) return 'not run yet'
  const reason = run.fallbackReason ? ` (${run.fallbackReason})` : ''
  if (run.source === 'claude') return `Live: ${llmLabel}`
  if (run.source === 'replay') return `${run.recording.label}${reason}${run.diverged ? ' (replay differed, see trace)' : ''}`
  return `Rule-based stand-in${reason || ' (no model)'}`
}

const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`

// Every tool call of a Claude run in order, with a short input and result. Live, recorded and scripted runs use
// the same layout so they can be compared; the badge says which one this is.
export function ClaudeTrace({ runs, label }) {
  const list = ['inspect', 'settle'].map((phase) => runs?.[phase]).filter(Boolean)
  if (!list.length) return null
  return (
    <section className="card" aria-label="Claude trace">
      <h3>Claude trace</h3>
      {list.map((run) => {
        const live = run.source === 'claude'
        return (
          <details key={run.phase} open={run.phase === list[list.length - 1].phase}>
            <summary>
              {PHASE_TITLES[run.phase]}: {run.events.length} tool calls{run.recording ? ` in ${seconds(run.recording.durationMs)}` : ''}{' '}
              <span className={`chip ${live ? 'chip--live' : 'chip--seed'}`}>{runLabel(run, label)}</span>
            </summary>
            {run.fallbackReason && <p className="muted">The live model did not run for this action ({run.fallbackReason}), so the action completed without it. The source is named on the badge above.</p>}
            {run.source === 'replay' && <p className="muted">The tool calls, inputs and words below come from one real run of {run.recording.model} through the developer's Claude Code account ({run.recording.recordedAt.slice(0, 16).replace('T', ' ')} UTC). They are replayed against your session, so the cards and amounts are your own.</p>}
            {run.source === 'scripted' && <p className="muted">No model ran and no recorded run matches this state, so a fixed rule-based script called the same tools. Nothing here was written by a model.</p>}
            <ol className="trace">
              {run.events.map((e, i) => (
                <li key={`${e.tool}-${i}`} className={e.ok ? '' : 'trace--refused'}>
                  {Number.isFinite(e.atMs) && <span className="muted">+{seconds(e.atMs)} </span>}<code>{e.tool}</code> <span className="muted">{e.inputSummary}</span>
                  <div>{e.resultSummary}</div>
                </li>
              ))}
            </ol>
            {run.source !== 'scripted' && <><strong>{run.source === 'replay' ? 'Model text (recorded)' : 'Model text'}</strong><ModelText text={run.reply} /></>}
          </details>
        )
      })}
    </section>
  )
}
