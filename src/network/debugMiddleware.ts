import { isDebugMode, getDevPublicKeys, ensureKeySecurity } from '../debug';
import * as Context from '../p2p/Context';
import * as crypto from '@shardus/crypto-utils';
import { DevSecurityLevel } from '../shardus/shardus-types';
import SERVER_CONFIG from '../config/server';
import { logFlags } from '../logger';
import { nestedCountersInstance } from '../utils/nestedCounters';
import { Utils } from '@shardus/types';

const MAX_COUNTER_BUFFER_MILLISECONDS = 10000;
let lastCounter = 0;
let multiSigLstCounter = 0;

// This function is used to check if the request is authorized to access the debug endpoint
function handleDebugAuth(_req, res, next, authLevel) {
  try {
    //auth with a signature
    if (_req.query.sig != null && _req.query.sig_counter != null) {
      const devPublicKeys = getDevPublicKeys(); // This should return list of public keys
      const requestSig = _req.query.sig;
      // Check if signature is valid for any of the public keys
      for (const ownerPk in devPublicKeys) {
        let sigObj = {
          route: _req.route.path,
          count: String(_req.query.sig_counter),
          sign: { owner: ownerPk, sig: requestSig },
        };
        //reguire a larger counter than before. This prevents replay attacks
        const currentCounter = parseInt(sigObj.count);
        const currentTime = new Date().getTime();
        if (currentCounter > lastCounter && currentCounter <= currentTime + MAX_COUNTER_BUFFER_MILLISECONDS) {
          let verified = Context.crypto.verify(sigObj, ownerPk);
          if (verified === true) {
            const authorized = ensureKeySecurity(ownerPk, authLevel);
            if (authorized) {
              lastCounter = currentCounter;
              next();
              return;
            } else {
              /* prettier-ignore */ if (logFlags.verbose) console.log('Authorization failed for security level', authLevel)
              /* prettier-ignore */ nestedCountersInstance.countEvent( 'security', 'Authorization failed for security level: ', authLevel )
              return res.status(403).json({
                status: 403,
                message: 'FORBIDDEN!',
              });
            }
          } else {
            /* prettier-ignore */ if (logFlags.verbose) console.log('Signature is not correct')
          }
        } else {
          if (logFlags.verbose) {
            const parsedCounter = parseInt(sigObj.count);
            if (Number.isNaN(parsedCounter)) {
              console.log('Counter is not a number');
            } else {
              console.log('Counter is not larger than last counter', parsedCounter, lastCounter);
            }
          }
        }
      }
    }
  } catch (error) {
    /* prettier-ignore */ if (logFlags.verbose) console.log('Error in handleDebugAuth:', error)
    nestedCountersInstance.countEvent('security', 'debug unauthorized failure - exception caught');
  }

  return res.status(401).json({
    status: 401,
    message: 'Unauthorized!',
  });
}

function handleMultiDebugAuth(_req, res, next) {
  try {
    //auth with a signature
    if (_req.query.proposal != null && _req.query.sig != null && _req.query.sig_counter != null) {
      const devPublicKeys = getDevPublicKeys(); // This should return list of public keys

      // Parse the proposal and signatures from the query parameters
      const parsedProposal = Utils.safeJsonParse(_req.query.proposal);
      const parsedSignatures = Utils.safeJsonParse(_req.query.sig);

      // Verify the signatures against the proposal
      let allSignaturesValid = false;
      let signatureValid = false;

      const minApprovals = Math.max(2, SERVER_CONFIG.debug.minApprovalsMultiAuth);

      if (parsedProposal.noOfApprovals < minApprovals) {
        return res.status(401).json({
          status: 401,
          message: 'Unauthorized!',
        });
      }
      // Require a larger counter than before. This prevents replay attacks
      if (
        parseInt(_req.query.sig_counter) > multiSigLstCounter &&
        parsedSignatures.length >= parsedProposal.noOfApprovals
      ) {
        let validSignaturesCount = 0;
        for (let i = 0; i < parsedSignatures.length; i++) {
          // Check each signature against all public keys
          for (const publicKey of Object.keys(devPublicKeys)) {
            signatureValid = crypto.verify(crypto.hashObj(parsedProposal), parsedSignatures[i], publicKey);
            if (signatureValid) {
              const clearanceLevels = { low: 1, medium: 2, high: 3 }; // Enum for security levels
              const proposalClearanceLevel = clearanceLevels[parsedProposal.securityClearance.toLowerCase()];
              const authorized = ensureKeySecurity(publicKey, proposalClearanceLevel); // Check if the approver is authorized to access the endpoint
              if (authorized) {
                validSignaturesCount++; // Increment only if signature is valid and authorized
                break; // Break if a valid and authorized signature is found
              } else {
                return res.status(401).json({
                  status: 401,
                  message: 'Unauthorized!',
                });
              }
            }
          }
          if (!signatureValid) {
            allSignaturesValid = false;
            console.log(`Invalid signature : ${parsedSignatures[i]}`);
            break; // Break the loop if an invalid signature is found
          }
        }
        // Set allSignaturesValid to true only if all signatures are valid and authorized
        allSignaturesValid = validSignaturesCount >= parsedProposal.noOfApprovals;

        // If all signatures are valid, proceed with the next middleware
        if (allSignaturesValid) {
          multiSigLstCounter = parseInt(_req.query.sig_counter);
          next();
        } else {
          return res.status(401).json({
            status: 401,
            message: 'Unauthorized! Invalid signatures.',
          });
        }
      } else {
        console.log('Counter is not larger than last counter', _req.query.sig_counter, multiSigLstCounter);
      }
    }
  } catch (error) {
    console.log(error);
  }
  return res.status(403).json({
    status: 403,
    message: 'FORBIDDEN. Endpoint is only available in debug mode.',
  });
}

//Secury Levels: Unauthorized = 0, Low=1, Medium=2, High=3

// Alias for isDebugModeMiddlewareHigh
export const isDebugModeMiddleware = (_req, res, next) => {
  isDebugModeMiddlewareHigh(_req, res, next);
};

// Middleware for low security level
export const isDebugModeMiddlewareLow = (_req, res, next) => {
  const isDebug = isDebugMode();
  if (!isDebug) {
    handleDebugAuth(_req, res, next, DevSecurityLevel.Low);
  } else next();
};

// Middleware for medium security level
export const isDebugModeMiddlewareMedium = (_req, res, next) => {
  const isDebug = isDebugMode();
  if (!isDebug) {
    handleDebugAuth(_req, res, next, DevSecurityLevel.Medium);
  } else next();
};

// Middleware for high security level
export const isDebugModeMiddlewareHigh = (_req, res, next) => {
  const isDebug = isDebugMode();
  if (!isDebug) {
    handleDebugAuth(_req, res, next, DevSecurityLevel.High);
  } else next();
};

export const isDebugModeMiddlewareMultiSig = (_req, res, next) => {
  const isDebug = isDebugMode();
  console.log('isDebugModeMiddlewareMultiSig', isDebug);
  if (!isDebug) {
    handleMultiDebugAuth(_req, res, next);
  } else next();
};
