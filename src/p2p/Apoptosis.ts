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
import { Handler } from 'express'
import * as Sequelize from 'sequelize'
import { P2P } from 'shardus-types'
import { validateTypes } from '../utils'
import * as Comms from './Comms'
import { crypto, logger, network } from './Context'
import { currentCycle, currentQuarter } from './CycleCreator'
import { activeByIdOrder, byIdOrder, byPubKey, nodes } from './NodeList'
import * as Self from './Self'
import { robustQuery } from './Utils'
import { isDebugMode } from '../debug'
import { profilerInstance } from '../utils/profiler'

/** STATE */

// [TODO] - need to remove this after removing sequalize
export const cycleDataName = 'apoptosized'
export const cycleUpdatesName = 'apoptosis'

const internalRouteName = 'apoptosize'
const gossipRouteName = 'apoptosis'

let p2pLogger
const proposals: { [id: string]: P2P.ApoptosisTypes.SignedApoptosisProposal } = {}



/** ROUTES */

const stopExternalRoute: P2P.P2PTypes.Route<Handler> = {
  method: 'GET',
  name: 'stop',
  handler: (_req, res) => {
    if (isDebugMode()){
      res.json({status: 'goodbye cruel world'})
      apoptosizeSelf()
    }
  },
}

const failExternalRoute: P2P.P2PTypes.Route<Handler> = {
  method: 'GET',
  name: 'fail',
  handler: (_req, res) => {
    if (isDebugMode()){
      warn ('fail route invoked in Apoptosis; used to test unclean exit')
      //let fail_endpoint_debug = undefined
      //console.log(fail_endpoint_debug.forced)
      throw Error('fail_endpoint_debug')
    }
  },
}

// This route is expected to return "pass" or "fail" so that
//   the exiting node can know that some other nodes have
//   received the message and will send it to other nodes
const apoptosisInternalRoute: P2P.P2PTypes.Route<P2P.P2PTypes.InternalHandler<P2P.ApoptosisTypes.SignedApoptosisProposal>> = {
  name: internalRouteName,
  handler: (payload, response, sender) => {
    profilerInstance.scopedProfileSectionStart('apoptosize')
    try {
      info(`Got Apoptosis proposal: ${JSON.stringify(payload)}`)
      let err = ''
      err = validateTypes(payload, {when:'n',id:'s',sign:'o'})
      if (err){ warn('bad input '+err); return }
      err = validateTypes(payload.sign, {owner:'s',sig:'s'})
      if (err){ warn('bad input sign '+err); return }
// The when must be set to current cycle +-1 because it is being
//    received from the originating node
      if (!(payload as P2P.P2PTypes.LooseObject).when){ response({s:'fail',r:1}); return }
      const when = payload.when
      if (when > currentCycle+1 || when < currentCycle-1){ response({s:'fail',r:2}); return  }
      //  check that the node which sent this is the same as the node that signed it, otherwise this is not original message so ignore it
      if (sender === payload.id){
//  if (addProposal(payload)) p2p.sendGossipIn(gossipRouteName, payload)
//  if (addProposal(payload)) Comms.sendGossip(gossipRouteName, payload)
//  Omar - we must always accept the original apoptosis message regardless of quarter and save it to gossip next cycle
//    but if we are in Q1 gossip it, otherwise save for Q1 of next cycle
        if (addProposal(payload)){
          if (currentQuarter === 1){  // if it is Q1 we can try to gossip the message now instead of waiting for Q1 of next cycle
            Comms.sendGossip(gossipRouteName, payload)
          }
          response({s:'pass'})
          return
        }
        else{
          warn(`addProposal failed for payload: ${JSON.stringify(payload)}`)
        }
      }
      else{
        warn(`sender is not apop node: sender:${sender} apop:${payload.id}`)
        response({s:'fail',r:3})
      }
    } finally {
      profilerInstance.scopedProfileSectionEnd('apoptosize')
    }
  }
}

const apoptosisGossipRoute: P2P.P2PTypes.GossipHandler<P2P.ApoptosisTypes.SignedApoptosisProposal> =
   (payload, sender, tracker) => {
  profilerInstance.scopedProfileSectionStart('apoptosis')
  try {
    info(`Got Apoptosis gossip: ${JSON.stringify(payload)}`)
    let err = ''
    err = validateTypes(payload, {when:'n',id:'s',sign:'o'})
    if (err){ warn('apoptosisGossipRoute bad payload: '+err); return }
    err = validateTypes(payload.sign, {owner:'s',sig:'s'})
    if (err){ warn('apoptosisGossipRoute bad payload.sign: '+err); return }
    if ([1,2].includes(currentQuarter)){
      if (addProposal(payload)) {
        Comms.sendGossip(gossipRouteName, payload, tracker, Self.id, byIdOrder, false) // use Self.id so we don't gossip to ourself
      }
    }
  } finally {
    profilerInstance.scopedProfileSectionEnd('apoptosis')
  }
}

const routes = {
  external: [stopExternalRoute, failExternalRoute ],
  internal: [apoptosisInternalRoute ],
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
  for (const [name, handler] of Object.entries(routes.gossip)) {
    Comms.registerGossipHandler(name, handler)
  }
}

export function reset() {
  // only delete proposals where the node has been removed
  //   otherwise we will submit the proposal again in the next Q1
  for (const id of Object.keys(proposals)){
    if (!nodes.get(id)){
      delete proposals[id]
    }
  }
}

export function getTxs(): P2P.ApoptosisTypes.Txs {
  return {
    apoptosis: [...Object.values(proposals)],
  }
}

export function validateRecordTypes(rec: P2P.ApoptosisTypes.Record): string{
  let err = validateTypes(rec,{apoptosized:'a'})
  if (err) return err
  for(const item of rec.apoptosized){
    if (typeof(item) !== 'string') return 'items of apoptosized array must be strings'
  }
  return ''
}

export function dropInvalidTxs(txs: P2P.ApoptosisTypes.Txs): P2P.ApoptosisTypes.Txs {
  const valid = txs.apoptosis.filter(request => validateProposal(request))
  return { apoptosis: valid }
}

/*
Given the txs and prev cycle record mutate the referenced record
*/
export function updateRecord(
  txs: P2P.ApoptosisTypes.Txs,
  record: P2P.ApoptosisTypes.Record,
)
{
  const apoptosized = []
  for (const request of txs.apoptosis) {
    const publicKey = request.sign.owner
    const node = byPubKey.get(publicKey)
    if (node) {
      apoptosized.push(node.id)
    }
  }
  record.apoptosized = apoptosized.sort()
}

export function parseRecord(record: P2P.ApoptosisTypes.Record): P2P.CycleParserTypes.Change {
  if (record.apoptosized.includes(Self.id)) {
    // This could happen if our Internet connection was bad.
    warn(`We got marked for apoptosis even though we didn't ask for it. Being nice and leaving.`)
    Self.emitter.emit('apoptosized')
  }
  return {
    added: [],
    removed: record.apoptosized,
    updated: []
  }

}

export function sendRequests() {
  for (const id of Object.keys(proposals)){
    // make sure node is still in the network, since it might
    //   have already been removed
    if (nodes.get(id)){
      Comms.sendGossip(gossipRouteName, proposals[id], '', null, byIdOrder, true)
    }
  }
}


/* Module functions */

// [TODO] - We don't need the caller to pass us the list of nodes
//          remove this after changing references
export async function apoptosizeSelf() {
  warn(`In apoptosizeSelf`)
  // [TODO] - maybe we should shuffle this array
  const activeNodes = activeByIdOrder
  const proposal = createProposal()
/* Don't use tell, do a robust query instead
//  await p2p.tell(activeNodes, internalRouteName, proposal)
  await Comms.tell(activeNodes, internalRouteName, proposal)
*/
  const qF = async (node) => {
//  use ask instead of tell and expect the node to
//          acknowledge it received the request by sending 'pass'
    if (node.id === Self.id) return null
    const res = Comms.ask(node, internalRouteName, proposal)
    return res
  }
  const eF = (item1, item2) => {
    if (!item1 || !item2) return false
    if (!item1.s || !item2.s) return false
    if ((item1.s === 'pass') && (item2.s === 'pass')) return true
    return false
  }
  // If we don't have any active nodes; means we are still joining
  if (activeNodes.length > 0){
    info(`In apoptosizeSelf calling robustQuery proposal`)
    let redunancy = 1
    if (activeNodes.length > 5){ redunancy = 2 }
    if (activeNodes.length > 10){ redunancy = 3 }
    info(`Redunancy is ${redunancy}`)
    await robustQuery(activeNodes, qF, eF, redunancy, true)
    info(`Sent apoptosize-self proposal: ${JSON.stringify(proposal)}`)
  }
// Omar - added the following line. Maybe we should emit an event when we apoptosize so other modules and app can clean up
  Self.emitter.emit('apoptosized') // we can pass true as a parameter if we want to be restarted
// Omar - we should not add any proposal since we are exiting; we already sent our proposal to some nodes
//  addProposal(proposal)
  warn('We have been apoptosized. Exiting with status 1. Will not be restarted.')
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
  const proposal = payload as P2P.ApoptosisTypes.SignedApoptosisProposal
  const id = proposal.id

  // even joining nodes can send apoptosis message, so check all nodes list
  const node = nodes.get(id)
  if (! node) return false

  // Check if signature is valid and signed by expected node
//  const valid = p2p.crypto.verify(proposal, node.publicKey)
  const valid = crypto.verify(proposal, node.publicKey)
  if (!valid) return false

  return true
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
  [cycleDataName]: { type: Sequelize.JSON, allowNull: true },
}
