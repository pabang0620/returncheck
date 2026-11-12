<img src="client/public/logo-512.png" width="128" alt="logo" />

# ReturnCheck

**Try it:** https://returncheck.35-216-2-121.sslip.io (hosted demo: PayPal sandbox with the shared demo payment token, recorded Claude Sonnet runs, no Anthropic key; no login).

**AI can find the scratch; it shouldn't be the one charging.** ReturnCheck lets a camera rental shop rent a kit for a week without holding the renter's card. PayPal is saved once at pickup (Vault v3), the renter returns the kit and leaves without waiting for inspection, Claude compares check-out and check-in photos and drafts priced line items with evidence crops, the renter accepts or contests each line from a link, and Claude can only request a charge on the saved PayPal token. The charge runs after staff approval.

Built for the PayPal AI Hackathon 2026. Prizes aimed at: Best Use of PayPal + AI, Best Use of AG Grid (AG Studio).

## What is in the box

- **Judge mode**: one click gives each judge a private copy of rental R-1042 (its own claim id, `invoice_id` and `PayPal-Request-Id`) with a staff screen and the renter's phone side by side. Photos, dates and shop history are seeded. PayPal runs on doubles with the same response shapes unless sandbox keys are set.
- **`packages/paypal-vault-tools`**: the six Vault v3 tools in `@paypal/agent-toolkit` tool shape, with a one-loop example. Local module, not published.
- **Approval-pending money tools**: `request_vault_charge`, `request_refund`, `request_invoice`, `request_token_delete`. They have no amount argument. The server sums the rate card prices, checks the consent limit, the item states and duplicates, and only creates an approval card. Nothing reaches PayPal until staff press Approve.
- **Decision table as code** (`server/domain/decisionTable.js`): code decides allowed actions, amounts, token branch and refund branch. The model decides whether a mark is new (photos plus past returns of the same asset), what to do with an ambiguous zone, and which accepted items to request now versus which contested ones go to staff. People approve every money action.
- **Claude vision comparison** (`server/vision`): request builder for real JPEG/PNG photos (shrunk, `oversized_image: "error"`, boxes mapped back to original pixels). The preloaded photo sets are SVG drawings, so their zone comparisons are seeded results written by hand for those drawings (labelled `seeded`, not model output).
- **Recorded real runs** (`server/demo/recorded-runs/*.json`): seven runs of the agent loop through Claude Sonnet (local Claude Code account, 2026-11-12): inspection of sets A, B, B after the close-up and C, and settlement for the charge, the refund and the invoice fallback. Each file holds the tool calls in order with inputs, the model's text and timings. Without a model the app replays the run whose recorded state matches the session exactly, through the same tool executor, and labels it "Recorded run: Claude Sonnet, 2026-11-12". A state no recording covers runs a rule-based stand-in labelled "Rule-based stand-in (no model)". `npm run record:runs` records missing files again (needs a Claude Code login on the machine; the script sets `LLM_BACKEND=account`, blanks the API key and PayPal keys, and refuses to run otherwise).
- **AG Studio fleet dashboard** (`/studio`): custom widgets (damage map with cross filter, recovery tile, queue), standard grid and charts, a shared theme with the staff app, and a Studio agent ("Damage Analyst") that delegates to the built-in data and widget agents through a Claude adapter we wrote (`server/routes/studioLlm.js`). The adapter was run once against Claude Sonnet through a local Claude Code account (VERIFY V10) and built a bar chart; that session is recorded and replayed when no model is available.
- **Invoice fallback** (plan 6-5): when the saved token is revoked, or with `PAYMENT_MODE=invoice`, Claude can only request an invoice for accepted items; staff approval then runs Toolkit `create_invoice` and `send_invoice`. Charge actions are not offered.

## Run

```bash
npm install
cp .env.example .env        # leave keys empty to run on doubles
npm run build
npm start                   # http://localhost:3010
npm test                    # 66 tests, no network, always on doubles
```

Video recording state: `npm run demo:video` (build, then `FORCE_MOCK=1` on port 3010). See `docs/VIDEO_SCRIPT.md`.

Development: `npm run dev:server` and `npm run dev:client` (Vite on 5180, proxy to 3010).

## Judge walkthrough (steps 1 to 4)

1. **Try the demo rental**. The staff side opens with the draft items from Claude's recorded inspection run: a scratch (item 1), an old barrel mark that Claude found in the earlier return R-0977 and does not bill (item 2), and a possible dent (item 3).
2. Keep and send. Staff side: **Keep** items 1 and 3, **Send link**. In the phone on the right: **Accept** item 1, then **Contest + photo** on item 3, **Use example note** ("This is dust, not a dent"), **Send contest**. Any other note works; the settlement then runs the rule-based stand-in because no recording covers it.
3. **Ask Claude to settle**. Claude (recorded run) holds item 3 for staff and requests a charge for item 1. The approval card says "Not executed until approved".
4. **Approve**. The card shows the PayPal order id, `COMPLETED`, the `invoice_id`, the `PayPal-Request-Id` and the items PayPal returned for the order. The server refuses to record an order whose amount, capture or `invoice_id` differs from what staff approved.

The **Monday pickup** card at the top of the staff side (screen A) shows the six check-out photos with their capture times and the renter step ("Show the renter phone"); **Retake with a file** swaps in a real JPEG or PNG. After a charge, **Dispute watch** lists open PayPal disputes through the Agent Toolkit (`list_disputes`, `get_dispute`) and keeps those on this rental's captures; it is read only, and on the mock gateway a button simulates a dispute so the screen has something to show.

The staff screen has a Claude trace panel with every tool call, its input, result and time offset, and the model's text, labelled "Live", "Recorded run: Claude Sonnet, 2026-11-12" or "Rule-based stand-in (no model)". **Ask Claude to settle** is disabled when there is nothing to request, with the reason under it. Optional: Waive item 3 and close the rental (then open the readable evidence page); Reduce item 1 after the charge, ask Claude again and approve the refund; photo sets B (close-up request) and C (nothing to bill) from the start page; **Save PayPal yourself** to save your own sandbox token, which a later approval card can delete (the shared demo token is never deleted); **Simulate: I removed ReturnCheck in PayPal** to see the invoice fallback; the fleet dashboard from the header link.

## Environment variables

| Name | Default | Meaning |
|---|---|---|
| `PORT`, `PUBLIC_URL` | 3010, localhost | Server port and the URL PayPal returns to |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | empty, `claude-sonnet-5-5` | Empty = recorded real agent runs (or the labelled rule-based stand-in) and seeded comparisons for the drawn photos |
| `LLM_BACKEND` | empty | `account` = local development through the Claude Agent SDK and your Claude Code login (no API key; the key variables are removed from the child process). The staff screen then says "Claude Sonnet (local account)". Ignored when `FORCE_MOCK=1` |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | empty | Sandbox app. Empty = mock PayPal |
| `DEMO_VAULT_TOKEN_ID` | `DEMO-SHARED-TOKEN` | Pre-saved token every judge session may charge but never delete |
| `SANDBOX_BUYER_EMAIL` | empty | Fake sandbox buyer shown to judges |
| `PAYMENT_MODE` | `vault` | `invoice` = plan 6-5 fallback |
| `MAX_SESSIONS`, `SESSION_TTL_MS` | 300, 6 h | Demo session limits |
| `LLM_LIVE_PER_IP_HOUR` | 10 | Live model runs one client IP may start per hour. A run is one user action (inspection, settlement, one Studio prompt), not one tool turn |
| `LLM_LIVE_PER_DAY` | 150 | Live model runs this server starts per day, all visitors together |
| `TRUST_PROXY` | `loopback` | Express `trust proxy` value so the per-IP cap sees the visitor behind nginx |
| `FORCE_MOCK` | unset | `1` ignores all keys |
| `VITE_AG_STUDIO_LICENSE_KEY` | empty | Build-time AG Studio trial key |

When a cap is full, or the model call fails (network, 4xx/5xx, timeout, no credit), the action still completes on the recorded real run for that scene, or on the rule-based stand-in when none matches. The screen says which one and why, for example "Recorded run: Claude Sonnet, 2026-11-12 (live limit reached)". No raw error is shown. The caps live in `server/llm/liveGuard.js`.

## Layout

```
server/domain      claims state machine, rate card, allowed actions, approvals, decision table, locks
server/agent       model tools (13), Claude loop, account loop, recorded-run replay, rule-based stand-in, prompts
server/vision      comparison (live request builder, seeded results for drawn photos), evidence (resize, box mapping, hashes)
server/integrations/gateway.js   Vault tools + Agent Toolkit calls, mock or sandbox
server/demo        sessions (private clone per judge), seeded photos and fleet, recorded-runs/ (real Claude runs)
client/src         staff and renter screens, studio/ (widgets, theme, agent adapter)
packages/paypal-vault-tools      Vault v3 tools in toolkit shape
```

## Evaluation set (24 pairs, synthetic)

`eval/` holds the 24-pair set from the plan: 12 pairs with new damage (6 scratches, 3 dents, 3 front-element marks) and 12 without (4 of them with a mark that was already there at check-out), in two lighting setups. `node eval/generate.js` draws the pairs (600x400 PNG, seeded noise and a small shift between the two shots), `LLM_BACKEND=account node eval/run.js` runs each pair through the same `compareZone()` the app uses and writes `eval/results.json`. Pass `--dir` to run a folder of real pairs named like `D01_before.png` and `D01_after.png`. For one real camera photo set (6 zones, check-out and return), follow `docs/PHOTO_SET_A.md`, drop the files in `photo-sets/A/`, and run `npm run photoset:a`.

Result of one run on 2026-11-12 (account-mode Sonnet through a local Claude Code login, not the hosted API): 12 of 12 damaged pairs found, 0 of 12 clean pairs flagged (including the 4 with an old mark), 12 of 12 boxes contain the drawn defect, 0 uncertain, 0 errors. Rate codes: all 3 dents were `DNT-M`, all 6 scratches were `SCR-L` (the drawn scratches are 110 to 170 px long, so `SCR-S` was never chosen), and only 1 of 3 front-element marks was `LNS-F` (one `MRK-B`, one `SCR-L`). Staff confirm every code before anything is priced.

These are drawings, not camera photos: clean edges, no glare, no texture. The score says the pipeline works end to end on easy input; it says nothing about real lenses. The plan's real-photo pairs are still a person's job, and no detection rate should be quoted from this table.

## Honest limits

- Photo set A (`photo-sets/A/`, `npm run photoset:a`) is AI-generated photorealistic test images (Flow), not real photos. One run, account-mode Sonnet, 2026-11-12: 6 of 6 zones matched what was set up (scratch on the top plate and dent on the lens mount found, 4 clean zones clean, the old barrel mark not flagged), 0 uncertain, 2 of 2 boxes hit; `photo-sets/A/results.json` has every row. This is one set of six zones, not a detection rate, and not accuracy on real photos.

- Vault setup token, payment token, five merchant-initiated charges on one saved token (with and without `stored_credential`), a partial `create_refund`, and Toolkit `create_invoice`/`send_invoice` were run against the PayPal sandbox on 2026-11-12; order and invoice ids are in `VERIFY.md`. The Claude agent loops, the vision request (on two synthetic PNGs) and the Studio agent were run once through a local Claude Code account (Sonnet), not through the hosted API path. The AG Studio licence server has not been contacted. `VERIFY.md` lists the checks and what is still open.
- Seeded photos are drawn SVG pictures (the pickup screen shows the same drawings). Their zone comparisons are written by hand for the drawings, labelled `seeded`; the recorded Claude runs reason over those results. The live Claude comparison ran once on two synthetic PNGs (a drawn line as the scratch), not on real camera photos. JPEG and PNG upload exists (staff, one zone at a time). We make no claim that Claude detects fake or synthetic images, and its box coordinates are approximate (Anthropic: "Claude's coordinate and localization outputs are approximate", https://platform.claude.com/docs/en/build-with-claude/vision), so staff can drag the box.
- The Vault tools copy the shape of the Agent Toolkit tools. They are not a plug-in to a toolkit extension point.
- The saved token may be removed by the payer in PayPal settings. The code then blocks charges and offers an invoice request. PayPal Seller Protection is not expected to cover a charge for damage found after a hand-over: the program covers physical items that can be shipped, and items delivered in person only when paid in person with a PayPal goods and services QR code (https://www.paypal.com/us/legalhub/paypal/seller-protection).
- Without an AG Studio licence key the dashboard runs with a console banner and watermark.
- Dates, history photos and fleet rows are seeded and say so on screen. Only the PayPal calls of your own session are real when sandbox keys are set.

## Testing instructions (for judges)

1. Open the app and press **Try the demo rental** (photo set A opens already inspected).
2. On the staff side press **Keep** on items 1 and 3, then **Send link**. In the phone on the right press **Accept** on item 1, then **Contest + photo** on item 3, **Use example note**, **Send contest**.
3. Press **Ask Claude to settle**. Read the approval card ($35.00 from the rate card, "Not executed until approved").
4. Press **Approve**. The card shows the PayPal order id, `COMPLETED` and the receipt items (labelled mock PayPal unless the host set sandbox keys).
5. Optional: **Waive** item 3, **Reduce** item 1, **Ask Claude to settle**, **Approve** the refund; open the **Fleet dashboard** from the header, click a zone on the damage map, then **Edit dashboard** and the starter **Recovery by gear**. Set B asks for a close-up, set C finds nothing to bill, **Save PayPal yourself** saves your own sandbox token that can be deleted at the end (the demo token is kept for other judges).

## Sandbox demo mode

Mock PayPal stays the default, so the app runs without keys. To run the same judge path against the PayPal sandbox:

1. Put `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` (sandbox app) in `.env`, leave `FORCE_MOCK` unset, and set `PUBLIC_URL` to the address the browser uses.
2. Save one shared demo token through the app's own flow: start the server, then `SANDBOX_BUYER_EMAIL=... SANDBOX_BUYER_PASSWORD=... npm run sandbox:token -- http://localhost:3010` (environment only, never on the command line of a shared shell). It presses Save PayPal yourself, approves as the sandbox buyer and prints the payment token id. Put it in `DEMO_VAULT_TOKEN_ID`.
3. `npm run demo:sandbox`. The staff screen chip reads **PayPal: sandbox live** and each receipt says **PayPal sandbox live**. Charges and refunds go out only from an approved card. The shared token is never deleted; `node scripts/token-status.js` reads it.

`scripts/sandbox-walk.py` and `scripts/sandbox-v12.py` are the browser walks used for VERIFY V5, V7 and V12.

## Sandbox evidence

The same list is in the app (start page and the judge screen, "Sandbox evidence"). From `VERIFY.md`, run on 2026-11-12:

- PASS against the PayPal sandbox: **V3** setup token, **V4** payment token after a buyer approval, then the full in-app Save PayPal flow with the return URL (token 26b352559v815782v, now the shared demo token), **V5** five merchant-initiated charges on one saved token plus two charges through the approval card in sandbox demo mode (orders 33514540Y7394535Y, 1TU36406RD148063R), **V7** two refunds through the approval card (6UR69705YU342344D, 4LH24943GY010174T, `COMPLETED`), **V12** two browser sessions on the shared token (orders 51347753GH389322K, 1KP39390LT369033D; token still active), **V8** Toolkit `create_invoice` and `send_invoice`.
- PARTIAL: **V6** token GET 200, DELETE 204, GET after delete 404 (buyer-side removal not run); **V7** `list_transactions` answered 403, so the app does not use it.
- PASS with the real model through a local Claude Code account (not the hosted API): **V13** agent loops (the recorded runs), **V10** Studio agent, **V9** vision on two synthetic PNGs.
- Not run: V1, V2, V11, V14, and V15 with real camera photos (photo set A is AI-generated, not real photos).

## License

MIT, see `LICENSE`.

From Start, open **View six AI-generated photo comparisons** to inspect the pickup and return images alongside the recorded model findings and shop rates. The top plate in that photo case is SCR-L ($85); illustrated rental A uses SCR-S ($35). Only the rental walkthrough has an approval and charge flow.
