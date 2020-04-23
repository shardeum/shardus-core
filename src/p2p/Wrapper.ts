import { EventEmitter, constructor } from 'events'
import * as Shardus from '../shardus/shardus-types'
import * as utils from '../utils'
import * as Active from './Active'
import { apoptosizeSelf } from './Apoptosis'
import * as Comms from './Comms'
import { config } from './Context'
import * as CycleChain from './CycleChain'
import * as NodeList from './NodeList'
import * as Self from './Self'
import * as Utils from './Utils'

/* p2p functions */

class P2P extends EventEmitter {
  registerInternal: (route: any, handler: any) => void
  registerGossipHandler: (type: any, handler: any) => void
  unregisterGossipHandler: (type: any) => void
  unregisterInternal: (route: any) => void
  ask: (
    node: any,
    route: string,
    message?: {},
    logged?: boolean,
    tracker?: string
  ) => Promise<any>
  tell: (
    nodes: any,
    route: any,
    message: any,
    logged?: boolean,
    tracker?: string
  ) => Promise<void>
  sendGossipIn: (
    type: any,
    payload: any,
    tracker?: string,
    sender?: any,
    inpNodes?: NodeList.Node[]
  ) => Promise<void>
  robustQuery: any
  state: typeof state
  archiver: typeof archiver

  constructor() {
    super()
    this.registerInternal = Comms.registerInternal
    this.registerGossipHandler = Comms.registerGossipHandler
    this.unregisterGossipHandler = Comms.unregisterGossipHandler
    this.unregisterInternal = Comms.unregisterInternal
    this.ask = Comms.ask
    this.tell = Comms.tell
    this.sendGossipIn = Comms.sendGossip
    this.robustQuery = Utils.robustQuery
    //this.sendGossipAll = Comms.sendGossipAll //Need this but will try sendGossipIn as a work around
  }

  // Make sure these are copying a reference instead of value
  get isFirstSeed() {
    return Self.isFirst
  }

  get isActive() {
    return Self.isActive
  }

  get id() {
    return Self.id
  }

  getNodeId() {
    return Self.id
  }

  initApoptosis(nodes) {
    // [TODO] - we need to change apoptosizeSelf
    //          currently it tell all the nodes in the network that it is leaving; not practical in large networks
    //          we should gossip this, but origninal gossip is only allowed in Q1 and the node cannot
    //          wait until then.
    //          Need to think about the best way to handle this.
    apoptosizeSelf(NodeList.activeOthersByIdOrder)
  }

  allowTransactions() {
    return NodeList.activeByIdOrder.length >= config.p2p.minNodesToAllowTxs
  }

  allowSet() {
    return NodeList.activeByIdOrder.length === 1
  }
  /*
  ,function allowSet_orig () {
      return this.state.getActiveCount() === 1
  }
  */

  // Propably don't need to do anything; the join module only uses Self.isActive to accept join request
  setJoinRequestToggle(bool) {}
  /*
  ,function setJoinRequestToggle_orig (bool) {
    this.joinRequestToggle = bool
  }
  */

  goActive() {
    const activePromise = new Promise((resolve, reject) => {
      Self.emitter.on('active', () => resolve())
    })
    Active.requestActive()
    return activePromise
  }

  getLatestCycles(amount) {
    if (CycleChain.cycles.length < amount) {
      return CycleChain.cycles
    }
    return CycleChain.cycles.slice(0 - amount)
  }
}

export const p2p = new P2P()

class State extends EventEmitter {
  getNode(id) {
    return NodeList.nodes.get(id)
  }

  getNodeByPubKey(pubkey) {
    return NodeList.byPubKey[pubkey]
  }

  // looks like what the original function in p2p-state did is get the active nodes
  //   excluding yourself and returned as an array
  getActiveNodes_orig(id) {
    return getSubsetOfNodeList(NodeList.activeByIdOrder, id)
  }
 
  getActiveNodes(id) {
    if (id) {
      return Object.values(NodeList.activeOthersByIdOrder)
    } else {
      return Object.values(NodeList.activeByIdOrder)
    }
  }
  
  // The original function in p2p.state just returns an array with all nodes that are syncing excluding self
  //     there is no concept of neighbors
  getOrderedSyncingNeighbors(node) {
    const nodes = NodeList.othersByIdOrder.filter(e => e.status === 'syncing') // remove syncing nodes
    return nodes
  }

  getLastCycle() {
    return CycleChain.newest
  }

  getCycleByCounter(cycleNumber) {
    function compare(cycleNum, cycle) {
      return cycleNum > cycle.counter ? 1 : cycleNum < cycle.counter ? -1 : 0
    }
    const i = utils.binarySearch(CycleChain.cycles, cycleNumber, compare)
    /*
    for(const cycle of CycleChain.cycles){
      if (cycle.counter === cycleNumber){ return cycle }
    }
    */
    if (i >= 0) return i
    return null
  }

  getCycleByTimestamp(timestamp) {
    let secondsTs = Math.floor(timestamp * 0.001)
    function compare(ts, ae) {
      if (ts > ae.start + ae.duration) {
        return 1
      }
      if (ts < ae.start) {
        return -1
      }
      return 0
    }
    // binary search seems busted
    //const i = utils.binarySearch(CycleChain.cycles, timestamp, compare)
    // if (i >= 0) return i
    // return null
    //temp simple for loop untill the binary search can be fixed.
    for(const cycle of CycleChain.cycles){
      if (cycle.start < secondsTs && cycle.start + cycle.duration >= secondsTs ){
        return cycle
      }
    }    
    return null
  }
}

const state = new State()
Self.emitter.on('cycle_q1_start', (lastCycle: Shardus.Cycle, time: number) => {
  state.emit('cycle_q1_start', lastCycle, time)
})
Self.emitter.on('cycle_q2_start', (lastCycle: Shardus.Cycle, time: number) => {
  state.emit('cycle_q2_start', lastCycle, time)
})
Self.emitter.on('cycle_q3_start', (lastCycle: Shardus.Cycle, time: number) => {
  state.emit('cycle_q3_start', lastCycle, time)
})

p2p['state'] = state

/* Listeners */
// this._registerListener(this.p2p.state, 'cycle_q1_start', async (lastCycle: Shardus.Cycle, time:number) => {})
// this._registerListener(this.p2p.state, 'cycle_q2_start', async (lastCycle: Shardus.Cycle, time:number) => {})
// this._registerListener(this.p2p.state, 'cycle_q3_start', async (lastCycle: Shardus.Cycle, time:number) => {})

/* Internal functions */

/* all this does is returns an array of nodes with our node removed from it */
/*    it is given an obj of ids -> nodes */
function getSubsetOfNodeList(nodes, self = null) {
  if (!self) return Object.values(nodes)
  // Check if self in node list
  if (!nodes[self]) {
    // stack
    this.mainLogger.warn(
      `Invalid node ID in 'self' field. Given ID: ${self} : ${
        new Error().stack
      }`
    )
    return Object.values(nodes)
  }
  const nodesCopy = utils.deepCopy(nodes)
  delete nodesCopy[self]
  return Object.values(nodesCopy)
}

/*********************************************************************************/
/* p2p.archiver functions */

const http = require('../http')

namespace archiver {
  // copied from p2p-archiver.js
  export function sendPartitionData(partitionReceipt, paritionObject) {
    for (const nodeInfo of this.cycleRecipients) {
      const nodeUrl = `http://${nodeInfo.ip}:${nodeInfo.port}/post_partition`
      http.post(nodeUrl, { partitionReceipt, paritionObject }).catch(err => {
        this.logError(`sendPartitionData: Failed to post to ${nodeUrl} ` + err)
      })
    }
  }

  // copied from p2p-archiver.js
  export function sendTransactionData(
    partitionNumber,
    cycleNumber,
    transactions
  ) {
    for (const nodeInfo of this.cycleRecipients) {
      const nodeUrl = `http://${nodeInfo.ip}:${nodeInfo.port}/post_transactions`
      http
        .post(nodeUrl, { partitionNumber, cycleNumber, transactions })
        .catch(err => {
          this.logError(
            `sendTransactionData: Failed to post to ${nodeUrl} ` + err
          )
        })
    }
  }
}

p2p['archiver'] = archiver
