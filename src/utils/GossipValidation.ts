import { warn } from 'console'
import { JoinRequest } from '@shardus/types/build/src/p2p/JoinTypes'
import { P2P } from '@shardus/types'
import * as NodeList from '../p2p/NodeList'
import * as CycleCreator from '../p2p/CycleCreator'
import { nestedCountersInstance } from '../utils/nestedCounters'
import { logFlags } from '../logger'
import * as utils from '../utils'
import { getStandbyNodesInfoMap } from '../p2p/Join/v2'
import * as CycleChain from '../p2p/CycleChain'

interface GossipPayload {
  nodeId?: string
  nodeInfo?: P2P.P2PTypes.Node
  sign?: {
    owner: string
    sig: string
  }
  cycleNumber?: number
}

/**
 * Validate payload structure; ignore gossip not in Q1 or Q2; if original sender, only accept in Q1.
 * @param payload - The gossip payload to validate.
 * @param validationSchema - The schema against which to validate the payload.
 * @param logContext - Contextual log information.
 * @param sender - The sender of the gossip.
 * @returns {boolean} - True if the payload is valid, false otherwise.
 */
export function checkGossipPayload<T extends GossipPayload>(
  payload: T | JoinRequest,
  validationSchema: Record<string, string>,
  logContext: string,
  sender: unknown
): boolean {
  if (!payload) {
    if (logFlags.error) warn(`${logContext}-reject: missing payload`)
    return false
  }

  // Check if the current quarter is either 1 or 2
  if (![1, 2].includes(CycleCreator.currentQuarter)) {
    // count the event if the current quarter is not 1 or 2
    nestedCountersInstance.countEvent('p2p', `${logContext}-reject: not in Q1 or Q2. currentCycle: ${CycleCreator.currentCycle} `)

    // Log warnings if error logging is enabled
    if (logFlags.error) {
      warn(
        `${logContext}-reject: not in Q1 or Q2, currentQuarter: ${CycleCreator.currentQuarter}`
      )
    }
    
    return false
  }

  // Verify if the original sender is known to us
  let signer = null
  if (logContext === 'gossip-unjoin') {
    const nodeIfSelectedLastCycle = CycleChain.newest.joinedConsensors.find(
      (node) => node.publicKey === payload.sign.owner
    )
    if (nodeIfSelectedLastCycle) {
      signer = NodeList.byPubKey.get(payload.sign.owner)
      if (!signer) {
        if (logFlags.error) warn(`${logContext}: Got ${logContext} from standby node that was selected to join, but can't find it in NodeList.byPubKey`)
        return false
      }
    } else {
      signer = getStandbyNodesInfoMap().get(payload.sign.owner)
      if (!signer) {
        if (logFlags.error) warn(`${logContext}: Got ${logContext} from unknown standby node`)
        return false
      }
    }
  } else {
    signer = NodeList.byPubKey.get(payload.sign.owner)
    if (!signer) {
      if (logFlags.error) warn(`${logContext}: Got ${logContext} from unknown node`)
      return false
    }
  }

  // Only accept original transactions in quarter 1
  const isOrig = signer.id === sender
  if (isOrig && CycleCreator.currentQuarter > 1) {
    if (logFlags.error) nestedCountersInstance.countEvent('p2p', `${logContext}-reject: CycleCreator.currentQuarter > 1, currentQuarter: ${CycleCreator.currentQuarter}`)
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
