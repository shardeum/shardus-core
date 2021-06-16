/**
 * [NOTE] [AS] To break this modules dependency on Wrapper, search for
 * all references to 'p2p' imported from Wrapper and replace them with
 * a direct call to whatever Wrapper.p2p was calling
 */

import ShardFunctions from '../state-manager/shardFunctions'
import * as utils from '../utils'
import * as Comms from './Comms'
import * as Context from './Context'
import * as NodeList from './NodeList'
import * as Self from './Self'
import {
  GossipHandler,
  InternalHandler,
  NodeInfo,
  Route,
  Signature,
} from '../shared-types/p2p/P2PTypes'
import {logFlags} from '../logger'
import { SignedSetGlobalTx, Receipt, TxHash, Tracker, SetGlobalTx } from '../shared-types/p2p/GlobalAccountsTypes'

/** ROUTES */
// [TODO] - need to add validattion of types to the routes

const makeReceiptRoute: Route<InternalHandler<
  SignedSetGlobalTx,
  unknown,
  string
>> = {
  name: 'make-receipt',
  handler: (payload, respond, sender) => {
    makeReceipt(payload, sender)
  },
}

const setGlobalGossipRoute: Route<GossipHandler<Receipt>> = {
  name: 'set-global',
  handler: (payload, sender, tracker) => {
    if (validateReceipt(payload) === false) return
    if (processReceipt(payload) === false) return
    /** [TODO] [AS] Replace with Comms.sendGossip() */
    // p2p.sendGossipIn('set-global', payload)
    Comms.sendGossip('set-global', payload, tracker, sender, NodeList.byIdOrder, false)
  },
}

/** STATE */

let lastClean = 0

const receipts = new Map<TxHash, Receipt>()
const trackers = new Map<TxHash, Tracker>()

/** FUNCTIONS */

export function init() {
  // Register routes
  Comms.registerInternal(makeReceiptRoute.name, makeReceiptRoute.handler)
  Comms.registerGossipHandler(
    setGlobalGossipRoute.name,
    setGlobalGossipRoute.handler
  )
}

export function setGlobal(address, value, when, source) {
  /** [TODO] [AS] Replace with Self.id */
  // if (logFlags.console) console.log(`SETGLOBAL: WE ARE: ${p2p.id.substring(0, 5)}`)
  if (logFlags.console) console.log(`SETGLOBAL: WE ARE: ${Self.id.substring(0, 5)}`)

  // Only do this if you're active
  /** [TODO] [AS] Replace with Self.isActive */
  // if (!p2p.isActive) {
  if (!Self.isActive) {
    if (logFlags.console) console.log('setGlobal: Not active yet')
    return
  }

  // Create a tx for setting a global account
  const tx: SetGlobalTx = { address, value, when, source }
  const txHash = Context.crypto.hash(tx)

  // Sign tx
  const signedTx: SignedSetGlobalTx = Context.crypto.sign(tx)

  if (Context.stateManager === null) {
    if (logFlags.console) console.log('setGlobal: stateManager == null')
  } else {
    if (logFlags.console) console.log('setGlobal: stateManager != null')
  }

  // Get the nodes that tx will be broadcasted to
  if (!Context.stateManager.currentCycleShardData) {
    if (logFlags.console) console.log('stateManager.currentCycleShardData == null')

    return
  }
  const homeNode = ShardFunctions.findHomeNode(
    Context.stateManager.currentCycleShardData.shardGlobals,
    source,
    Context.stateManager.currentCycleShardData.parititionShardDataMap
  )
  const consensusGroup = [...homeNode.consensusNodeForOurNodeFull]
  if (logFlags.console) console.log(
    `SETGLOBAL: CONSENSUS_GROUP: ${consensusGroup.map((n) =>
      n.id.substring(0, 5)
    )}`
  )
  /** [TODO] [AS] Replace p2p.id with Self.id */
  // const ourIdx = consensusGroup.findIndex(node => node.id === p2p.id)
  const ourIdx = consensusGroup.findIndex((node) => node.id === Self.id)
  if (ourIdx === -1) return // Return if we're not in the consensusGroup
  consensusGroup.splice(ourIdx, 1) // Remove ourself from consensusGroup

  // Using makeReceipt API

  // Get ready to process receipts into a receiptCollection, or to timeout
  const timeout = 10000 // [TODO] adjust this to stop early timeouts
  const handle = createMakeReceiptHandle(txHash)

  const onTimeout = () => {
    if (logFlags.console) console.log(`SETGLOBAL: TIMED OUT: ${txHash}`)
    /** [TODO] [AS] Replace with Self.emitter.removeListener */
    // p2p.removeListener(handle, onReceipt)
    Self.emitter.removeListener(handle, onReceipt)
    attemptCleanup()
  }
  const timer = setTimeout(onTimeout, timeout)

  const onReceipt = (receipt) => {
    if (logFlags.console) console.log(`SETGLOBAL: GOT RECEIPT: ${txHash} ${JSON.stringify(receipt)}`)
    clearTimeout(timer)
    // Gossip receipt to every node in network to apply to global account
    if (processReceipt(receipt) === false) return
    /** [TODO] [AS] Replace with Comms.sendGossip */
    // p2p.sendGossipIn('set-global', receipt)
    Comms.sendGossip('set-global', receipt, '', null, NodeList.byIdOrder, true)
  }
  /** [TODO] [AS] Replace with Self.emitter.on() */
  // p2p.on(handle, onReceipt)
  Self.emitter.on(handle, onReceipt)

  // Broadcast tx to /makeReceipt of all nodes in source consensus group to trigger creation of receiptCollection
  /** [TODO] [AS] Replace with Self.id */
  // makeReceipt(signedTx, p2p.id) // Need this because internalRoute handler ignores messages from ourselves
  makeReceipt(signedTx, Self.id) // Need this because internalRoute handler ignores messages from ourselves
  /** [TODO] [AS] Replace with Comms.tell */
  // p2p.tell(consensusGroup, 'make-receipt', signedTx)
  Comms.tell(consensusGroup, 'make-receipt', signedTx)
}

export function createMakeReceiptHandle(txHash: string) {
  return `receipt-${txHash}`
}

export function makeReceipt(
  signedTx: SignedSetGlobalTx,
  sender: NodeInfo['id']
) {
  if (!Context.stateManager) {
    if (logFlags.console) console.log('GlobalAccounts: makeReceipt: stateManager not ready')
    return
  }

  const sign = signedTx.sign

  const tx = { ...signedTx }
  delete tx.sign

  const txHash = Context.crypto.hash(tx)

  // Put into correct Receipt and Tracker
  let receipt: Receipt = receipts.get(txHash)
  if (!receipt) {
    const consensusGroup = new Set(getConsensusGroupIds(tx.source))
    receipt = {
      signs: [],
      tx: null,
      consensusGroup,
    }
    receipts.set(txHash, receipt)
    if (logFlags.console) console.log(
      `SETGLOBAL: MAKERECEIPT CONSENSUS GROUP FOR ${txHash.substring(
        0,
        5
      )}: ${JSON.stringify(
        [...receipt.consensusGroup].map((id) => id.substring(0, 5))
      )}`
    )
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
  if (logFlags.console) console.log(
    `SETGLOBAL: GOT SIGNED_SET_GLOBAL_TX FROM ${sender.substring(
      0,
      5
    )}: ${txHash} ${JSON.stringify(signedTx)}`
  )
  if (logFlags.console) console.log(
    `SETGLOBAL: ${receipt.signs.length} RECEIPTS / ${receipt.consensusGroup.size} CONSENSUS_GROUP`
  )
  if (isReceiptMajority(receipt, receipt.consensusGroup)) {
    const handle = createMakeReceiptHandle(txHash)
    /** [TODO] [AS] Replace with Self.emitter.emit() */
    // p2p.emit(handle, receipt)
    Self.emitter.emit(handle, receipt)
  }
}

export function processReceipt(receipt: Receipt) {
  const txHash = Context.crypto.hash(receipt.tx)
  const tracker = trackers.get(txHash) || createTracker(txHash)
  tracker.timestamp = receipt.tx.when
  if (tracker.gossiped) return false
  Context.shardus.put(receipt.tx.value, false, true)
  if (logFlags.console) console.log(`Processed set-global receipt: ${JSON.stringify(receipt)}`)
  tracker.gossiped = true
  attemptCleanup()
  return true
}

export function attemptCleanup() {
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
  if (Context.stateManager.currentCycleShardData === null) {
    // we may get this endpoint way before we are ready, so just log it can exit out
    if (logFlags.console) console.log(
      'validateReceipt: unable to validate receipt currentCycleShardData not ready'
    )
    return false
  }

  const consensusGroup = new Set(getConsensusGroupIds(receipt.tx.source))
  // Make sure receipt has enough signs
  if (isReceiptMajority(receipt, consensusGroup) === false) {
    if (logFlags.console) console.log('validateReceipt: Receipt did not have majority')
    return false
  }
  // Make a map of signs that overlap with consensusGroup
  const signsInConsensusGroup: Signature[] = []
  for (const sign of receipt.signs) {
    /** [TODO] [AS] Replace with NodeList.byPubKey.get() */
    // const node = p2p.state.getNodeByPubKey(sign.owner)
    const node = NodeList.byPubKey.get(sign.owner)

    if (node === null) {
      if (logFlags.console) console.log(
        `validateReceipt: node was null or not found ${utils.stringifyReduce(
          sign.owner
        )}`
      )
      /** [TODO] [AS] Replace with NodeList.nodes */
      if (logFlags.console) console.log(
        // `validateReceipt: nodes: ${utils.stringifyReduce(p2p.state.getNodes())}`
        `validateReceipt: nodes: ${utils.stringifyReduce(NodeList.nodes)}`
      )
      continue
    }

    const id = node.id
    if (consensusGroup.has(id)) {
      signsInConsensusGroup.push(sign)
    } else {
      if (logFlags.console) console.log(
        `validateReceipt: consensusGroup does not have id: ${id} ${utils.stringifyReduce(
          consensusGroup
        )}`
      )
    }
  }
  // Make sure signs and consensusGroup overlap >= %60
  if ((signsInConsensusGroup.length / consensusGroup.size) * 100 < 60) {
    if (logFlags.console) console.log(
      'validateReceipt: Receipt signature owners and consensus group did not overlap enough'
    )
    return false
  }
  // Verify the signs that overlap with consensusGroup are a majority
  let verified = 0
  for (const sign of signsInConsensusGroup) {
    const signedTx = { ...receipt.tx, sign }
    if (Context.crypto.verify(signedTx)) verified++
  }
  if ((verified / consensusGroup.size) * 100 < 60) {
    if (logFlags.console) console.log(
      'validateReceipt: Receipt does not have enough valid signatures'
    )
    return false
  }
  if (logFlags.console) console.log(`validateReceipt: success! ${utils.stringifyReduce(receipt)}`)
  return true
}

function createTracker(txHash) {
  const tracker = {
    seen: new Set<NodeInfo['id']>(),
    timestamp: 0,
    gossiped: false,
  }
  trackers.set(txHash, tracker)
  return tracker
}

function getConsensusGroupIds(address) {
  const homeNode = ShardFunctions.findHomeNode(
    Context.stateManager.currentCycleShardData.shardGlobals,
    address,
    Context.stateManager.currentCycleShardData.parititionShardDataMap
  )
  return homeNode.consensusNodeForOurNodeFull.map((node) => node.id)
}

function isReceiptMajority(receipt, consensusGroup) {
  return (receipt.signs.length / consensusGroup.size) * 100 >= 60
}

function intersect(a, b) {
  const setB = new Set(b)
  return [...new Set(a)].filter((x) => setB.has(x))
}

function intersectCount(a, b) {
  return intersect(a, b).length
}

function percentOverlap(a, b) {
  return (a.length / b.length) * 100
}
