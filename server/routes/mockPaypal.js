import express from 'express'

// Stand-in for the PayPal approval screen when no sandbox keys are set. Same flow: approve, then PayPal
// sends the payer back to the return_url with the setup token id.
export function mockPaypalRouter() {
  const router = express.Router()
  const esc = (s) => String(s).replace(/[^A-Za-z0-9_-]/g, '')
  router.get('/approve', (req, res) => {
    const sid = esc(req.query.sid)
    const setup = esc(req.query.setup)
    res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PayPal sandbox (mock)</title>
<style>body{font-family:Inter,Arial,sans-serif;background:#F6F4EF;color:#1F2328;display:grid;place-items:center;min-height:100vh;margin:0}main{background:#fff;border:1px solid #ddd;border-radius:12px;padding:24px;max-width:420px;margin:16px}a.btn{display:block;text-align:center;background:#C2410C;color:#fff;padding:12px;border-radius:8px;text-decoration:none;margin-top:16px}p{line-height:1.5}small{color:#666}</style></head>
<body><main><h1>Mock PayPal approval</h1><p>ReturnCheck asks to save PayPal for rental R-1042 only. It will charge damage items you accept, up to $300, after your review.</p><a class="btn" href="/api/s/${sid}/token/return?setup=${setup}">Agree and save</a><p><small>This page imitates the PayPal approval screen. No PayPal account is used.</small></p></main></body></html>`)
  })
  return router
}
