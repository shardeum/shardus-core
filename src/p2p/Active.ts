import { Logger } from 'log4js'
import * as utils from '../utils'
import * as Comms from './Comms'
import { crypto, logger } from './Context'
import { CycleRecord } from './CycleCreator'
import * as NodeList from './NodeList'
import * as Self from './Self'
import * as Types from './Types'
import { Change } from './CycleParser'

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
  info(`Got active request: ${JSON.stringify(payload)}`)
  // [TODO] Validate input
  if (addActiveRequest(payload)) Comms.sendGossip('gossip-active', payload)
}

const routes = {
  internal: {},
  gossip: {
    'gossip-active': gossipActiveRoute,
  },
}

/** STATE */

let mainLogger: Logger
let activeLogger: Logger

let activeRequests: SignedActiveRequest[]

/** FUNCTIONS */

export function init() {
  // Init logger
  mainLogger = logger.getLogger('main')
  activeLogger = logger.getLogger('active')

  // Init state
  reset()

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

export function sortCycleRecord(record: CycleRecord) {
  record.activated.sort()
  record.activatedPublicKeys.sort()
}

export function dropInvalidTxs(txs: Txs): Txs {
  const active = txs.active.filter(request => validateActiveRequest(request))
  return { active }
}

export function requestActive() {
  const activeRequest = createActiveRequest()
  addActiveRequest(activeRequest)
  info(`Gossiping active request: ${JSON.stringify(activeRequest)}`)
  Comms.sendGossip('gossip-active', activeRequest)
  // [TODO] Make this actully check if it went active and try again if it didn't
}

export function parse(record: CycleRecord): Change {
  // Look at the activated id's and make Self emit 'active' if your own id is there
  // Omar - why is the node setting it self to active as soon as it 
  //    parse is called; should be doing this if we find ourself in
  //    the actived list.
  //    This might be messing up the check for isActive in CycleCreator
  if (record.activated.includes(Self.id)){
    Self.setActive()
    Self.emitter.emit('active', Self.id)
  }

  // For all nodes described by activated, make an update to change their status to active
  const updated = record.activated.map(id => ({
    id,
    activeTimestamp: record.start,
    status: Types.NodeStatus.ACTIVE,
  }))

  return {
    added: [],
    removed: [],
    updated,
  }
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

function info(...msg) {
  const entry = `Active: ${msg.join(' ')}`
  // mainLogger.info(entry)
  // cycleLogger.info(entry)
  console.log('INFO: ' + entry)
}

function warn(...msg) {
  const entry = `Active: ${msg.join(' ')}`
  // mainLogger.warn(entry)
  // cycleLogger.info('WARN: ' + entry)
  console.log('WARN: ' + entry)
}

function error(...msg) {
  const entry = `Active: ${msg.join(' ')}`
  // mainLogger.error(entry)
  // cycleLogger.info('ERROR: ' + entry)
  console.log('ERROR: ' + entry)
}
