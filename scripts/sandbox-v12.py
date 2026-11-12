#!/usr/bin/env python3
"""VERIFY V12: two judges on the shared sandbox demo token, in two separate browser contexts.

Usage: python3 scripts/sandbox-v12.py http://localhost:3495 <shots dir>
Judge A charges, then presses "Simulate: I removed ReturnCheck in PayPal" and closes the rental.
Judge B then charges the same shared token. B must still get COMPLETED; the shared token is never deleted
(check it afterwards with scripts/token-status.js).
"""
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

EXE = str(Path.home() / ".cache/ms-playwright/chromium-1243/chrome-linux64/chrome")
base, out = sys.argv[1], Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)
errors = []


def to_receipt(pg, tag):
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
    pg.locator('[aria-label="Approval card"] button:has-text("Approve")').first.click()
    pg.wait_for_selector(".receipt", timeout=90000)
    pg.wait_for_timeout(800)
    pg.screenshot(path=str(out / f"v12_{tag}_receipt.png"))
    print(tag, "CHARGE", " | ".join(pg.locator(".receipt").first.inner_text().splitlines()[:2]))


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=EXE, headless=True)
    judges = {}
    for tag in ("A", "B"):
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append("pageerror " + str(e)[:200]))
        page.on("response", lambda r: errors.append(f"{r.status} {r.url}") if r.status >= 400 else None)
        judges[tag] = page
    a, b = judges["A"], judges["B"]
    to_receipt(a, "A")
    a.click("text=Simulate: I removed ReturnCheck in PayPal")
    a.wait_for_timeout(1000)
    a.click('button:has-text("Close rental and build evidence pack")')
    a.wait_for_selector("text=Evidence pack", timeout=30000)
    print("A token line", a.locator("[aria-label=\"Saved PayPal\"]").first.inner_text()[-60:])
    a.screenshot(path=str(out / "v12_A_revoked_closed.png"))
    to_receipt(b, "B")
    print("B token line", b.locator("[aria-label=\"Saved PayPal\"]").first.inner_text()[-60:])
    browser.close()

print("ERRORS", sorted(set(errors))[:20])
