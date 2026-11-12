import express from 'express'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config, modes } from './config.js'
import { createGateway } from './integrations/gateway.js'
import { createApi } from './routes/index.js'
import { mockPaypalRouter } from './routes/mockPaypal.js'
import { errorHandler } from './http.js'

const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist')

// The port the server really listens on; PUBLIC_URL is only named when it is a different address (proxy, tunnel).
export function startupLine(port, publicUrl) {
  const local = `http://localhost:${port}`
  return publicUrl && publicUrl !== local ? `ReturnCheck listening on ${local} (public URL ${publicUrl})` : `ReturnCheck listening on ${local}`
}

export async function createApp() {
  const gateway = await createGateway({ config })
  gateway.seedDemoToken(config.demoTokenId)
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', /^\d+$/.test(config.trustProxy) ? Number(config.trustProxy) : config.trustProxy)
  // The Studio proxy carries whole agent conversations (60 kB and more) and sets its own larger limit.
  const json = express.json({ limit: '50kb' })
  app.use((req, res, next) => (/^\/api\/(studio\/|s\/[^/]+\/photos\/)/.test(req.path) ? next() : json(req, res, next)))
  app.use('/api', createApi(gateway))
  if (gateway.mode === 'mock') app.use('/mock-paypal', mockPaypalRouter())
  if (existsSync(distDir)) {
    app.use(express.static(distDir))
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) return next()
      res.sendFile(path.join(distDir, 'index.html'))
    })
  }
  app.use(errorHandler)
  return { app, gateway }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { app } = await createApp()
  const server = app.listen(config.port, () => {
    console.log(startupLine(server.address().port, config.publicUrl))
    console.log(`Modes: Claude=${modes.llm} PayPal=${modes.paypal}`)
  })
}
