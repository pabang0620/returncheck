#!/usr/bin/env python3
"""Walks the judge path in a browser against a server in sandbox demo mode and prints the PayPal ids.

Usage: python3 scripts/sandbox-walk.py http://localhost:3495 <shots dir> [refund]
Charge: Keep 1 and 3, Send link, Accept 1, Contest 3, Ask Claude to settle, Approve (approval card).
With "refund": then Waive 3, Reduce 1, Ask Claude to settle, Approve the refund card.
No buyer login is needed: the charge uses the saved demo token (DEMO_VAULT_TOKEN_ID).
"""
import re
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

EXE = str(Path.home() / ".cache/ms-playwright/chromium-1243/chrome-linux64/chrome")
base, out = sys.argv[1], Path(sys.argv[2])
with_refund = len(sys.argv) > 3 and sys.argv[3] == "refund"
out.mkdir(parents=True, exist_ok=True)
errors = []

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=EXE, headless=True)
    pg = browser.new_page(viewport={"width": 1440, "height": 900})
    pg.on("pageerror", lambda e: errors.append("pageerror " + str(e)[:200]))
    pg.on("response", lambda r: errors.append(f"{r.status} {r.url}") if r.status >= 400 else None)
    pg.goto(base)
    pg.click("text=Try the demo rental")
    pg.wait_for_selector("text=Draft items", timeout=30000)
    pg.locator('[aria-label="Claim item 1"] button:has-text("Keep")').click()
    pg.wait_for_timeout(400)
    pg.locator('[aria-label="Claim item 3"] button:has-text("Keep")').click()
    pg.wait_for_timeout(400)
    pg.click('button:has-text("Send link")')
    pg.wait_for_timeout(600)
    pg.locator('button:has-text("Accept")').first.click()
    pg.wait_for_timeout(400)
    pg.locator('button:has-text("Contest + photo")').first.click()
    pg.wait_for_timeout(300)
    pg.click('button:has-text("Use example note")')
    pg.click('button:has-text("Send contest")')
    pg.wait_for_timeout(600)
    pg.click('button:has-text("Ask Claude to settle")')
    pg.wait_for_selector("text=Not executed until approved", timeout=60000)
    pg.wait_for_timeout(500)
    pg.screenshot(path=str(out / "sb_01_card.png"))
    pg.locator('[aria-label="Approval card"] button:has-text("Approve")').first.click()
    try:
        pg.wait_for_selector(".receipt", timeout=60000)
    except Exception:
        pg.screenshot(path=str(out / "sb_02_failed.png"), full_page=True)
        print("NO RECEIPT", [t for t in pg.locator('[aria-label="Approval card"]').all_inner_texts()])
        sys.exit(2)
    pg.wait_for_timeout(1200)
    pg.screenshot(path=str(out / "sb_02_receipt.png"))
    print("CHARGE", " | ".join(pg.locator(".receipt").first.inner_text().splitlines()[:2]))
    if with_refund:
        pg.locator('[aria-label="Claim item 3"] button:has-text("Waive")').click()
        pg.wait_for_timeout(600)
        pg.locator('[aria-label="Claim item 1"] button:has-text("Reduce to")').click()
        pg.wait_for_timeout(600)
        pg.click('button:has-text("Ask Claude to settle")')
        pg.wait_for_selector("text=Not executed until approved", timeout=60000)
        pg.wait_for_timeout(500)
        pg.screenshot(path=str(out / "sb_03_refund_card.png"))
        pg.locator('[aria-label="Approval card"] button:has-text("Approve")').first.click()
        pg.wait_for_selector("text=/completed on capture/", timeout=90000)
        pg.wait_for_timeout(1200)
        pg.screenshot(path=str(out / "sb_04_refund_done.png"))
        text = pg.locator('[aria-label="Approval card"]').all_inner_texts()
        print("REFUND", [t for t in "\n".join(text).splitlines() if "completed on capture" in t])
        print("HELD CARD", pg.locator('h3:has-text("Held for staff")').count())
    browser.close()

print("ERRORS", sorted(set(errors))[:20])
