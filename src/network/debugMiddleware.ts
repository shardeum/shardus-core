import { isDebugMode, getDevPublicKeys, ensureKeySecurity, getMultisigPublicKeys } from '../debug'
import * as Context from '../p2p/Context'
import * as crypto from '@shardus/crypto-utils'
import { DevSecurityLevel } from '../shardus/shardus-types'
import SERVER_CONFIG from '../config/server'
import { logFlags } from '../logger'
import { nestedCountersInstance } from '../utils/nestedCounters'
import { Utils } from '@shardus/types'
import { SignedObject } from '@shardus/crypto-utils'
import * as CycleChain from '../p2p/CycleChain'

const MAX_COUNTER_BUFFER_MILLISECONDS = 10000 // <- Nonce are essentially just timestamp. This number dictate how much time range we will tolerance.
let lastCounter = Date.now() // <- when node is first load onto mem this used to be 0, but that would cause a replay attack. So now it is set to the current time with ntp offset accounted
let multiSigLstCounter = Date.now()

// This function is used to check if the request is authorized to access the debug endpoint
function handleDebugAuth(_req, res, next, authLevel) {
  try {
    //auth with a signature
    if (_req.query.sig != null && _req.query.sig_counter != null) {
      const nodes = String(_req.query.nodeIds).split(',')
      const ourNodeId = Context.p2p.getNodeId().slice(0, 4)
      let intentedForOurNode = false
      nodes.forEach((id) => {
        if (ourNodeId === id) {
          intentedForOurNode = true
        }
      })
      if (!intentedForOurNode) {
        return res.status(401).json({
          status: 401,
          message: 'Unauthorized!',
        })
      }

      // trim sig and sig_counter from the originalUrl
      // when the debug call is signed it include the hash of baseurl and counter to prevent replay at later time and replay at different node or the same endpoint different query params
      let payload = {
        route: stripQueryParams(_req.originalUrl, ['sig', 'sig_counter', 'nodeIds']), //<- we're gonna hash, these query artificats need to be excluded from the hash
        count: _req.query.sig_counter,
        nodes: _req.query.nodeIds, // example 8f35,8b3a,85f1
        networkId: CycleChain.newest.networkId,
        cycleCounter: CycleChain.newest.counter,
      }
      const hash = crypto.hash(Utils.safeStringify(payload))
      const devPublicKeys = getDevPublicKeys() // This should return list of public keys
      const requestSig = _req.query.sig
      // Check if signature is valid for any of the public keys
      for (const ownerPk in devPublicKeys) {
        const sign = { owner: ownerPk, sig: requestSig }
        const hashIncluded = {
          route: payload.route,
          count: payload.count,
          nodes: payload.nodes,
          networkId: payload.networkId,
          cycleCounter: payload.cycleCounter,
          requestHash: hash,
          sign,
        } as SignedObject

        //reguire a larger counter than before. This prevents replay attacks
        const currentCounter = parseInt(payload.count)
        const currentTime = Date.now()
        if (currentCounter > lastCounter && currentCounter <= currentTime + MAX_COUNTER_BUFFER_MILLISECONDS) {
          let verified = Context.crypto.verify(hashIncluded, hashIncluded.sign.owner)
          if (verified === true) {
            const authorized = ensureKeySecurity(ownerPk, authLevel)
            if (authorized) {
              lastCounter = currentCounter
              next()
              return
            } else {
              /* prettier-ignore */ if (logFlags.verbose) console.log('Authorization failed for security level', authLevel)
              /* prettier-ignore */ nestedCountersInstance.countEvent( 'security', 'Authorization failed for security level: ', authLevel )
              return res.status(403).json({
                status: 403,
                message: 'FORBIDDEN!',
              })
            }
          } else {
            /* prettier-ignore */ if (logFlags.verbose) console.log('Signature is not correct')
          }
        } else {
          if (logFlags.verbose) {
            const parsedCounter = parseInt(hashIncluded.count)
            if (Number.isNaN(parsedCounter)) {
              console.log('Counter is not a number')
            } else {
              console.log('Counter is not larger than last counter', parsedCounter, lastCounter)
            }
          }
        }
      }
    }
  } catch (error) {
    /* prettier-ignore */ if (logFlags.verbose) console.log('Error in handleDebugAuth:', error)
    nestedCountersInstance.countEvent('security', 'debug unauthorized failure - exception caught')
  }

  return res.status(401).json({
    status: 401,
    message: 'Unauthorized!',
  })
}

function handleDebugMultiSigAuth(_req, res, next, authLevel: DevSecurityLevel) {
  nestedCountersInstance.countEvent('middleware', 'debug_multi_sig_auth')
  try {
    //auth with a signature
    if (_req.query.sig != null && _req.query.sig_counter != null) {
      const devPublicKeys = getMultisigPublicKeys()

      let parsedSignatures = Utils.safeJsonParse(_req.query.sig)

      if (!parsedSignatures || Array.isArray(parsedSignatures) === false) {
        return res.status(400).json({
          status: 400,
          message: 'Bad Request!',
        })
      }

      const nodes = String(_req.query.nodeIds).split(',')
      const ourNodeId = Context.p2p.getNodeId().slice(0, 4)
      let intentedForOurNode = false
      nodes.forEach((id) => {
        if (ourNodeId === id) {
          intentedForOurNode = true
        }
      })
      if (!intentedForOurNode) {
        return res.status(401).json({
          status: 401,
          message: 'Unauthorized!',
        })
      }

      // Check if parsed signatures exceed the number of developer public keys
      if (parsedSignatures.length > devPublicKeys.length) {
        return res.status(400).json({
          status: 400,
          message: 'Bad Request! Too many signatures.',
        })
      }

      // Remove duplicates from parsedSignatures
      parsedSignatures = Array.from(new Set(parsedSignatures))

      const minApprovals = Math.max(1, SERVER_CONFIG.debug.minMultiSigRequiredForEndpoints)

      if (parsedSignatures.length < minApprovals) {
        return res.status(400).json({
          status: 400,
          message: 'Bad Request! Not enough signatures.',
        })
      }

      // when the debug call is signed it include the counter to prevent replay at later time and replay at different node or the same endpoint different query params
      const payload: any = {
        route: stripQueryParams(_req.originalUrl, ['sig', 'sig_counter', 'nodeIds']),
        nodes: _req.query.nodeIds, // example 8f35,8b3a,85f1
        count: _req.query.sig_counter,
        networkId: CycleChain.newest.networkId,
      }

      // Require a larger counter than before. This prevents replay attacks
      if (parseInt(_req.query.sig_counter) > multiSigLstCounter && parsedSignatures.length >= minApprovals) {
        const signaturesValid = Context.stateManager.app.verifyMultiSigs(
          payload,
          parsedSignatures,
          devPublicKeys,
          minApprovals,
          authLevel
        )

        // If all signatures are valid, proceed with the next middleware
        if (signaturesValid) {
          multiSigLstCounter = parseInt(_req.query.sig_counter)
          next()
          return
        } else {
          return res.status(401).json({
            status: 401,
            message: 'Unauthorized! Invalid signatures.',
          })
        }
      } else {
        console.log('Counter is not larger than last counter', _req.query.sig_counter, multiSigLstCounter)
      }
    }
  } catch (error) {
    if (logFlags.verbose && logFlags.console) console.log('Error in handleDebugMultiSigAuth:', error)
    console.log(error)
  }
  nestedCountersInstance.countEvent('middleware', 'debug_multi_sig_auth failure')
  return res.status(403).json({
    status: 403,
    message: 'FORBIDDEN. Endpoint is only available in debug mode in addtion to signature verification.',
  })
}

function stripQueryParams(url: string, params: string[]) {
  // Split the URL into the base and the query string
  let [base, queryString] = url.split('?')

  // If there's no query string, return the base URL
  if (!queryString) return url

  // Split the query string into individual key-value pairs
  let queryParams = queryString.split('&')

  // Filter out the parameters that are not in the params array
  queryParams = queryParams.filter((param) => {
    let [key, value] = param.split('=')
    return !params.includes(key)
  })

  // Join the filtered parameters back into a query string
  queryString = queryParams.join('&')

  // If there are no parameters left, return the base URL
  if (queryString === '') return base

  // Otherwise, return the base URL with the filtered query string
  return `${base}?${queryString}`
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

export const isDebugModeMiddlewareMultiSig = (_req, res, next) => {
  const isDebug = isDebugMode()
  if (!isDebug) {
    handleDebugMultiSigAuth(_req, res, next, DevSecurityLevel.High)
  } else next()
}

export const isDebugModeMiddlewareMultiSigHigh = (_req, res, next) => {
  const isDebug = isDebugMode()
  if (!isDebug) {
    handleDebugMultiSigAuth(_req, res, next, DevSecurityLevel.High)
  } else next()
}

export const isDebugModeMiddlewareMultiSigMedium = (_req, res, next) => {
  const isDebug = isDebugMode()
  if (!isDebug) {
    handleDebugMultiSigAuth(_req, res, next, DevSecurityLevel.Medium)
  } else next()
}

export const isDebugModeMiddlewareMultiSigLow = (_req, res, next) => {
  const isDebug = isDebugMode()
  if (!isDebug) {
    handleDebugMultiSigAuth(_req, res, next, DevSecurityLevel.Low)
  } else next()
}
