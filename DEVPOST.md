# ReturnCheck

**AI can find the scratch; it shouldn't be the one charging.** A camera rental shop saves the renter's PayPal at pickup instead of holding their card. After the return, Claude drafts priced line items from the photos, the renter accepts or contests each, and Claude can only *request* a charge. Staff approve before money moves.

Prizes: Best Use of PayPal + AI, Best Use of AG Grid (AG Studio).

## What it does (the 4-step judge path)

1. **Try the demo rental**: your private copy of rental R-1042. Claude found a top plate scratch (item 1), a barrel mark it traced to the earlier return R-0977 and does not bill (item 2), and a possible mount dent (item 3).
2. **Keep** items 1 and 3, **Send link**. On the renter's phone: **Accept** item 1, contest item 3 ("This is dust, not a dent").
3. **Ask Claude to settle**: Claude holds item 3 and requests a charge for item 1. The server prices it from the rate card ($35.00), not the model: "Not executed until approved".
4. **Approve**: Orders v2 charges the saved token; the card shows the order id, `COMPLETED`, `invoice_id` and the items PayPal returned. A mismatched order is refused.

## Proven in the PayPal sandbox and with the real model

From VERIFY.md (2026-11-12):
- **PayPal sandbox:** setup token (V3); payment token (V4); seven `COMPLETED` charges on saved tokens, two from the approval card (V5); token GET and DELETE (V6, partial); `get_order` and refunds (V7, partial); Toolkit invoice create and send (V8); one shared token charged from two sessions (V12).
- **Real model** (Sonnet via a local Claude Code account, not the hosted API): vision (V9), Studio agent (V10), the recorded agent runs (V13), a 24-pair evaluation (V15, synthetic only).
- **Not run or blocked:** V1, V2 (dashboard settings), V11 (licence key), V14 (dispute), V15 on camera photos, buyer-side removal (V6); `list_transactions` 403 (V7).

## Inspiration

Camera Rentals NYC (CRNYC) will "place a credit card hold for the full value of the rental on Renter's Credit Card, and will release the hold upon return and damage-free inspection" for uninsured renters. Hours are "Monday-Friday, 9:30am-5:30pm", with a "late fee of $40/hr" outside them (https://www.camerarentalsnyc.com/rental-returns-policy/, read 2026-11-12).

For a week-long rental, PayPal's guide says an authorization "is valid for 29 days" and to "capture the payment within the 3-day honor period" (https://developer.paypal.com/docs/checkout/standard/customize/authorization/, read 2026-11-12), and the hold must be sized before anyone knows the damage.

Letting AI bill directly fails too. The Autopian reported a Hertz customer "charged $440 for a scuff on a wheel" after AI scanner inspections, of which a "$125 processing fee with a further $65 administrative fee"; Hertz said "live agents review all flagged damage images" and "Over 97 percent of cars scanned with this technology have not detected any billable damage" (https://www.theautopian.com/customers-outraged-with-hertz-ai-scanners-they-say-automatically-charge-for-questionable-damages/, 2025-07-10). Here the renter can contest each line before any charge.

## Potential impact

**First user:** an independent camera rental counter like CRNYC. **Scale.** We found no public figure for camera rental damage. The closest is car rental: the European Consumer Centres Network received 4,258 car rental cases in 2023, and "Over 20% of car rental cases in 2023 involved alleged damages where the consumer is held responsible for damages they contest causing" (https://www.eccnet.eu/news/largest-number-car-rental-cases-3-years-0, published 2024-12-10).

**For PayPal.**
- Volume: card holds move to PayPal Vault, where "Customers don't have to be present for future transactions" (https://developer.paypal.com/docs/checkout/save-payment-methods/purchase-later/, read 2026-11-12).
- Risk: each charge carries its accepted line items. Seller Protection covers in-person items only when "the buyer paid for the transaction in person by using a PayPal goods and services QR code" (https://www.paypal.com/us/legalhub/paypal/seller-protection, read 2026-11-12), so consent before the charge is the risk control.
- Product: `@paypal/agent-toolkit` 1.11.0 has no Vault tools; `packages/paypal-vault-tools` adds six.

## How we built it

- **PayPal**: Vault v3 tokens, Orders v2 with `payment_source.paypal.vault_id`, Agent Toolkit order, refund, invoice and dispute tools.
- **Claude**: a 13-tool agent loop. Money tools have no amount argument and only create approval cards. Code owns amounts, the model owns "is this mark new" and "charge now or hold", people own approvals. Without a model the app replays seven labelled Sonnet runs through the same executor.
- **AG Studio**: custom widgets (damage map with cross filter, recovery tile, queue), a shared theme, and a "Damage Analyst" agent driving Studio's data and widget agents through our Claude adapter.
- **Built with**: React 19, Vite, Express, zod, `@paypal/agent-toolkit`, Anthropic SDK and Agent SDK, AG Studio. Model: `claude-sonnet-5-5`.

## Honest limits

- Photo set A is AI-generated photorealistic test images (Flow), not real photos: 6 of 6 zones matched in one account-mode Sonnet run, one set, not a detection rate and not real-photo accuracy.
- Demo photos are SVG drawings with hand-written comparisons (labelled seeded).
- The evaluation is synthetic (12 of 12 drawn defects found, 0 of 12 clean pairs flagged), not a rate on camera photos.
- Anthropic says "Claude's coordinate and localization outputs are approximate" and "Do not rely on it to detect fake or synthetic images" (https://platform.claude.com/docs/en/build-with-claude/vision, read 2026-11-12). Staff can drag every box.
- The Vault tools copy the Toolkit shape, not a plug-in. No AG Studio licence key yet, so a watermark shows.

## What's next

1. Run real camera photos (photo set A is AI-generated, so real ones are still open) (`docs/PHOTO_SET_A.md`) through Claude and publish the result, misses included.
2. Offer the six Vault tools to the PayPal Agent Toolkit, keeping money behind a human-approved card.
3. Extend to other check-out and check-in rentals (tools, outdoor gear, cars), one AG Studio page per counter.

## Testing instructions

**Try it:** https://returncheck.35-216-2-121.sslip.io (hosted demo: PayPal sandbox with the shared demo payment token, recorded Claude Sonnet runs, no Anthropic key; no login).

Follow steps 1 to 4 above (in the phone: **Contest + photo**, **Use example note**, **Send contest**), then open the **Fleet dashboard** and click a zone.

Locally: `npm install`, `cp .env.example .env`, `npm run build`, `npm start`, http://localhost:3010 (no PayPal or model calls by default).

From Start, open **View six AI-generated photo comparisons** to inspect the pickup and return images alongside the recorded model findings and shop rates. The top plate in that photo case is SCR-L ($85); illustrated rental A uses SCR-S ($35). Only the rental walkthrough has an approval and charge flow.
