"""Walk the README path headless (mock mode) and save fresh screenshots to ../final_shots.

Usage: python3 scripts/design-walk.py http://localhost:3497
"""
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

base = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3497"
out = Path(__file__).resolve().parents[2] / "final_shots"
out.mkdir(exist_ok=True)
errors = []


def shot(pg, name, full=False):
    pg.wait_for_timeout(500)
    pg.screenshot(path=str(out / name), full_page=full)


with sync_playwright() as p:
    exe = next(Path.home().glob(".cache/ms-playwright/chromium_headless_shell-*/*/chrome-headless-shell"), None)
    br = p.chromium.launch(executable_path=str(exe) if exe else None)
    pg = br.new_page(viewport={"width": 1440, "height": 900})
    pg.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    pg.on("console", lambda m: m.type == "error" and errors.append(f"console: {m.text}"))
    pg.goto(base)
    pg.wait_for_selector("text=Try the demo rental")
    shot(pg, "01_home.png")
    pg.click("text=Try the demo rental")
    pg.wait_for_selector("text=Draft items", timeout=30000)
    shot(pg, "02_staff_draft_items.png")
    pg.locator("details.pickup summary").click()
    pg.locator("details.pickup").scroll_into_view_if_needed()
    shot(pg, "03_pickup_screen.png")
    pg.locator("details.pickup summary").click()
    pg.locator('[aria-label="Claim item 1"] button:has-text("Keep")').click()
    pg.wait_for_timeout(300)
    pg.locator('[aria-label="Claim item 3"] button:has-text("Keep")').click()
    pg.wait_for_timeout(300)
    pg.click('button:has-text("Send link")')
    pg.wait_for_selector('button:has-text("Accept")')
    pg.locator('button:has-text("Accept")').first.click()
    pg.wait_for_timeout(300)
    pg.locator('button:has-text("Contest + photo")').first.click()
    pg.click('button:has-text("Use example note")')
    pg.click('button:has-text("Send contest")')
    pg.wait_for_timeout(500)
    pg.evaluate("window.scrollTo(0, 0)")
    shot(pg, "04_renter_answered.png")
    pg.click('button:has-text("Ask Claude to settle")')
    pg.wait_for_selector('[aria-label="Approval card"] button:has-text("Approve")', timeout=30000)
    pg.evaluate("window.scrollTo(0, 0)")
    shot(pg, "05_approval_card.png")
    pg.locator('[aria-label="Approval card"] button:has-text("Approve")').first.click()
    pg.wait_for_selector(".receipt", timeout=30000)
    pg.wait_for_timeout(800)
    shot(pg, "06_receipt.png")
    print("RECEIPT", " | ".join(pg.locator(".receipt").first.inner_text().splitlines()[:2]))
    pg.locator('[aria-label="Claude trace"]').scroll_into_view_if_needed()
    shot(pg, "07_claude_trace.png")
    pg.click('button:has-text("Simulate: renter opens a dispute (mock)")')
    pg.wait_for_timeout(400)
    pg.click('button:has-text("Check PayPal disputes")')
    pg.wait_for_timeout(600)
    pg.locator('[aria-label="Dispute watch"]').scroll_into_view_if_needed()
    shot(pg, "08_dispute_watch.png")
    sid = pg.url.rstrip("/").split("/")[-1]

    # Phone width: what a phone user sees on the staff and renter tabs.
    m = br.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=2)
    m.on("pageerror", lambda e: errors.append(f"mobile pageerror: {e}"))
    m.goto(base)
    shot(m, "m01_home.png")
    m.click("text=Try the demo rental")
    m.wait_for_selector("text=Draft items", timeout=30000)
    shot(m, "m02_staff.png")
    m.locator('[aria-label="Claim item 1"] button:has-text("Keep")').click()
    m.wait_for_timeout(300)
    m.locator('[aria-label="Claim item 3"] button:has-text("Keep")').click()
    m.wait_for_timeout(300)
    m.click('button:has-text("Send link")')
    m.wait_for_timeout(400)
    m.click('[role="tab"]:has-text("Renter")')
    m.wait_for_selector('button:has-text("Accept")')
    shot(m, "m03_renter.png")
    m.locator('button:has-text("Accept")').first.click()
    m.wait_for_timeout(300)
    m.locator('button:has-text("Contest + photo")').first.click()
    m.click('button:has-text("Use example note")')
    m.click('button:has-text("Send contest")')
    m.wait_for_timeout(400)
    m.click('[role="tab"]:has-text("Staff")')
    m.click('button:has-text("Ask Claude to settle")')
    m.wait_for_selector('[aria-label="Approval card"] button:has-text("Approve")', timeout=30000)
    m.evaluate("window.scrollTo(0, 0)")
    shot(m, "m04_approval.png", full=False)
    overflow = m.evaluate("document.documentElement.scrollWidth - window.innerWidth")
    print("MOBILE horizontal overflow px:", overflow)

    # Fleet dashboard (AG Studio) with the session rental, view then edit.
    pg.goto(f"{base}/studio/{sid}")
    pg.wait_for_selector("text=Morning screen", timeout=30000)
    pg.wait_for_timeout(4000)
    shot(pg, "09_studio_view.png")
    pg.click('button:has-text("Edit dashboard")')
    pg.wait_for_timeout(3000)
    shot(pg, "10_studio_edit.png")
    br.close()

print("ERRORS", errors if errors else "none")
