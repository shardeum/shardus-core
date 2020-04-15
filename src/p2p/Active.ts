import { Logger } from 'log4js'
import * as utils from '../utils'
import * as Comms from './Comms'
import { crypto, logger } from './Context'
import { CycleRecord } from './CycleCreator'
import * as NodeList from './NodeList'
import * as Self from './Self'
import * as Types from './Types'

/** TYPES */

export interface ActiveRequest {
  nodeId: string
  status: string
  timestamp: number
}

export type SignedActiveRequest = ActiveRequest & Types.SignedObject

export interface Txs {
  active: SignedActiveRequest[]
}

export interface Record {
  active: number
  activated: string[]
  activatedPublicKeys: string[]
}

/** ROUTES */

const gossipActiveRoute: Types.GossipHandler<SignedActiveRequest> = payload => {
  // [TODO] Validate input
  if (addActiveRequest(payload)) Comms.sendGossipIn('gossip-active', payload)
}

const routes = {
  internal: {},
  gossip: {
    'gossip-active': gossipActiveRoute,
  },
}

/** STATE */

let mainLogger: Logger

let activeRequests: SignedActiveRequest[] = []

/** FUNCTIONS */

export function init() {
  // Init logger
  mainLogger = logger.getLogger('main')

  // Register routes
  for (const [name, handler] of Object.entries(routes.internal)) {
    Comms.registerInternal(name, handler)
  }
  for (const [name, handler] of Object.entries(routes.gossip)) {
    Comms.registerGossipHandler(name, handler)
  }
}

export function reset() {
  activeRequests = []
}

export function getCycleTxs(): Txs {
  return {
    active: activeRequests,
  }
}

export function updateCycleRecord(
  txs: Txs,
  record: CycleRecord,
  prev: CycleRecord
) {
  const active = NodeList.activeByIdOrder.length
  const activated = []
  const activatedPublicKeys = []

  for (const request of txs.active) {
    const publicKey = request.sign.owner
    const node = NodeList.byPubKey.get(publicKey)
    if (node) {
      activated.push(node.id)
      activatedPublicKeys.push(node.publicKey)
    }
  }

  if (!record.active) record.active = prev ? prev.active : 0
  record.active = active
  record.activated = activated
  record.activatedPublicKeys = activatedPublicKeys
}

export function dropInvalidTxs(txs: Txs): Txs {
  const active = txs.active.filter(request => validateActiveRequest(request))
  return { active }
}

export function goActive() {
  const activeRequest = createActiveRequest()
  addActiveRequest(activeRequest)
  Comms.sendGossipIn('gossip-active', activeRequest)
}

/** HELPER FUNCTIONS */

function createActiveRequest(): SignedActiveRequest {
  const request = {
    nodeId: Self.id,
    status: 'active',
    timestamp: utils.getTime(),
  }
  return crypto.sign(request)
}

function addActiveRequest(request: SignedActiveRequest) {
  if (!validateActiveRequest(request)) return false
  if (!request) return false

  activeRequests.push(request)
  return true
}

function validateActiveRequest(request: SignedActiveRequest) {
  // [TODO] Validate active request
  return true
}
