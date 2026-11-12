# ReturnCheck video script (2:48)

Start the app in the exact recording state with one command:

```bash
npm install
npm run demo:video        # builds, then serves http://localhost:3010 with FORCE_MOCK=1
```

`FORCE_MOCK=1` ignores any keys in `.env`: PayPal runs on doubles (chips say "mock") and Claude scenes replay the recorded real runs (chips say "Recorded run: Claude Sonnet, 2026-11-12"). Record at 1440x900, browser zoom 100%. Every scene below was walked headless on 2026-11-12 with these settings.

Step names match README.md and DEVPOST.md: 1 Try the demo rental, 2 Keep and send, 3 Ask Claude to settle, 4 Approve.

| Time | On screen (action) | Narration / caption (English) | Criterion |
|---|---|---|---|
| 0:00-0:15 | Start page headline "AI can find the scratch. It should not be the one charging." Caption: CRNYC quote "will release the hold upon return and damage-free inspection" and camerarentalsnyc.com/rental-returns-policy | "Some camera rental shops hold the renter's card until the gear passes inspection. AI can find the scratch faster. It shouldn't be the one charging." | Potential Impact, Innovation |
| 0:15-0:30 | Press **Try the demo rental** (step 1). Point at the renter phone card: "Max damage charge: $300.00", "No card hold for 7 days", rate card | "Nothing is held for the week. PayPal is saved for this rental only, up to a limit the renter can see, and the renter leaves at return." | Design, PayPal |
| 0:30-0:55 | Staff side, item 2 (lens barrel): the R-0977 return photo next to this return, "Not billed". Open **Claude trace**, Inspection: chip "Recorded run: Claude Sonnet, 2026-11-12", the three `get_asset_history` lines and `record_finding ... pre_existing` | "Claude compares each zone and checks this lens's earlier returns. This mark was already there in R-0977, so it is not on the bill. This is a recorded run of Claude Sonnet: its own tool calls, replayed on this session." | Technological Implementation (AI depth) |
| 0:55-1:10 | Step 2: **Keep** items 1 and 3, **Send link**. Phone: **Accept** item 1; item 3 **Contest + photo**, **Use example note**, **Send contest** | "The renter sees the same crop and the rate-card price on every line, and accepts or contests each one." | Design |
| 1:10-1:45 | Step 3: **Ask Claude to settle**. Held item 3 with Claude's reason; approval card "Requested by Claude", "Amount (server, rate card) $35.00", "Not executed until approved". Step 4: **Approve**. Receipt: order id, `COMPLETED`, invoice_id, Request-Id, items | "Claude can only request a charge, and the request has no amount. The server prices it from the rate card, and nothing reaches PayPal until a person approves. The receipt shows exactly what was charged." | PayPal + AI, Technological Implementation |
| 1:45-2:00 | Item 3 **Waive**, item 1 **Reduce to $17.50**, **Ask Claude to settle**, refund card ($17.50, Claude's reason for the renter), **Approve** | "If staff lower an item after the charge, the code computes the refund. Claude only writes the reason the renter will read." | Technological Implementation |
| 2:00-2:15 | Scroll the right column to **Sandbox evidence** and open it: V5 five charges on one saved token, V7 partial refund, V8 invoice | "These calls ran against the PayPal sandbox: five merchant-initiated charges on one saved token, a partial refund and an invoice, with their ids." | PayPal, Presentation |
| 2:15-2:40 | Header **Fleet dashboard**. Click **Barrel** on the damage map, the other widgets filter. **Edit dashboard**, starter **Recovery by gear**, "Delegated to Page agent", "Delegated to Widget agent", a new bar chart "Net recovered by gear category" appears below the widgets | "The owner's morning screen is AG Studio: a custom damage map that filters every widget, and a Claude agent that asks Studio's widget agent to build a chart. Again a recorded Claude run." | AG Grid prize, Design |
| 2:40-2:48 | Editor: `packages/paypal-vault-tools/tools.js` (six tools) and `server/domain/decisionTable.js` | "Six Vault tools in the Agent Toolkit shape, and a decision table in code. MIT licensed." | Technological Implementation |

Not in the video: the Save PayPal yourself window (the in-app return URL round trip was not completed in V4), the token delete (only the mock answers in the demo), photo sets B and C, the invoice fallback, the dispute watch.

If the host has sandbox keys and a fresh shared token at recording time, the PayPal chips read "sandbox live" instead of "mock"; say "sandbox" in scene 1:10 only then.
