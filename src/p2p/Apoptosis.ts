/*
Nodes can chose to exit the network at anytime. This can happen if
a node gets in a bad state or the process is being stopped. When a node
is about to exit the network, it should send a message to let other
nodes know that it is leaving. This allows other nodes to remove the
exiting node quickly from their node list. Otherwise, they would have to
spend a few cycles to discover that the node was lost remove it
from the node list.
The exiting node sends the Apoptosis message to about 3 other active
nodes. The message can be sent at anytime and does not have to be
sent during quarter 1 as with most other messages. This message is sent
on the internal route and is accepted by other nodes based on verifying
that the sending node is the one being Apoptosized. The message is
stored to be gossiped in the next quarter 1. But if the receiving node
is in quarter 1 then the message can be gossiped immeadiately.
When a gossip is received for Apoptosis during quarter 1 or quarter 2,
it is saved and gossiped to other nodes.
When the apoptosized field of a cycle record contains the node id
of a particular node, the node is removed from the node list.
*/
import { P2P } from '@shardus/types'
import { Handler } from 'express'
import { isDebugMode } from '../debug'
import { logFlags } from '../logger'
import {
  ApoptosisProposalReq,
  deserializeApoptosisProposalReq,
  serializeApoptosisProposalReq,
} from '../types/ApoptosisProposalReq'
import {
  ApoptosisProposalResp,
  deserializeApoptosisProposalResp,
  serializeApoptosisProposalResp,
} from '../types/ApoptosisProposalResp'
import { InternalBinaryHandler } from '../types/Handler'
import { errorToStringFull, validateTypes } from '../utils'
import getCallstack from '../utils/getCallstack'
import { nestedCountersInstance } from '../utils/nestedCounters'
import { profilerInstance } from '../utils/profiler'
import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import * as Comms from './Comms'
import { crypto, logger, network } from './Context'
import { currentCycle, currentQuarter } from './CycleCreator'
import { activeByIdOrder, byPubKey, nodes } from './NodeList'
import * as Self from './Self'
import { robustQuery } from './Utils'
import { TypeIdentifierEnum } from '../types/enum/TypeIdentifierEnum'
import { SQLDataTypes } from '../storage/utils/schemaDefintions'
import { InternalRouteEnum } from '../types/enum/InternalRouteEnum'
import { Utils } from '@shardus/types'
import { BadRequest, serializeResponseError } from '../types/ResponseError'
import { RequestErrorEnum } from '../types/enum/RequestErrorEnum'
import { getStreamWithTypeCheck, requestErrorHandler } from '../types/Helpers'

import { nodeListFromStates } from './Join'

/** STATE */

// [TODO] - need to remove this after removing sequalize
export const cycleDataName = 'apoptosized'
export const cycleUpdatesName = 'apoptosis'

export const nodeDownString = 'node is down'
export const nodeNotDownString = 'node is not down'

const gossipRouteName = 'apoptosis'

let p2pLogger
const proposals: { [id: string]: P2P.ApoptosisTypes.SignedApoptosisProposal } = {}

/** ROUTES */

const stopExternalRoute: P2P.P2PTypes.Route<Handler> = {
  method: 'GET',
  name: 'stop',
  handler: (_req, res) => {
    if (isDebugMode()) {
      res.json({ status: 'goodbye cruel world' })
      apoptosizeSelf('Apoptosis called at stopExternalRoute => src/p2p/Apoptosis.ts')
    }
  },
}

const failExternalRoute: P2P.P2PTypes.Route<Handler> = {
  method: 'GET',
  name: 'fail',
  handler: (_req, res) => {
    if (isDebugMode()) {
      /* prettier-ignore */ if (logFlags.important_as_fatal) warn('fail route invoked in Apoptosis; used to test unclean exit')
      //let fail_endpoint_debug = undefined
      //console.log(fail_endpoint_debug.forced)
      throw Error('fail_endpoint_debug')
    }
  },
}

// This route is expected to return "pass" or "fail" so that
//   the exiting node can know that some other nodes have
//   received the message and will send it to other nodes
const apoptosisInternalRoute: P2P.P2PTypes.Route<InternalBinaryHandler<Buffer>> = {
  name: InternalRouteEnum.apoptosize,
  handler: (payload, response, header, sign) => {
    const route = InternalRouteEnum.apoptosize
    nestedCountersInstance.countEvent('internal', route)
    profilerInstance.scopedProfileSectionStart(route)
    const errorHandler = (
      errorType: RequestErrorEnum,
      opts?: { customErrorLog?: string; customCounterSuffix?: string }
    ): void => requestErrorHandler(route, errorType, header, opts)

    try {
      const requestStream = getStreamWithTypeCheck(payload, TypeIdentifierEnum.cApoptosisProposalReq)
      if (!requestStream) {
        errorHandler(RequestErrorEnum.InvalidRequest)
        return response(BadRequest('Invalid apoptosisInternalRoute request stream'), serializeResponseError)
      }

      const req = deserializeApoptosisProposalReq(requestStream)

      const apopProposal: P2P.ApoptosisTypes.SignedApoptosisProposal = {
        id: req.id,
        when: req.when,
        sign: sign,
      }
      /* prettier-ignore */ if (logFlags.p2pNonFatal) info(`Got Apoptosis proposal: ${Utils.safeStringify(apopProposal)}`)
      let err = ''

      if (apopProposal.id === 'isDownCheck') {
        let down_msg = nodeNotDownString

        // IF we are not active or syncing then need to return fail. or not return at all?
        if (Self.isFailed === true) {
          down_msg = nodeDownString
        }

        /* prettier-ignore */ nestedCountersInstance.countEvent('p2p', `self-isDownCheck c:${currentCycle} ${down_msg}`, 1)
        let resp: ApoptosisProposalResp = { s: down_msg, r: 1 }
        return response(resp, serializeApoptosisProposalResp)
      }

      const when = apopProposal.when
      if (when > currentCycle + 1 || when < currentCycle - 1) {
        let resp: ApoptosisProposalResp = { s: 'fail', r: 2 }
        return response(resp, serializeApoptosisProposalResp)
      }
      //  check that the node which sent this is the same as the node that signed it, otherwise this is not original message so ignore it
      if (header.sender_id === apopProposal.id) {
        //  if (addProposal(payload)) p2p.sendGossipIn(gossipRouteName, payload)
        //  if (addProposal(payload)) Comms.sendGossip(gossipRouteName, payload)
        //  Omar - we must always accept the original apoptosis message regardless of quarter and save it to gossip next cycle
        //    but if we are in Q1 gossip it, otherwise save for Q1 of next cycle
        if (addProposal(apopProposal)) {
          if (currentQuarter === 1) {
            // if it is Q1 we can try to gossip the message now instead of waiting for Q1 of next cycle
            Comms.sendGossip(gossipRouteName, apopProposal)
          }
          let resp: ApoptosisProposalResp = { s: 'pass', r: 1 }
          return response(resp, serializeApoptosisProposalResp)
        } else {
          /* prettier-ignore */ if (logFlags.error) warn(`addProposal failed for payload: ${Utils.safeStringify(apopProposal)}`)
          let resp: ApoptosisProposalResp = { s: 'fail', r: 4 }
          return response(resp, serializeApoptosisProposalResp)
        }
      } else {
        /* prettier-ignore */ if (logFlags.error) warn(`sender is not apop node: sender:${header.sender_id} apop:${apopProposal.id}`)
        let resp: ApoptosisProposalResp = { s: 'fail', r: 3 }
        return response(resp, serializeApoptosisProposalResp)
      }
    } catch (e) {
      nestedCountersInstance.countEvent('internal', 'apoptosize-exception')
      error(`apoptosize: Exception executing request: ${errorToStringFull(e)}`)
    } finally {
      profilerInstance.scopedProfileSectionEnd('apoptosize')
    }
  },
}

const apoptosisGossipRoute: P2P.P2PTypes.GossipHandler<P2P.ApoptosisTypes.SignedApoptosisProposal> = (
  payload,
  sender,
  tracker
) => {
  profilerInstance.scopedProfileSectionStart('apoptosis')
  try {
    /* prettier-ignore */ if (logFlags.p2pNonFatal) info(`Got Apoptosis gossip: ${Utils.safeStringify(payload)}`)
    let err = ''
    err = validateTypes(payload, { when: 'n', id: 's', sign: 'o' })
    if (err) {
      warn('apoptosisGossipRoute bad payload: ' + err)
      return
    }
    err = validateTypes(payload.sign, { owner: 's', sig: 's' })
    if (err) {
      warn('apoptosisGossipRoute bad payload.sign: ' + err)
      return
    }
    if ([1, 2].includes(currentQuarter)) {
      if (addProposal(payload)) {
        Comms.sendGossip(gossipRouteName, payload, tracker, Self.id, nodeListFromStates(['active', 'ready', 'syncing']), false) // use Self.id so we don't gossip to ourself
      }
    }
  } finally {
    profilerInstance.scopedProfileSectionEnd('apoptosis')
  }
}

const routes = {
  external: [stopExternalRoute, failExternalRoute],
  internal: [],
  internalBinary: [apoptosisInternalRoute],
  gossip: {
    //    'gossip-join': gossipJoinRoute,
    [gossipRouteName]: apoptosisGossipRoute,
  },
}

/** FUNCTIONS */

export function init() {
  p2pLogger = logger.getLogger('p2p')

  // Init state
  reset()

  // Register routes
  for (const route of routes.external) {
    // [TODO] - Add Comms.registerExternalGet and Post that pass through to network.*
    //          so that we can always just use Comms.* instead of network.*
    network._registerExternal(route.method, route.name, route.handler)
  }
  for (const route of routes.internal) {
    Comms.registerInternal(route.name, route.handler)
  }
  for (const route of routes.internalBinary) {
    Comms.registerInternalBinary(route.name, route.handler)
  }
  for (const [name, handler] of Object.entries(routes.gossip)) {
    Comms.registerGossipHandler(name, handler)
  }
}

export function reset() {
  // only delete proposals where the node has been removed
  //   otherwise we will submit the proposal again in the next Q1
  for (const id of Object.keys(proposals)) {
    if (!nodes.get(id)) {
      delete proposals[id]
    }
  }
}

export function getTxs(): P2P.ApoptosisTypes.Txs {
  return {
    apoptosis: [...Object.values(proposals)],
  }
}

export function validateRecordTypes(rec: P2P.ApoptosisTypes.Record): string {
  let err = validateTypes(rec, { apoptosized: 'a' })
  if (err) return err
  for (const item of rec.apoptosized) {
    if (typeof item !== 'string') return 'items of apoptosized array must be strings'
  }
  return ''
}

export function dropInvalidTxs(txs: P2P.ApoptosisTypes.Txs): P2P.ApoptosisTypes.Txs {
  const valid = txs.apoptosis.filter((request) => validateProposal(request))
  return { apoptosis: valid }
}

/*
Given the txs and prev cycle record mutate the referenced record
*/
export function updateRecord(txs: P2P.ApoptosisTypes.Txs, record: P2P.ApoptosisTypes.Record) {
  const apoptosized = []
  for (const request of txs.apoptosis) {
    const publicKey = request.sign.owner
    const node = byPubKey.get(publicKey)
    if (node) {
      apoptosized.push(node.id)
    }
  }
  record.apoptosized = [...record.apoptosized, ...apoptosized].sort()
}

export function parseRecord(record: P2P.ApoptosisTypes.Record): P2P.CycleParserTypes.Change {
  if (record.apoptosized.includes(Self.id)) {
    // This could happen if our Internet connection was bad.
    /* prettier-ignore */ if (logFlags.important_as_fatal) error(`We got marked for apoptosis even though we didn't ask for it. Being nice and leaving.`)
    Self.emitter.emit(
      'invoke-exit',
      'node left active state due to un-refuted lost report',
      getCallstack(),
      `invoke-exit being called at parseRecord() => src/p2p/Apoptosis.ts: found our id in the apoptosis list`
    )
  }
  return {
    added: [],
    removed: record.apoptosized,
    updated: [],
  }
}

export function sendRequests() {
  for (const id of Object.keys(proposals)) {
    // make sure node is still in the network, since it might
    //   have already been removed
    if (nodes.get(id)) {
      Comms.sendGossip(gossipRouteName, proposals[id], '', null, nodeListFromStates(['active', 'ready', 'syncing']), true)
    }
  }
}

/* Module functions */

// [TODO] - We don't need the caller to pass us the list of nodes
//          remove this after changing references
export async function apoptosizeSelf(message: string) {
  /* prettier-ignore */ if (logFlags.important_as_fatal) warn(`In apoptosizeSelf. ${message}`)
  // [TODO] - maybe we should shuffle this array
  const activeNodes = activeByIdOrder
  const proposal = createProposal()
  const apopProposalReq: ApoptosisProposalReq = {
    id: proposal.id,
    when: proposal.when,
  }
  await Comms.tellBinary<ApoptosisProposalReq>(
    activeNodes,
    InternalRouteEnum.apoptosize,
    apopProposalReq,
    serializeApoptosisProposalReq,
    {}
  )
  const qF = async (node) => {
    //  use ask instead of tell and expect the node to
    //          acknowledge it received the request by sending 'pass'
    if (node.id === Self.id) return null
    try {
      const res = Comms.askBinary<ApoptosisProposalReq, ApoptosisProposalResp>(
        node,
        InternalRouteEnum.apoptosize,
        apopProposalReq,
        serializeApoptosisProposalReq,
        deserializeApoptosisProposalResp,
        {}
      )
      return res
    } catch (err) {
      /* prettier-ignore */ if (logFlags.important_as_fatal) warn(`qF: In apoptosizeSelf calling robustQuery proposal. ${message}`)
      /* prettier-ignore */ if (logFlags.important_as_fatal) warn(`Error: ${err}`)
      return null
    }
  }
  const eF = (item1, item2) => {
    if (!item1 || !item2) return false
    if (!item1.s || !item2.s) return false
    if (item1.s === 'pass' && item2.s === 'pass') return true
    return false
  }
  // If we don't have any active nodes; means we are still joining
  if (activeNodes.length > 0) {
    /* prettier-ignore */ if (logFlags.important_as_fatal) warn(`In apoptosizeSelf calling robustQuery proposal. ${message}`)
    let redunancy = 1
    if (activeNodes.length > 5) {
      redunancy = 2
    }
    if (activeNodes.length > 10) {
      redunancy = 3
    }
    /* prettier-ignore */ if (logFlags.important_as_fatal) warn(`Redunancy is ${redunancy}   ${message}`)
    await robustQuery(activeNodes, qF, eF, redunancy, true)
    /* prettier-ignore */ if (logFlags.important_as_fatal) warn(`Sent apoptosize-self proposal: ${Utils.safeStringify(proposal)}   ${message}`)
  }
  // Omar - added the following line. Maybe we should emit an event when we apoptosize so other modules and app can clean up
  Self.emitter.emit('invoke-exit', `In apoptosizeSelf. ${message}`, getCallstack(), message) // we can pass true as a parameter if we want to be restarted
  // Omar - we should not add any proposal since we are exiting; we already sent our proposal to some nodes
  //  addProposal(proposal)
  /* prettier-ignore */ if (logFlags.important_as_fatal) error(`We have been apoptosized. Exiting with status 1. Will not be restarted. ${message}`)
}

function createProposal(): P2P.ApoptosisTypes.SignedApoptosisProposal {
  const proposal = {
    //    id: p2p.id,
    id: Self.id,
    // Omar -  Maybe we should add a timestamp or cycle number to the message so it cannot be replayed
    when: currentCycle,
  }
  //  return p2p.crypto.sign(proposal)
  return crypto.sign(proposal)
}

function addProposal(proposal: P2P.ApoptosisTypes.SignedApoptosisProposal): boolean {
  if (validateProposal(proposal) === false) return false
  //  const publicKey = proposal.sign.owner
  const id = proposal.id
  if (proposals[id]) return false
  proposals[id] = proposal
  info(`Marked ${proposal.id} for apoptosis`)
  return true
}

function validateProposal(payload: unknown): boolean {
  // [TODO] Type checking
  if (!payload) return false
  if (!(payload as P2P.P2PTypes.LooseObject).id) return false
  if (!(payload as P2P.P2PTypes.LooseObject).when) return false
  if (!(payload as P2P.ApoptosisTypes.SignedApoptosisProposal).sign) return false
  if (!isValidWhen((payload as P2P.ApoptosisTypes.SignedApoptosisProposal).when)) return false
  const proposal = payload as P2P.ApoptosisTypes.SignedApoptosisProposal
  const id = proposal.id

  // even joining nodes can send apoptosis message, so check all nodes list
  const node = nodes.get(id)
  if (!node) return false

  // Check if signature is valid and signed by expected node
  //  const valid = p2p.crypto.verify(proposal, node.publicKey)
  const valid = crypto.verify(proposal, node.publicKey)
  if (!valid) return false

  return true
}

function isValidWhen(when: unknown): boolean {
  if (typeof when !== 'number' || !Number.isInteger(when)) {
    return false
  }

  const minAcceptableCycle = currentCycle - 1
  const maxAcceptableCycle = currentCycle + 1
  return when >= minAcceptableCycle && when <= maxAcceptableCycle
}

export function isApopMarkedNode(id: string): boolean {
  let apopNode = false
  if (proposals[id]) {
    // Check if the node is in the proposal list
    apopNode = true
  }
  /* prettier-ignore */ if (logFlags.p2pNonFatal) info('check if the node is apop marked node', id, apopNode)
  return apopNode
}

function info(...msg) {
  const entry = `Apoptosis: ${msg.join(' ')}`
  p2pLogger.info(entry)
}

function warn(...msg) {
  const entry = `Apoptosis: ${msg.join(' ')}`
  p2pLogger.warn(entry)
}

function error(...msg) {
  const entry = `Apoptosis: ${msg.join(' ')}`
  p2pLogger.error(entry)
}

/** STORAGE DATA */

/* Don't need this any more since we are not storing cycles in the database
 */
export const addCycleFieldQuery = `ALTER TABLE cycles ADD ${cycleDataName} JSON NULL`

export const sequelizeCycleFieldModel = {
  [cycleDataName]: { type: SQLDataTypes.JSON, allowNull: true },
}
