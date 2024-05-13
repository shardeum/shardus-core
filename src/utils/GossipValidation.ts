import { warn } from 'console'
import { JoinRequest } from '@shardus/types/build/src/p2p/JoinTypes'
import { P2P } from '@shardus/types'
import * as NodeList from '../p2p/NodeList'
import * as CycleCreator from '../p2p/CycleCreator'
import { config } from '../p2p/Context'
import { nestedCountersInstance } from '../utils/nestedCounters'
import { logFlags } from '../logger'
import * as utils from '../utils'

interface GossipPayload {
  nodeId?: string
  nodeInfo?: P2P.P2PTypes.Node
  sign?: {
    owner: string
    sig: string
  }
  cycleNumber?: number
}

// Check if an object is a JoinRequest
function isJoinRequest(payload: GossipPayload | JoinRequest): payload is JoinRequest {
  return payload && typeof payload === 'object' && 'nodeInfo' in payload && 'publicKey' in payload.nodeInfo
}

// Validate the payload of a gossip message that contains a sign object and check if the node is in Q1 or Q2
export function checkGossipPayload<T extends GossipPayload>(
  payload: T | JoinRequest,
  validationSchema: Record<string, string>,
  logContext: string
): boolean {
  if (!payload) {
    if (logFlags.error) warn(`${logContext}-reject: missing payload`)
    return false
  }

  // Check if the current quarter is either 1 or 2
  if (![1, 2].includes(CycleCreator.currentQuarter)) {
    // count the event if the current quarter is not 1 or 2
    nestedCountersInstance.countEvent('p2p', `${logContext}-reject: not in Q1 or Q2. currentCycle: ${CycleCreator.currentCycle} `)

    const isJoinReq = isJoinRequest(payload)

    // Handle the case where the payload is a JoinRequest
    if (isJoinReq) {
      // Log debug information if enabled and the payload is a JoinRequest
      if (config.debug.cycleRecordOOSDebugLogs) {
        console.log(
          `DEBUG CR-OOS: ${logContext}-reject: not in Q1 or Q2 currentQuarter: ${
            CycleCreator.currentQuarter
          } payload publicKey: ${payload.nodeInfo.publicKey || undefined}`
        )
      }
    }
    // Handle the case where the payload is not a JoinRequest
    else if (!isJoinReq && config.debug.cycleRecordOOSDebugLogs) {
      console.log(
        `DEBUG CR-OOS: ${logContext}-reject: not in Q1 or Q2 currentQuarter: ${
          CycleCreator.currentQuarter
        } payload id: ${(payload as GossipPayload).nodeId || undefined} payload cycle: ${
          (payload as GossipPayload).cycleNumber || undefined
        }`
      )
    }
    // Log warnings if error logging is enabled
    if (logFlags.error) {
      if (isJoinRequest(payload)) {
        warn(
          `${logContext}-reject: not in Q1 or Q2 currentQuarter: ${
            CycleCreator.currentQuarter
          } payload publicKey: ${payload.nodeInfo.publicKey || undefined}`
        )
      } else {
        warn(
          `${logContext}-reject: not in Q1 or Q2 currentQuarter: ${CycleCreator.currentQuarter} payload id: ${
            (payload as GossipPayload).nodeId || undefined
          } payload cycle: ${(payload as GossipPayload).cycleNumber || undefined}`
        )
      }
    }
    return false
  }

  let err = utils.validateTypes(payload, validationSchema)
  if (err) {
    if (logFlags.error) warn(`${logContext}-reject: bad input ${err}`)
    return false
  }

  // If 'sign' is part of the schema, validate its structure
  if (validationSchema.sign) {
    err = utils.validateTypes(payload.sign, {
      owner: 's',
      sig: 's',
    })
    if (err) {
      if (logFlags.error) warn(`${logContext}-reject: bad input sign ${err}`)
      return false
    }
  } else {
    if (logFlags.error) warn(`${logContext}-reject: missing sign`)
    return false
  }

  return true
}

// If signer is original sender, check if in Q1 to continue
export function verifyOriginalSenderAndQuarter(
  payload: GossipPayload | JoinRequest,
  sender: string,
  context: string
): boolean {
  const signer = NodeList.byPubKey.get(payload.sign.owner)
  // if no signer warn and continue by returning true
  if (!signer) {
    /* prettier-ignore */ if (logFlags.error) warn(`${context}: Got ${context} from unknown node`);
    return true
  }

  const isOrig = signer.id === sender

  // Only accept original transactions in quarter 1
  if (isOrig && CycleCreator.currentQuarter > 1) {
    /* prettier-ignore */ nestedCountersInstance.countEvent('p2p', `${context}-reject: CycleCreator.currentQuarter > 1 ${CycleCreator.currentQuarter}`);
    return false
  }

  return true
}
