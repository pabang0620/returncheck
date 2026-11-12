#!/usr/bin/env python3
"""Saves one sandbox payment token through the app's own "Save PayPal yourself" flow (sandbox demo mode).

Usage: python3 scripts/save-demo-token.py http://localhost:3495
The server must run in sandbox mode (PayPal keys set, no FORCE_MOCK) with PUBLIC_URL equal to the base URL,
so PayPal's return URL reaches this machine. The buyer logs in in headless Chromium and agrees; PayPal sends
the browser back to /api/s/:sid/token/return, which calls vault_create_payment_token. The new token id is
printed so a person (or this run) can store it as DEMO_VAULT_TOKEN_ID.
Credentials: SANDBOX_BUYER_EMAIL and SANDBOX_BUYER_PASSWORD from the environment only (run it through the
buyer pool script). Nothing secret is printed.
"""
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

from playwright.sync_api import TimeoutError as PlaywrightTimeout
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
EXE = str(Path.home() / ".cache/ms-playwright/chromium-1243/chrome-linux64/chrome")


def api(base, path, method="GET", body=None, headers=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + "/api" + path, data=data, method=method, headers={"content-type": "application/json", **(headers or {})})
    with urllib.request.urlopen(req, timeout=60) as res:
        return json.loads(res.read())["data"]


def main():
    if len(sys.argv) != 2 or not re.fullmatch(r"http://localhost:\d{2,5}", sys.argv[1]):
        sys.exit("Usage: python3 scripts/save-demo-token.py http://localhost:PORT")
    base = sys.argv[1]
    email, password = os.environ.get("SANDBOX_BUYER_EMAIL"), os.environ.get("SANDBOX_BUYER_PASSWORD")
    if not email or not password:
        sys.exit("Run through the buyer pool script: SANDBOX_BUYER_EMAIL / SANDBOX_BUYER_PASSWORD are not set.")
    demo = api(base, "/demo", "POST", {"set": "A"})
    sid, renter = demo["sid"], {"x-renter-key": demo["renterKey"]}
    save = api(base, f"/s/{sid}/token/save", "POST", {}, renter)
    print("setup token", save["setupTokenId"])
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=EXE, headless=True)
        page = browser.new_page()
        try:
            page.goto(save["approveUrl"], wait_until="domcontentloaded")
            mail = page.locator("#email")
            if mail.is_visible(timeout=15000):
                mail.fill(email)
                if page.locator("#btnNext").is_visible():
                    page.locator("#btnNext").click()
                page.locator("#password").fill(password)
                page.locator("#btnLogin").click()
            agree = page.locator("button#consentButton, button[data-testid='consentButton'], button:has-text('Agree and Continue'), button:has-text('Agree & Continue'), button:has-text('Agree'), button:has-text('Continue')").first
            agree.wait_for(timeout=45000)
            agree.click()
            page.wait_for_url(re.compile(r"saved=1"), timeout=60000)
        except PlaywrightTimeout:
            (ROOT / ".scratch").mkdir(exist_ok=True)
            page.screenshot(path=str(ROOT / ".scratch" / "save-demo-token.png"))
            browser.close()
            sys.exit("Buyer approval did not finish; screenshot in .scratch/save-demo-token.png")
        browser.close()
    state = api(base, f"/s/{sid}/state/renter", headers=renter)["state"]
    token = state.get("token") or {}
    print("session", sid)
    print("payment token", token.get("id"), token.get("kind"), token.get("status"))


main()
