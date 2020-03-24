import { Signature, SignedObject, Route, InternalHandler, Node, NodeInfo, LooseObject, GossipHandler } from './Types'
import { Handler } from 'express'
import { p2p } from './Context'
import StateManager from '../state-manager'
import ShardFunctions from '../state-manager/shardFunctions'
import Shardus from '../shardus'

/** TYPES */

export interface SetGlobalTx {
  address: string
  value: unknown
  when: number
  source: string
}

export interface Receipt {
  signs: Signature[]
  tx: SetGlobalTx
  consensusGroup: Set<NodeInfo['id']>
}

export interface Tracker {
  seen: Set<NodeInfo['publicKey']>
  timestamp: number
  gossiped: boolean
}

export type TxHash = string

export type SignedSetGlobalTx = SetGlobalTx & SignedObject

/** ROUTES */

const makeReceiptRoute: Route<InternalHandler<SignedSetGlobalTx, unknown, string>> = {
  name: 'make-receipt',
  handler: (payload, respond, sender) => {
    makeReceipt(payload, sender)
  },
}

const setGlobalGossipRoute: Route<GossipHandler<Receipt>> = {
  name: 'set-global',
  handler: (payload) => {
    if (validateReceipt(payload) === false) return
    if (processReceipt(payload) === false ) return
    p2p.sendGossipIn('set-global', payload)
  }
}

export const internalRoutes = [makeReceiptRoute]
export const gossipRoutes = [setGlobalGossipRoute]

/** STATE */

let shardus: Shardus = null
let stateManager: StateManager = null

let lastClean = 0

const receipts = new Map<TxHash, Receipt>()
const trackers = new Map<TxHash, Tracker>()

/** FUNCTIONS */

export function createMakeReceiptHandle(txHash: string) {
  return `receipt-${txHash}`
}

export function makeReceipt (signedTx: SignedSetGlobalTx, sender: NodeInfo['id']) {
  if (!stateManager) {
    console.log('GlobalAccounts: makeReceipt: stateManager not ready')
    return
  }

  const sign = signedTx.sign

  const tx = {...signedTx}
  delete tx.sign

  const txHash = p2p.crypto.hash(tx)

  // Put into correct Receipt and Tracker
  let receipt: Receipt = receipts.get(txHash)
  if (!receipt) {
    const consensusGroup = new Set(getConsensusGroupIds(tx.source))
    receipt = {
      signs: [],
      tx: null,
      consensusGroup
    }
    receipts.set(txHash, receipt)
    console.log(`SETGLOBAL: MAKERECEIPT CONSENSUS GROUP FOR ${txHash.substring(0, 5)}: ${JSON.stringify([...receipt.consensusGroup].map(id => id.substring(0, 5)))}`)
  }

  let tracker: Tracker = trackers.get(txHash)
  if (!tracker) {
    tracker = createTracker(txHash)
  }

  // Ignore duplicate txs
  if (tracker.seen.has(sign.owner)) return
  // Ignore if sender is not in consensus group
  if (!receipt.consensusGroup.has(sender)) return

  receipt.signs.push(sign)
  receipt.tx = tx

  tracker.seen.add(sign.owner)
  tracker.timestamp = tx.when

  // When a majority (%60) is reached, emit the completion event for this txHash
  console.log(`SETGLOBAL: GOT SIGNED_SET_GLOBAL_TX FROM ${sender.substring(0, 5)}: ${txHash} ${JSON.stringify(signedTx)}`)
  console.log(`SETGLOBAL: ${receipt.signs.length} RECEIPTS / ${receipt.consensusGroup.size} CONSENSUS_GROUP`)
  if (isReceiptMajority(receipt, receipt.consensusGroup)) {
    const handle = createMakeReceiptHandle(txHash)
    p2p.emit(handle, receipt)
  }
}

export function processReceipt (receipt: Receipt) {
  const txHash  = p2p.crypto.hash(receipt.tx)
  const tracker = trackers.get(txHash) || createTracker(txHash)
  tracker.timestamp = receipt.tx.when
  if (tracker.gossiped) return false
  // shardus.put(receipt.tx.value, false, true)
  console.log(`Processed set-global receipt: ${JSON.stringify(receipt)}`)
  tracker.gossiped = true
  attemptCleanup()
  return true
}

export function setStateManagerContext (context: StateManager) {
  stateManager = context
}
export function setShardusContext (context: Shardus) {
  shardus = context
}

export function attemptCleanup () {
  const now = Date.now()
  if (now - lastClean < 60000) return
  lastClean = now

  for (const [txHash, tracker] of trackers) {
    if (now - tracker.timestamp > 30000) {
      trackers.delete(txHash)
      receipts.delete(txHash)
    }
  }
}

function validateReceipt(receipt: Receipt) {
  const consensusGroup = new Set(getConsensusGroupIds(receipt.tx.source))
  // Make sure receipt has enough signs
  if (isReceiptMajority(receipt, consensusGroup) === false) {
    console.log('Receipt did not have majority')
    return false
  }
  // Make a map of signs that overlap with consensusGroup
  const signsInConsensusGroup: Signature[] = []
  for (const sign of receipt.signs) {
    const id = p2p.state.getNodeByPubKey(sign.owner).id
    if (consensusGroup.has(id)) {
      signsInConsensusGroup.push(sign)
    }
  }
  // Make sure signs and consensusGroup overlap >= %60 
  if (((signsInConsensusGroup.length / consensusGroup.size) * 100) < 60) {
    console.log('Receipt signature owners and consensus group did not overlap enough')
    return false
  }
  // Verify the signs that overlap with consensusGroup are a majority
  let verified = 0
  for (const sign of signsInConsensusGroup) {
    const signedTx = { ...receipt.tx, sign }
    if (p2p.crypto.verify(signedTx)) verified++
  }
  if ((verified / consensusGroup.size) * 100 < 60) {
    console.log('Receipt does not have enough valid signatures')
    return false
  }
  return true
}

function createTracker (txHash) {
  const tracker = {
    seen: new Set<NodeInfo["id"]>(),
    timestamp: 0,
    gossiped: false
  }
  trackers.set(txHash, tracker)
  return tracker
}

function getConsensusGroupIds (address) {
  const homeNode = ShardFunctions.findHomeNode(stateManager.currentCycleShardData.shardGlobals, address, stateManager.currentCycleShardData.parititionShardDataMap)
  return homeNode.consensusNodeForOurNodeFull.map(node => node.id)
}

function isReceiptMajority (receipt, consensusGroup) {
  return ((receipt.signs.length / consensusGroup.size) * 100 >= 60)
}

function intersect(a, b) {
  const setB = new Set(b)
  return [...new Set(a)].filter(x => setB.has(x))
}

function intersectCount(a, b) {
  return intersect(a, b).length
}

function percentOverlap(a, b) {
  return (a.length / b.length) * 100
}