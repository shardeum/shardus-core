import { isDebugMode, getHashedDevKey, getDevPublicKeys, ensureKeySecurity } from '../debug'
import * as Context from '../p2p/Context'
import { DevSecurityLevel } from '../shardus/shardus-types'

let lastCounter = 0

// This function is used to check if the request is authorized to access the debug endpoint
function handleDebugAuth(_req, res, next, authLevel) {
  try {
    //auth with a signature
    if (_req.query.sig != null && _req.query.sig_counter != null) {
      const devPublicKeys = getDevPublicKeys() // This should return list of public keys
      const requestSig = _req.query.sig
      // Check if signature is valid for any of the public keys
      for (const ownerPk in devPublicKeys) {
        let sigObj = {
          route: _req.route.path,
          count: String(_req.query.sig_counter),
          sign: { owner: ownerPk, sig: requestSig },
        }
        //reguire a larger counter than before. This prevents replay attacks
        if (parseInt(sigObj.count) > lastCounter) {
          let verified = Context.crypto.verify(sigObj, ownerPk)
          if (verified === true) {
            lastCounter = parseInt(sigObj.count) // Update counter
            const authorized = ensureKeySecurity(ownerPk, authLevel)
            if (authorized) {
              next()
              return
            } else {
              return res.status(403).json({
                status: 403,
                message: 'FORBIDDEN!',
              })
            }
          } else {
            console.log('Signature is not correct', sigObj, lastCounter)
          }
        } else {
          console.log('Counter is not larger than last counter', sigObj.count, lastCounter)
        }
      }
    }
  } catch (error) {}
  return res.status(401).json({
    status: 401,
    message: 'Unauthorized!',
  })
}

//Secury Levels: Unauthorized = 0, Low=1, Medium=2, High=3

// Alias for isDebugModeMiddlewareHigh
export const isDebugModeMiddleware = (_req, res, next) => {
  isDebugModeMiddlewareHigh(_req, res, next)
}

// Middleware for low security level
export const isDebugModeMiddlewareLow = (_req, res, next) => {
  const isDebug = isDebugMode()
  if (!isDebug) {
    handleDebugAuth(_req, res, next, DevSecurityLevel.Low)
  } else next()
}

// Middleware for medium security level
export const isDebugModeMiddlewareMedium = (_req, res, next) => {
  const isDebug = isDebugMode()
  if (!isDebug) {
    handleDebugAuth(_req, res, next, DevSecurityLevel.Medium)
  } else next()
}

// Middleware for high security level
export const isDebugModeMiddlewareHigh = (_req, res, next) => {
  const isDebug = isDebugMode()
  if (!isDebug) {
    handleDebugAuth(_req, res, next, DevSecurityLevel.High)
  } else next()
}
