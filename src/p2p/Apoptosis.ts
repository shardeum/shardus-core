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
import * as Sequelize from 'sequelize'
import { Handler, request } from 'express'
import { GossipHandler, InternalHandler, LooseObject, Route } from './Types'
import * as Comms from './Comms'
import * as Self from './Self'
import { Change } from './CycleParser'
import {logger, network, crypto } from './Context'
import { SignedObject } from './Types'
import * as Types from './Types'
import { nodes, removeNode, byPubKey, activeByIdOrder } from './NodeList'
import { currentQuarter, currentCycle } from './CycleCreator'
import { sleep } from '../utils'
import { robustQuery } from './Utils'

/** TYPES */

interface ApoptosisProposal {
  id: string,
  when: number,
}

type SignedApoptosisProposal = ApoptosisProposal & SignedObject

export interface Txs {
  apoptosis: SignedApoptosisProposal[]
}

export interface Record {
  apoptosized: string[]
}


/** STATE */

// [TODO] - need to remove this after removing sequalize
export const cycleDataName = 'apoptosized'
export const cycleUpdatesName = 'apoptosis'

const internalRouteName = 'apoptosize'
const gossipRouteName = 'apoptosis'

// [TODO] - This enables the /stop debug route and should be set to false after testing
//          Normally oter parts of the program can just call apoptosizeSelf()
const allowStopRoute = true

let p2pLogger
const proposals: { [id: string]: SignedApoptosisProposal } = {}

/** ROUTES */

const stopExternalRoute: Types.Route<Handler> = {
  method: 'GET',
  name: 'stop',
  handler: (_req, res) => {
    if (allowStopRoute){
      res.json({status: 'goodbye cruel world'})
      apoptosizeSelf()
    }
  },
}

// This route is expected to return "pass" or "fail" so that
//   the exiting node can know that some other nodes have 
//   received the message and will send it to other nodes
const apoptosisInternalRoute: Route<InternalHandler<SignedApoptosisProposal>> = {
  name: internalRouteName,
  handler: (payload, response, sender) => {
// [TODO] - validate input from network
    log(`Got Apoptosis proposal: ${JSON.stringify(payload)}`)
// The when must be set to current cycle +-1 because it is being
//    received from the originating node
    if (!(payload as LooseObject).when){ response({s:'fail',r:1}); return }
    const when = payload.when
    if (when > currentCycle+1 || when < currentCycle-1){ response({s:'fail',r:2}); return  }
  //  check that the node which sent this is the same as the node that signed it, otherwise this is not original message so ignore it
    if (sender === payload.id){
//  if (addProposal(payload)) p2p.sendGossipIn(gossipRouteName, payload)
//  if (addProposal(payload)) Comms.sendGossip(gossipRouteName, payload)
//  Omar - we must always accept the original apoptosis message regardless of quarter and save it to gossip next cycle
//    but if we are in Q1 gossip it, otherwise save for Q1 of next cycle
      log(`sender is not apop node: sender:${sender} apop:${payload.id}`)
      if (addProposal(payload)){
        if (currentQuarter === 1){  // if it is Q1 we can try to gossip the message now instead of waiting for Q1 of next cycle
          Comms.sendGossip(gossipRouteName, payload)
        }
        response({s:'pass'})
        return
      }
      else{
        log(`addProposal failed for payload: ${JSON.stringify(payload)}`)
      }
    } 
    else{
      log(`sender is not apop node: sender:${sender} apop:${payload.id}`)
      response({s:'fail',r:3})
    }
  }
}

const apoptosisGossipRoute: GossipHandler<SignedApoptosisProposal> = 
   (payload, sender, tracker) => {
  log(`Got Apoptosis gossip: ${JSON.stringify(payload)}`)
  if ([1,2].includes(currentQuarter)){  
    if (addProposal(payload)) {
//    p2p.sendGossipIn(gossipRouteName, payload, tracker, sender)
      Comms.sendGossip(gossipRouteName, payload, tracker, sender)
    }
  }
}

const routes = {
  external: [stopExternalRoute ],
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
    network.registerExternalGet(route.name, route.handler)
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

export function getTxs(): Txs {
  return {
    apoptosis: [...Object.values(proposals)],
  }
}

export function dropInvalidTxs(txs: Txs): Txs {
  const valid = txs.apoptosis.filter(request => validateProposal(request))
  return { apoptosis: valid }
}

/*
Given the txs and prev cycle record mutate the referenced record
*/
export function updateRecord(
  txs: Txs,
  record: Record,
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

export function parseRecord(record: Record): Change {
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
      Comms.sendGossip(gossipRouteName, proposals[id])
    }
  }
}


/* Module functions */

// [TODO] - We don't need the caller to pass us the list of nodes
//          remove this after changing references
export async function apoptosizeSelf() {
  log(`In apoptosize`)
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
    // [TODO] - validate input from network
    if (!item1 || !item2) return false
    if ((item1.s === 'pass') && (item2.s === 'pass')) return true
    return false
  }
  // If we don't have any active nodes; means we are still joining
  if (activeNodes.length > 0){
    log(`In apoptosizeSelf calling robustQuery proposal`)
    let redunancy = 1
    if (activeNodes.length > 5){ redunancy = 2 }
    if (activeNodes.length > 10){ redunancy = 3 }
    log(`Redunancy is ${redunancy}`)
    await robustQuery(activeNodes, qF, eF, redunancy, true)
    log(`Sent apoptosize-self proposal: ${JSON.stringify(proposal)}`)
  }
// Omar - added the following line. Maybe we should emit an event when we apoptosize so other modules and app can clean up
  Self.emitter.emit('apoptosized')
// Omar - we should not add any proposal since we are exiting; we already sent our proposal to some nodes
//  addProposal(proposal)
  log(`I have been apoptosized, waiting 1 sec ...`)
  await sleep(1000)
  log(`I have been apoptosized, exiting with code 1...`)
  process.exit(1)
}

function log(msg: string, level = 'info') {
//  p2p.mainLogger[level]('P2PApoptosis: ' + msg)
  p2pLogger[level]('P2PApoptosis: ' + msg)
}

function createProposal(): SignedApoptosisProposal {
  const proposal = {
//    id: p2p.id,
    id: Self.id,
// Omar -  Maybe we should add a timestamp or cycle number to the message so it cannot be replayed
    when: currentCycle,
  }
//  return p2p.crypto.sign(proposal)
  return crypto.sign(proposal)
}

function addProposal(proposal: SignedApoptosisProposal): boolean {
  if (validateProposal(proposal) === false) return false
//  const publicKey = proposal.sign.owner
  const id = proposal.id
  if (proposals[id]) return false
  proposals[id] = proposal
  log(`Marked ${proposal.id} for apoptosis`)
  return true
}

function validateProposal(payload: unknown): boolean {
  // [TODO] Type checking
  if (!payload) return false
  if (!(payload as LooseObject).id) return false
  if (!(payload as LooseObject).when) return false
  if (!(payload as SignedApoptosisProposal).sign) return false
  const proposal = payload as SignedApoptosisProposal
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


/** STORAGE DATA */

/* Don't need this any more since we are not storing cycles in the database
*/
export const addCycleFieldQuery = `ALTER TABLE cycles ADD ${cycleDataName} JSON NULL`

export const sequelizeCycleFieldModel = {
  [cycleDataName]: { type: Sequelize.JSON, allowNull: true },
}

