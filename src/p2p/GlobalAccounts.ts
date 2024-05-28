/**
 * [NOTE] [AS] To break this modules dependency on Wrapper, search for
 * all references to 'p2p' imported from Wrapper and replace them with
 * a direct call to whatever Wrapper.p2p was calling
 */

import { logFlags } from '../logger'
import { P2P } from '@shardus/types'
import ShardFunctions from '../state-manager/shardFunctions'
import * as utils from '../utils'
import * as Comms from './Comms'
import * as Context from './Context'
import * as NodeList from './NodeList'
import * as Self from './Self'
import { profilerInstance } from '../utils/profiler'
import { OpaqueTransaction } from '../shardus/shardus-types'
import { shardusGetTime } from '../network'
import { InternalBinaryHandler } from '../types/Handler'
import { InternalRouteEnum } from '../types/enum/InternalRouteEnum'
import { nestedCountersInstance } from '../utils/nestedCounters'
import { RequestErrorEnum } from '../types/enum/RequestErrorEnum'
import { getStreamWithTypeCheck, requestErrorHandler } from '../types/Helpers'
import { TypeIdentifierEnum } from '../types/enum/TypeIdentifierEnum'
import { MakeReceiptReq, deserializeMakeReceiptReq, serializeMakeReceiptReq } from '../types/MakeReceipReq'
import { Utils } from '@shardus/types'
import { nodeListFromStates } from './Join'

/** ROUTES */
// [TODO] - need to add validattion of types to the routes

// const makeReceiptRoute: P2P.P2PTypes.Route<
//   P2P.P2PTypes.InternalHandler<P2P.GlobalAccountsTypes.SignedSetGlobalTx, unknown, string>
// > = {
//   name: 'make-receipt',
//   handler: (payload, respond, sender) => {
//     profilerInstance.scopedProfileSectionStart('make-receipt')
//     try {
//       makeReceipt(payload, sender)
//     } finally {
//       profilerInstance.scopedProfileSectionEnd('make-receipt')
//     }
//   },
// }

const makeReceiptBinaryHandler: P2P.P2PTypes.Route<InternalBinaryHandler<Buffer>> = {
  name: InternalRouteEnum.binary_make_receipt,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  handler: async (payload, respond, header, sign) => {
    const route = InternalRouteEnum.binary_make_receipt
    nestedCountersInstance.countEvent('internal', route)
    profilerInstance.scopedProfileSectionStart(route)
    const errorHandler = (
      errorType: RequestErrorEnum,
      opts?: { customErrorLog?: string; customCounterSuffix?: string }
    ): void => requestErrorHandler(route, errorType, header, opts)
    try {
      const requestStream = getStreamWithTypeCheck(payload, TypeIdentifierEnum.cMakeReceiptReq)
      if (!requestStream) {
        return errorHandler(RequestErrorEnum.InvalidRequest)
      }
      const req: MakeReceiptReq = deserializeMakeReceiptReq(requestStream)
      makeReceipt(req, header.sender_id)
    } catch (e) {
      nestedCountersInstance.countEvent('internal', `${route}-exception`)
      Context.logger
        .getLogger('p2p')
        .error(`${route}: Exception executing request: ${utils.errorToStringFull(e)}`)
    } finally {
      profilerInstance.scopedProfileSectionEnd(route)
    }
  },
}

const setGlobalGossipRoute: P2P.P2PTypes.Route<P2P.P2PTypes.GossipHandler<P2P.GlobalAccountsTypes.Receipt>> =
  {
    name: 'set-global',
    handler: (payload, sender, tracker) => {
      profilerInstance.scopedProfileSectionStart('set-global')
      try {
        if (validateReceipt(payload) === false) return
        if (processReceipt(payload) === false) return
        /** [TODO] [AS] Replace with Comms.sendGossip() */
        // p2p.sendGossipIn('set-global', payload)
        Comms.sendGossip('set-global', payload, tracker, sender, nodeListFromStates([
          P2P.P2PTypes.NodeStatus.ACTIVE,
          P2P.P2PTypes.NodeStatus.READY,
          P2P.P2PTypes.NodeStatus.SYNCING,
        ]), false)
      } finally {
        profilerInstance.scopedProfileSectionEnd('set-global')
      }
    },
  }

/** STATE */

let lastClean = 0

const receipts = new Map<P2P.GlobalAccountsTypes.TxHash, P2P.GlobalAccountsTypes.Receipt>()
const trackers = new Map<P2P.GlobalAccountsTypes.TxHash, P2P.GlobalAccountsTypes.Tracker>()

/** FUNCTIONS */

export function init() {
  // Register routes
  // Comms.registerInternal(makeReceiptRoute.name, makeReceiptRoute.handler)
  Comms.registerInternalBinary(makeReceiptBinaryHandler.name, makeReceiptBinaryHandler.handler)
  Comms.registerGossipHandler(setGlobalGossipRoute.name, setGlobalGossipRoute.handler)
}

export function setGlobal(address, value, when, source) {
  if (logFlags.console) console.log(`SETGLOBAL: WE ARE: ${Self.id.substring(0, 5)}`)

  // Only do this if you're active
  if (!Self.isActive) {
    if (logFlags.console) console.log('setGlobal: Not active yet')
    return
  }

  // Create a tx for setting a global account
  const tx: P2P.GlobalAccountsTypes.SetGlobalTx = { address, value, when, source }
  const txHash = Context.crypto.hash(tx)

  // Sign tx
  const signedTx: P2P.GlobalAccountsTypes.SignedSetGlobalTx = Context.crypto.sign(tx)

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
  if (logFlags.console)
    console.log(`SETGLOBAL: CONSENSUS_GROUP: ${consensusGroup.map((n) => n.id.substring(0, 5))}`)
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
    if (logFlags.console) console.log(`SETGLOBAL: GOT RECEIPT: ${txHash} ${Utils.safeStringify(receipt)}`)
    clearTimeout(timer)
    // Gossip receipt to every node in network to apply to global account
    if (processReceipt(receipt) === false) return
    /** [TODO] [AS] Replace with Comms.sendGossip */
    // p2p.sendGossipIn('set-global', receipt)
    Comms.sendGossip('set-global', receipt, '', null, nodeListFromStates([
      P2P.P2PTypes.NodeStatus.ACTIVE,
      P2P.P2PTypes.NodeStatus.READY,
      P2P.P2PTypes.NodeStatus.SYNCING,
    ]), true)
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
  // if (Context.config.p2p.useBinarySerializedEndpoints && Context.config.p2p.makeReceiptBinary) {
    const request = signedTx as MakeReceiptReq
    Comms.tellBinary<MakeReceiptReq>(
      consensusGroup,
      InternalRouteEnum.binary_make_receipt,
      request,
      serializeMakeReceiptReq,
      {}
    )
  // } else {
    // Comms.tell(consensusGroup, 'make-receipt', signedTx)
  // }
}

export function createMakeReceiptHandle(txHash: string) {
  return `receipt-${txHash}`
}

export function makeReceipt(
  signedTx: P2P.GlobalAccountsTypes.SignedSetGlobalTx,
  sender: P2P.P2PTypes.NodeInfo['id']
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
  let receipt: P2P.GlobalAccountsTypes.Receipt = receipts.get(txHash)
  if (!receipt) {
    const consensusGroup = new Set(getConsensusGroupIds(tx.source))
    receipt = {
      signs: [],
      tx: null,
      consensusGroup,
    }
    receipts.set(txHash, receipt)
    if (logFlags.console)
      console.log(
        `SETGLOBAL: MAKERECEIPT CONSENSUS GROUP FOR ${txHash.substring(0, 5)}: ${Utils.safeStringify(
          [...receipt.consensusGroup].map((id) => id.substring(0, 5))
        )}`
      )
  }

  let tracker: P2P.GlobalAccountsTypes.Tracker = trackers.get(txHash)
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
  if (logFlags.console)
    console.log(
      `SETGLOBAL: GOT SIGNED_SET_GLOBAL_TX FROM ${sender.substring(0, 5)}: ${txHash} ${Utils.safeStringify(
        signedTx
      )}`
    )
  if (logFlags.console)
    console.log(
      `SETGLOBAL: ${receipt.signs.length} RECEIPTS / ${receipt.consensusGroup.size} CONSENSUS_GROUP`
    )
  if (isReceiptMajority(receipt, receipt.consensusGroup)) {
    const handle = createMakeReceiptHandle(txHash)
    /** [TODO] [AS] Replace with Self.emitter.emit() */
    // p2p.emit(handle, receipt)
    Self.emitter.emit(handle, receipt)
  }
}

export function processReceipt(receipt: P2P.GlobalAccountsTypes.Receipt) {
  const txHash = Context.crypto.hash(receipt.tx)
  const tracker = trackers.get(txHash) || createTracker(txHash)
  tracker.timestamp = receipt.tx.when
  if (tracker.gossiped) return false
  Context.shardus.put(receipt.tx.value as OpaqueTransaction, false, true)
  /* prettier-ignore */ if (logFlags.console) console.log(`Processed set-global receipt: ${Utils.safeStringify(receipt)} now:${shardusGetTime()}`)
  tracker.gossiped = true
  attemptCleanup()
  return true
}

export function attemptCleanup() {
  const now = shardusGetTime()
  if (now - lastClean < 60000) return
  lastClean = now

  for (const [txHash, tracker] of trackers) {
    if (now - tracker.timestamp > 30000) {
      trackers.delete(txHash)
      receipts.delete(txHash)
    }
  }
}

function validateReceipt(receipt: P2P.GlobalAccountsTypes.Receipt) {
  if (Context.stateManager.currentCycleShardData === null) {
    // we may get this endpoint way before we are ready, so just log it can exit out
    if (logFlags.console)
      console.log('validateReceipt: unable to validate receipt currentCycleShardData not ready')
    return false
  }

  const consensusGroup = new Set(getConsensusGroupIds(receipt.tx.source))
  // Make sure receipt has enough signs
  if (isReceiptMajority(receipt, consensusGroup) === false) {
    if (logFlags.console) console.log('validateReceipt: Receipt did not have majority')
    return false
  }
  // Make a map of signs that overlap with consensusGroup
  const signsInConsensusGroup: P2P.P2PTypes.Signature[] = []
  const uniqueSignOwnerMap = {}

  for (const sign of receipt.signs) {
    const owner = sign.owner.toLowerCase()
    if (uniqueSignOwnerMap[owner]) {
      if (logFlags.console)
        console.log(`validateReceipt: duplicate signatures for owner ${utils.stringifyReduce(sign.owner)}`)
      continue
    }
    uniqueSignOwnerMap[owner] = true

    /** [TODO] [AS] Replace with NodeList.byPubKey.get() */
    // const node = p2p.state.getNodeByPubKey(sign.owner)
    const node = NodeList.byPubKey.get(sign.owner)

    if (node === null) {
      if (logFlags.console)
        console.log(`validateReceipt: node was null or not found ${utils.stringifyReduce(sign.owner)}`)
      /** [TODO] [AS] Replace with NodeList.nodes */
      if (logFlags.console)
        console.log(
          // `validateReceipt: nodes: ${utils.stringifyReduce(p2p.state.getNodes())}`
          `validateReceipt: nodes: ${utils.stringifyReduce(NodeList.nodes)}`
        )
      continue
    }

    const id = node.id
    if (consensusGroup.has(id)) {
      signsInConsensusGroup.push(sign)
    } else {
      if (logFlags.console)
        console.log(
          `validateReceipt: consensusGroup does not have id: ${id} ${utils.stringifyReduce(consensusGroup)}`
        )
    }
  }
  // Make sure signs and consensusGroup overlap >= %60
  if ((signsInConsensusGroup.length / consensusGroup.size) * 100 < 60) {
    if (logFlags.console)
      console.log('validateReceipt: Receipt signature owners and consensus group did not overlap enough')
    return false
  }
  // Verify the signs that overlap with consensusGroup are a majority
  let verified = 0
  for (const sign of signsInConsensusGroup) {
    const signedTx = { ...receipt.tx, sign }
    if (Context.crypto.verify(signedTx)) verified++
  }
  if ((verified / consensusGroup.size) * 100 < 60) {
    if (logFlags.console) console.log('validateReceipt: Receipt does not have enough valid signatures')
    return false
  }
  if (logFlags.console) console.log(`validateReceipt: success! ${utils.stringifyReduce(receipt)}`)
  return true
}

function createTracker(txHash) {
  const tracker = {
    seen: new Set<P2P.P2PTypes.NodeInfo['id']>(),
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
