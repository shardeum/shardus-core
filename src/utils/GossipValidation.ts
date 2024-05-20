import { warn } from 'console'
import { JoinRequest } from '@shardus/types/build/src/p2p/JoinTypes'
import { P2P } from '@shardus/types'
import * as NodeList from '../p2p/NodeList'
import * as CycleCreator from '../p2p/CycleCreator'
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

// Validate the payload of a gossip message that contains a sign object and check if the node is in Q1 or Q2
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

  // Verify if the original sender is correct and if the transaction is in quarter 1
  const signer = NodeList.byPubKey.get(payload.sign.owner)
  if (!signer) {
    if (logFlags.error) warn(`${logContext}: Got ${logContext} from unknown node`)
    return true
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