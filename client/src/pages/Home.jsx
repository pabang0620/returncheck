import { useState } from 'react'
import { request, saveKeys } from '../api.js'
import { PhotoEvidence } from '../components/PhotoEvidence.jsx'
import { SandboxEvidence } from '../components/SandboxEvidence.jsx'

const SETS = [
  { id: 'A', title: 'Set A · Illustrated $35 walkthrough', text: 'A scratch, a dent the renter will contest, and an old barrel mark seen in an earlier return. Inspection is already done when it opens.' },
  { id: 'B', title: 'Set B', text: 'The front element is unclear. Claude asks for a close-up and you upload a seeded one with one click.' },
  { id: 'C', title: 'Set C', text: 'No new damage. Everything Claude finds was already there in earlier returns.' },
]

export function Home({ navigate }) {
  const [set, setSet] = useState('A')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function start() {
    setBusy(true)
    setError('')
    try {
      const data = await request('/demo', { body: { set } })
      saveKeys(data.sid, { staffKey: data.staffKey, renterKey: data.renterKey })
      navigate(`/judge/${data.sid}`)
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  return (
    <div className="hero">
      <h1>AI can find the scratch. It should not be the one charging.</h1>
      <p>ReturnCheck lets a camera rental shop rent a kit for a week without holding the renter's card. PayPal is saved once at pickup, the renter returns and leaves, Claude compares the photos and drafts priced items, the renter accepts or contests each line, and Claude can only request a charge that staff approve.</p>
      <p className="muted">Try it as a judge: each click on the button gives you your own private copy of rental R-1042 with a staff screen on the left and the renter's phone on the right. Pickup and return dates, photos and the fleet history are seeded. Money moves through PayPal Vault v3 and Orders v2 (mock without sandbox keys).</p>
      <div className="sets" role="radiogroup" aria-label="Photo set">
        {SETS.map((s) => (
          <label key={s.id}>
            <input type="radio" name="set" checked={set === s.id} onChange={() => setSet(s.id)} />
            <span><strong>{s.title}</strong><br /><span className="muted">{s.text}</span></span>
          </label>
        ))}
      </div>
      <div className="row">
        <button className="primary" disabled={busy} onClick={start}>Try the demo rental</button>
        <button onClick={() => navigate('/studio')}>Open the fleet dashboard</button>
      </div>
      {error && <p className="err" role="alert">{error}</p>}
      {set === 'A' && <ol className="muted">
        <li>Try the demo rental. The staff side already shows the draft items from Claude's recorded inspection run.</li>
        <li>Keep and send: Keep items 1 and 3, then Send link. In the phone, Accept item 1 and Contest item 3 (Use example note).</li>
        <li>Ask Claude to settle. Item 3 is held and a $35.00 charge card waits for you.</li>
        <li>Approve: you get the PayPal order id and the receipt items.</li>
      </ol>}
      <PhotoEvidence />
      <SandboxEvidence />
    </div>
  )
}
