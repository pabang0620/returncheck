import { useCallback, useEffect, useState } from 'react'
import { loadKeys, request } from '../api.js'
import { runLabel } from '../components/ClaudeTrace.jsx'
import { RenterPanel } from '../components/RenterPanel.jsx'
import { SandboxEvidence } from '../components/SandboxEvidence.jsx'
import { MoneyLedger, PayPalPlan, SettlePanel, Steps } from '../components/SidePanels.jsx'
import { StaffPanel } from '../components/StaffPanel.jsx'

export function Judge({ sid, navigate, onStatus }) {
  const keys = loadKeys(sid)
  const [staff, setStaff] = useState(null)
  const [renter, setRenter] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('staff')

  const refresh = useCallback(async () => {
    if (!keys) return
    const [s, r] = await Promise.all([
      request(`/s/${sid}/state/staff`, { method: 'GET', role: 'staff', key: keys.staffKey }),
      request(`/s/${sid}/state/renter`, { method: 'GET', role: 'renter', key: keys.renterKey }),
    ])
    setStaff(s.state)
    setRenter(r.state)
  }, [sid, keys?.staffKey, keys?.renterKey])

  useEffect(() => {
    refresh().catch((e) => setError(e.message))
  }, [refresh])

  // Header chips: which parts are seeded, mock or live, and who is at the counter.
  const statusKey = staff ? `${staff.rental.id}|${staff.modes.paypalCalls}|${runLabel(staff.lastAgent, staff.modes.llmLabel)}|${staff.lastAgent?.source}` : ''
  useEffect(() => {
    if (!staff) return undefined
    onStatus?.({
      rentalId: staff.rental.id,
      staff: 'Mina',
      chips: [
        { text: 'dates seeded' },
        { text: `PayPal: ${staff.modes.paypalCalls === 'mock' ? 'mock' : 'sandbox live'}`, live: staff.modes.paypalCalls !== 'mock' },
        { text: `Claude: ${runLabel(staff.lastAgent, staff.modes.llmLabel)}`, live: staff.lastAgent?.source === 'claude' },
      ],
    })
    return () => onStatus?.(null)
  }, [statusKey])

  async function run(role, path, body) {
    setBusy(true)
    setError('')
    try {
      await request(`/s/${sid}${path}`, { role, key: role === 'staff' ? keys.staffKey : keys.renterKey, body })
      await refresh()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function saveOwn() {
    setBusy(true)
    setError('')
    try {
      const { approveUrl } = await request(`/s/${sid}/token/save`, { role: 'renter', key: keys.renterKey })
      window.location.assign(approveUrl)
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  if (!keys) {
    return <div className="card"><p>This rental belongs to another browser session. <button className="link" onClick={() => navigate('/')}>Start your own demo rental</button></p></div>
  }
  if (!staff || !renter) return <p>{error || 'Loading rental...'}</p>

  const staffAct = (path, body) => run('staff', path, body)
  const showRenter = () => { setTab('renter'); document.getElementById('renter-phone')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
  function showSettlement() {
    setTab('staff')
    requestAnimationFrame(() => {
      document.getElementById('staff-settlement')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }
  const renterFinished = staff.linkSent && staff.settleNeeded && renter.claim.items.length > 0
    && !renter.claim.items.some((item) => item.status === 'staff_ok')
  return (
    <div className={`judge judge--${tab}`}>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'staff'} className={tab === 'staff' ? 'primary' : ''} onClick={() => setTab('staff')}>Staff</button>
        <button role="tab" aria-selected={tab === 'renter'} className={tab === 'renter' ? 'primary' : ''} onClick={() => setTab('renter')}>Renter</button>
      </div>
      <div className="shell">
        <main className={`work ${tab === 'staff' ? '' : 'hidden-mobile'}`}>
          <Steps state={staff} />
          <StaffPanel state={staff} busy={busy} act={staffAct} onShowRenter={showRenter} />
        </main>
        <div className="side">
          <div id="staff-settlement" className={`side__staff ${tab === 'staff' ? '' : 'hidden-mobile'}`}>
            <SettlePanel state={staff} busy={busy} error={error} act={staffAct} />
            <PayPalPlan state={staff} />
            <MoneyLedger state={staff} />
          </div>
          <div className={tab === 'renter' ? '' : 'hidden-mobile'}>
            <RenterPanel state={renter} busy={busy} act={(path, body) => run('renter', path, body)} onSaveOwn={saveOwn} />
            {renterFinished && <button type="button" onClick={showSettlement}>Demo: return to staff to review and settle</button>}
            {error && tab === 'renter' && <p className="err only-mobile" role="alert">{error}</p>}
            <SandboxEvidence />
          </div>
        </div>
      </div>
    </div>
  )
}
