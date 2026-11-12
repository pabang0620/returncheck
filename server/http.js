import { z } from 'zod'

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message)
    this.status = status
    this.extra = extra
  }
}

export function parse(schema, data) {
  const result = schema.safeParse(data)
  if (!result.success) {
    throw new HttpError(400, result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '))
  }
  return result.data
}

export const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)

// Central error handler: every route passes errors with next(err).
export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err)
  if (err instanceof HttpError) return res.status(err.status).json({ success: false, message: err.message, ...err.extra })
  if (err?.type === 'entity.parse.failed' || err?.type === 'entity.too.large') return res.status(400).json({ success: false, message: 'Invalid request body.' })
  console.error('Unhandled error:', err)
  return res.status(500).json({ success: false, message: 'Unexpected server error.' })
}
