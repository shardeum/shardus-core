import { isDebugMode } from '../debug'

export const isDebugModeMiddleware = (_req, res, next) => {
  const isDebug = isDebugMode()

  if (!isDebug) {
    return res.status(403).json({
      status: 403,
      message: 'FORBIDDEN. Endpoint is only available in debug mode.'
    })
  }

  next()
}
