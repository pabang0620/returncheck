import { useEffect, useMemo, useState } from 'react'
import { AgStudio, AgStudioProvider } from 'ag-studio-react'
import { request } from '../api.js'
import { buildSources, initialReport } from '../studio/data.js'
import { returnCheckTheme } from '../studio/theme.js'
import { createAnalystHarness, STUDIO_MODULES } from '../studio/agent.js'
import { widgets } from '../studio/widgets.jsx'
import { routeLicenceBanner } from '../studio/licenceNotice.js'

const LICENCE_KEY = import.meta.env.VITE_AG_STUDIO_LICENSE_KEY || undefined
if (!LICENCE_KEY) routeLicenceBanner()

// Edit mode: the agent on the left, the widget editor on the right. The filters and data panels are left out so the
// canvas keeps most of the width (the default opens four panels and squeezes it to half).
const PANELS = { edit: { left: ['ai'], right: ['edit'] } }

export function Studio({ sid }) {
  const [fleet, setFleet] = useState(null)
  const [mode, setMode] = useState('view')
  const [error, setError] = useState('')
  const [llm, setLlm] = useState(null)
  const [answer, setAnswer] = useState(null)
  useEffect(() => {
    request('/health', { method: 'GET' }).then((h) => setLlm(h.modes)).catch(() => setLlm(null))
  }, [])
  useEffect(() => {
    request(`/fleet${sid ? `?sid=${sid}` : ''}`, { method: 'GET' }).then(setFleet).catch((e) => setError(e.message))
  }, [sid])
  const data = useMemo(() => (fleet ? buildSources(fleet) : null), [fleet])
  const initialState = useMemo(() => initialReport(), [])
  const ai = useMemo(() => createAnalystHarness(sid, setAnswer), [sid])
  if (error) return <p className="err">{error}</p>
  if (!data) return <p>Loading the fleet...</p>
  return (
    <div>
      <div className="row row--between" style={{ marginBottom: 8 }}>
        <div>
          <h1>Morning screen</h1>
          <p className="muted">Seeded history for the last three months{sid ? ', plus the rental from your session' : ''}. Rows say which source they come from.</p>
          {!LICENCE_KEY && <p className="muted">No AG Studio licence key in this build, so AG Studio shows its trial watermark and logs its licence notice as a console warning.</p>}
          {mode === 'edit' && llm && <p className="muted">Damage Analyst: {llm.llm === 'live' ? `Live: ${llm.llmLabel}` : 'Recorded run: Claude Sonnet, 2026-11-12. The starter "Recovery by gear" replays that run, and AG Studio builds the widget from it. Other prompts get a fixed note, not a model answer.'}</p>}
          {mode === 'edit' && answer?.reason && <p className="muted">Last answer: {answer.source === 'recorded' ? 'Recorded run' : 'Rule-based stand-in'} ({answer.reason}). The live model did not answer this request, so the screen used the recording or a fixed note.</p>}
        </div>
        <button onClick={() => setMode(mode === 'view' ? 'edit' : 'view')}>{mode === 'view' ? 'Edit dashboard' : 'Back to view'}</button>
      </div>
      <div className={`studio${mode === 'edit' ? ' studio--wide' : ''}`}>
        <AgStudioProvider licenseKey={LICENCE_KEY}>
          <AgStudio style={{ height: "100%" }} data={data} mode={mode} widgets={widgets} theme={returnCheckTheme} initialState={initialState} modules={STUDIO_MODULES} ai={ai} panels={PANELS} />
        </AgStudioProvider>
      </div>
    </div>
  )
}
