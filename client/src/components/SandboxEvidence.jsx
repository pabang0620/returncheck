// What actually ran against the PayPal sandbox and the real model on 2026-11-12, copied from VERIFY.md by row id.
// Only PASS rows and the passed parts of PARTIAL rows are listed. Keep this in step with VERIFY.md.
export const SANDBOX_PASS = [
  { id: 'V3', text: 'Vault setup token created: PAYER_ACTION_REQUIRED with an approve link (setup token 82U44822E3743292L).' },
  { id: 'V4', text: 'Sandbox buyer approved it; vault_create_payment_token returned token 0gb86444hw007261a with a customer id. The in-app return URL hop was not completed.' },
  { id: 'V5', text: 'Five merchant-initiated charges on that one saved token, all COMPLETED, with and without stored_credential (orders 3VY16269PT535220K, 29H75670FC183254J, 5FB55381X0221213S, 52P08583CD601751G, 55C322885D697153W). Run by script through the same gateway.chargeToken the approval card calls.' },
  { id: 'V4b', text: 'In-app return hop: Save PayPal yourself, buyer approval, PayPal sent the browser back to /token/return, which saved payment token 26b352559v815782v. It is now the shared demo token (DEMO_VAULT_TOKEN_ID).' },
  { id: 'V5b', text: 'Charge through the approval card in sandbox demo mode: Ask Claude to settle, Approve. Orders 33514540Y7394535Y (capture 8YH54995P9601513G) and 1TU36406RD148063R (capture 4JT76457L91619830), COMPLETED, receipt items echoed by PayPal.' },
  { id: 'V7b', text: 'Refund through the approval card: Waive 3, Reduce 1, Ask Claude, Approve. Refunds 6UR69705YU342344D and 4LH24943GY010174T, $17.50 each, COMPLETED; captures read PARTIALLY_REFUNDED.' },
  { id: 'V12', text: 'Two browser sessions on the shared token: A charged (order 51347753GH389322K), simulated removal; B still charged (order 1KP39390LT369033D). The token still reads active afterwards: never deleted.' },
  { id: 'V8', text: 'Invoice fallback through the Agent Toolkit: create_invoice and send_invoice, invoice INV2-UQ7N-58JM-7QP2-JLNF reads SENT.' },
]

export const SANDBOX_PARTIAL = [
  { id: 'V6', text: 'GET token 200, DELETE token HTTP 204, GET after delete 404 TOKEN_NOT_FOUND. Not run: removal from the buyer\'s PayPal settings.' },
  { id: 'V7', text: 'Toolkit get_order read order 3VY16269PT535220K; a $10 partial create_refund returned COMPLETED (refund 4KF16014SW228825X). Not passed: list_transactions answered 403, so the app does not use it.' },
]

export const MODEL_PASS = [
  { id: 'V13', text: 'Inspection and settlement agent loops chose their own tools; these runs are the recordings replayed in this demo.' },
  { id: 'V9', text: 'Vision on two synthetic PNGs (a drawn line), not camera photos.' },
  { id: 'V15a', text: 'Photo set A, six zones, 12 AI-generated photorealistic test images (Flow), not real photos: 6 of 6 zones matched what was set up (top plate scratch and mount dent found, 4 clean zones clean), 2 of 2 boxes hit. One set of six zones, not a detection rate and not real-photo accuracy.' },
  { id: 'V10', text: 'Studio Damage Analyst added a bar chart through our Claude adapter.' },
]

export function SandboxEvidence({ open = false }) {
  return (
    <details className="card" open={open} aria-label="Sandbox evidence">
      <summary><strong>Sandbox evidence</strong> (what ran for real on 2026-11-12, from VERIFY.md)</summary>
      <p className="muted">Without sandbox keys this demo runs on PayPal doubles with the same response shapes; the PayPal chip on the staff screen says which mode is live. These rows ran against the PayPal sandbox.</p>
      <ul>{SANDBOX_PASS.map((r) => <li key={r.id}><strong>{r.id} PASS</strong>: {r.text}</li>)}</ul>
      <ul>{SANDBOX_PARTIAL.map((r) => <li key={r.id}><strong>{r.id} PARTIAL</strong>: {r.text}</li>)}</ul>
      <p className="muted">Model checks ran through Claude Sonnet on the developer's Claude Code account, not the hosted API:</p>
      <ul>{MODEL_PASS.map((r) => <li key={r.id}><strong>{r.id} PASS</strong>: {r.text}</li>)}</ul>
      <p className="muted">Not run yet (need a person or a key): V1, V2, V11, V14, V15 with real camera photos (set A above used AI-generated images, not real photos).</p>
    </details>
  )
}
