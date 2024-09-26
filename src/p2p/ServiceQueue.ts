import { Logger } from 'log4js'
import { config, crypto, logger, network, stateManager } from './Context'
import * as CycleChain from './CycleChain'
import { P2P, Utils } from '@shardus/types'
import { ShardusEvent, Sign } from '../shardus/shardus-types'
import * as utils from '../utils'
import { isValidShardusAddress, stringifyReduce, validateTypes } from '../utils'
import * as Comms from './Comms'
import { profilerInstance } from '../utils/profiler'
import * as Self from './Self'
import { currentCycle, currentQuarter } from './CycleCreator'
import { logFlags } from '../logger'
import * as Nodelist from './NodeList'
import { byIdOrder } from './NodeList'
import { nestedCountersInstance } from '../utils/nestedCounters'
import { getFromArchiver } from './Archivers'
import { Result } from 'neverthrow'
import { getRandomAvailableArchiver } from './Utils'
import { isDebugModeMiddleware } from '../network/debugMiddleware'
import { nodeListFromStates } from './Join'
import { ShardusTypes } from '../index'
import ShardFunctions from '../state-manager/shardFunctions'
import { Route, SignedObject } from '@shardus/types/build/src/p2p/P2PTypes'
import { InternalRouteEnum } from '../types/enum/InternalRouteEnum'
import {
  deserializeServiceQueueSendVoteReq,
  serializeServiceQueueSendVoteReq,
  ServiceQueueVote,
} from '../types/ServiceQueueSendVoteReq'
import { InternalBinaryHandler } from '../types/Handler'
import { getStreamWithTypeCheck } from '../types/Helpers'
import { TypeIdentifierEnum } from '../types/enum/TypeIdentifierEnum'
import { verifyPayload } from '../types/ajv/Helpers'
import { AJVSchemaEnum } from '../types/enum/AJVSchemaEnum'

interface VerifierEntry {
  hash: string
  tx: P2P.ServiceQueueTypes.AddNetworkTx
  votes: {
    txHash: string
    verifierType: 'beforeAdd' | 'apply'
    result: boolean
    sign: Sign
  }[]
  newVotes: boolean
  executionGroup: string[]
  appliedReceipt: any
  hasSentFinalReceipt: boolean
}

type VotingProposal =
  | {
      networkTx: P2P.ServiceQueueTypes.AddNetworkTx
      verifierType: 'beforeAdd'
    }
  | {
      networkTx: P2P.ServiceQueueTypes.RemoveNetworkTx
      verifierType: 'apply'
    }

/** STATE */

let p2pLogger: Logger
let txList: P2P.ServiceQueueTypes.NetworkTxEntry[] = []
let txAdd: P2P.ServiceQueueTypes.AddNetworkTx[] = []
let txRemove: P2P.ServiceQueueTypes.RemoveNetworkTx[] = []
const shutdownHandlers = new Map<
  string,
  (
    activeNode: P2P.NodeListTypes.Node,
    record: P2P.CycleCreatorTypes.CycleRecord
  ) => Omit<P2P.ServiceQueueTypes.AddNetworkTx, 'cycle' | 'hash'> | null | undefined
>()
const beforeAddVerifier = new Map<string, (txEntry: P2P.ServiceQueueTypes.AddNetworkTx) => Promise<boolean>>()
const applyVerifier = new Map<string, (txEntry: P2P.ServiceQueueTypes.AddNetworkTx) => Promise<boolean>>()
const tryCounts = new Map<string, number>()
const processTxVerifiers = new Map<string, VerifierEntry>()
const addProposals: P2P.ServiceQueueTypes.AddNetworkTx[] = []
const removeProposals: P2P.ServiceQueueTypes.RemoveNetworkTx[] = []

/** ROUTES */

const addTxGossipRoute: P2P.P2PTypes.GossipHandler<VerifierEntry & SignedObject> = async (
  payload,
  sender,
  tracker
) => {
  /* prettier-ignore */ nestedCountersInstance.countEvent(`gossip-addtx`, `gossip receive - ${payload?.hash}`)
  profilerInstance.scopedProfileSectionStart('serviceQueue - addTx')

  if ([1, 2].includes(currentQuarter) === false) {
    /* prettier-ignore */ if (logFlags.error) info('gossip-addtx: Got request after quarter 2')
    return
  }

  try {
    /* prettier-ignore */ if (logFlags.p2pNonFatal) info(`Got addTx gossip: ${Utils.safeStringify(payload)}`)
    const err = verifyPayload(AJVSchemaEnum.ServiceQueueAddTxReq, payload)
    if (err) {
      warn('addTxGossipRoute bad payload: ' + err)
      return
    }

    const signer = Nodelist.byPubKey.get(payload.sign.owner)
    if (!signer) {
      /* prettier-ignore */ if (logFlags.error) warn('gossip-addtx: Got request from unknown node')
      return
    }

    if (txAdd.some((entry) => entry.hash === payload.hash)) {
      return
    }

    if (!crypto.verify(payload, payload.sign.owner)) {
      if (logFlags.console) console.log(`addTxGossipRoute(): signature invalid`, payload.sign.owner)
      /* prettier-ignore */ nestedCountersInstance.countEvent('serviceQueue.ts', `addTxGossipRoute(): signature invalid`)
      return
    }

    if (!verifyAppliedReceipt(payload)) {
      warn('addTxGossipRoute: appliedReceipt verification failed')
      return
    }
    const addTxCopy = structuredClone(payload.tx)
    const { sign, ...txDataWithoutSign } = addTxCopy.txData
    addTxCopy.txData = txDataWithoutSign
    txAdd.push(addTxCopy)

    /* prettier-ignore */ nestedCountersInstance.countEvent(`gossip-addtx`, `gossip send - ${payload.hash}`)
    Comms.sendGossip(
      'gossip-addtx',
      payload,
      tracker,
      Self.id,
      nodeListFromStates([
        P2P.P2PTypes.NodeStatus.ACTIVE,
        P2P.P2PTypes.NodeStatus.READY,
        P2P.P2PTypes.NodeStatus.SYNCING,
      ]),
      false
    ) // use Self.id so we don't gossip to ourself
  } catch (e) {
    console.error(`Error processing addTxGossipRoute handler: ${e}`)
    nestedCountersInstance.countEvent('internal', `addTxGossipRoute ${InternalRouteEnum.binary_service_queue_send_vote}-exception`)
    error(`addTxGossipRoute: Exception executing request: ${utils.errorToStringFull(e)}`)
  } finally {
    profilerInstance.scopedProfileSectionEnd('serviceQueue - addTx')
  }
}

const removeTxGossipRoute: P2P.P2PTypes.GossipHandler<VerifierEntry & SignedObject> = async (
  payload,
  sender,
  tracker
) => {
  /* prettier-ignore */ nestedCountersInstance.countEvent(`gossip-removetx`, `gossip receive - ${payload?.txHash}`)
  profilerInstance.scopedProfileSectionStart('serviceQueue - removeTx')

  if ([1, 2].includes(currentQuarter) === false) {
    /* prettier-ignore */ if (logFlags.error) info('gossip-removetx: Got request after quarter 2')
    return
  }

  try {
    // this will be checked in _removeNetworkTx, but more performant to check it before crypto.verify as well
    const index = txList.findIndex((entry) => entry.hash === payload.hash)
    if (index === -1) {
      /* prettier-ignore */ if (logFlags.p2pNonFatal) warn(`TxHash ${payload.hash} does not exist in txList`)
      return false
    }

    /* prettier-ignore */ if (logFlags.p2pNonFatal) info(`Got removeTx gossip: ${Utils.safeStringify(payload)}`)
    const err = verifyPayload(AJVSchemaEnum.ServiceQueueAddTxReq, payload)
    if (err) {
      warn('removeTxGossipRoute bad payload: ' + err)
      return
    }

    if (txRemove.some((entry) => entry.txHash === payload.hash)) {
      return
    }

    if (!crypto.verify(payload, payload.sign.owner)) {
      if (logFlags.console) console.log(`removeTxGossipRoute(): signature invalid`, payload.sign.owner)
      /* prettier-ignore */ nestedCountersInstance.countEvent('serviceQueue.ts', `removeTxGossipRoute(): signature invalid`)
      return
    }

    // could also place check inside _removeNetworkTx
    if (!verifyAppliedReceipt(payload)) {
      return
    }
    txRemove.push({ txHash: payload.hash, cycle: payload.tx.cycle })

    /* prettier-ignore */ nestedCountersInstance.countEvent(`gossip-removetx`, `gossip send - ${payload.txHash}`)
    Comms.sendGossip(
      'gossip-removetx',
      payload,
      tracker,
      Self.id,
      nodeListFromStates([
        P2P.P2PTypes.NodeStatus.ACTIVE,
        P2P.P2PTypes.NodeStatus.READY,
        P2P.P2PTypes.NodeStatus.SYNCING,
      ]),
      false
    ) // use Self.id so we don't gossip to ourself
  } catch(e) {
    console.error(`Error processing removeTxGossipRoute handler: ${e}`)
    nestedCountersInstance.countEvent('internal', `removeTxGossipRoute ${InternalRouteEnum.binary_service_queue_send_vote}-exception`)
    error(`removeTxGossipRoute: Exception executing request: ${utils.errorToStringFull(e)}`)
  } finally {
    profilerInstance.scopedProfileSectionEnd('serviceQueue - removeTx')
  }
}

const sendVoteHandler: Route<InternalBinaryHandler<Buffer>> = {
  name: InternalRouteEnum.binary_service_queue_send_vote,
  handler: async (payload, respond, header, sign) => {
    const route = InternalRouteEnum.binary_service_queue_send_vote
    try {
      profilerInstance.scopedProfileSectionStart(route, false)
      const stream = getStreamWithTypeCheck(payload, TypeIdentifierEnum.cServiceQueueSendVoteReq)
      if (!payload) {
        nestedCountersInstance.countEvent('internal', `${route}-invalid_request`)
        return
      }
      const collectedVote = deserializeServiceQueueSendVoteReq(stream)

      if (![1, 2].includes(currentQuarter)) {
        /* prettier-ignore */ nestedCountersInstance.countEvent('serviceQueue', 'send-vote: quarter not 1 or 2')
        return
      }

      if (!collectedVote.sign) {
        /* prettier-ignore */ nestedCountersInstance.countEvent('serviceQueue', 'send-vote: no sign found')
        return
      }

      if (!crypto.verify(collectedVote, collectedVote.sign.owner)) {
        /* prettier-ignore */ nestedCountersInstance.countEvent('serviceQueue', 'send-vote: signature invalid')
        return
      }

      if (!processTxVerifiers.has(collectedVote.txHash)) {
        console.log(
          ` red - processTxVerifiers.has(collectedVote.txHash) not found: ${collectedVote.txHash}`,
          processTxVerifiers
        )
        /* prettier-ignore */ nestedCountersInstance.countEvent('serviceQueue', `send-vote: tx not in processTxVerifiers: ${collectedVote.txHash}`)
        return
      }

      if (processTxVerifiers.get(collectedVote.txHash).hasSentFinalReceipt) {
        /* prettier-ignore */ nestedCountersInstance.countEvent('serviceQueue', 'send-vote: tx already has sent final receipt')
        return
      }

      tryAppendVote(processTxVerifiers.get(collectedVote.txHash), collectedVote)
      await tryProduceReceipt(processTxVerifiers.get(collectedVote.txHash))
    } catch (e) {
      console.error(`Error processing sendVoteHandler handler: ${e}`)
      nestedCountersInstance.countEvent('internal', `${route}-exception`)
      error(`${route}: Exception executing request: ${utils.errorToStringFull(e)}`)
    } finally {
      profilerInstance.scopedProfileSectionEnd(route)
    }
  },
}

const routes = {
  external: [],
  internal: [],
  internalBinary: [sendVoteHandler],
  gossip: {
    ['gossip-addtx']: addTxGossipRoute,
    ['gossip-removetx']: removeTxGossipRoute,
  },
}

function tryAppendVote(
  queueEntry: VerifierEntry,
  collectedVote: {
    txHash: string
    verifierType: 'beforeAdd' | 'apply'
    result: boolean
    sign: any
  }
): boolean {
  console.log(' red - tryAppendVote', queueEntry, collectedVote)
  if (
    !executionGroupForAddress(queueEntry.tx.involvedAddress).some((node) => node === collectedVote.sign.owner)
  ) {
    console.log(' red - tryAppendVote not in execution group', queueEntry, collectedVote.sign.owner)
    nestedCountersInstance.countEvent('serviceQueue', 'Vote sender not in execution group')
    return false
  }

  const numVotes = queueEntry.votes.length

  if (numVotes === 0) {
    console.log(' red - tryAppendVote numVotes === 0', queueEntry, collectedVote)
    queueEntry.votes.push(collectedVote)
    queueEntry.newVotes = true
    return true
  }

  for (let i = 0; i < numVotes; i++) {
    // eslint-disable-next-line security/detect-object-injection
    const currentVote = queueEntry.votes[i]

    if (currentVote.sign.owner === collectedVote.sign.owner) {
      queueEntry.newVotes = false
      return false
    }
  }

  console.log(' red - tryAppendVote appended', queueEntry, collectedVote)
  queueEntry.votes.push(collectedVote)
  queueEntry.newVotes = true
  return true
}

function tryProduceReceipt(queueEntry: VerifierEntry): Promise<any> {
  try {
    console.log(' red - tryProduceReceipt starting', queueEntry)
    if (queueEntry.appliedReceipt != null) {
      nestedCountersInstance.countEvent(`serviceQueue`, 'tryProduceReceipt appliedReceipt != null')
      return queueEntry.appliedReceipt
    }

    let votingGroup = executionGroupForAddress(queueEntry.tx.involvedAddress)
    const majorityCount = Math.ceil(votingGroup.length * config.p2p.requiredVotesPercentage)
    const numVotes = queueEntry.votes.length
    console.log(' red - tryProduceReceipt votes', queueEntry, majorityCount, numVotes)
    if (numVotes < majorityCount) {
      return null
    }
    if (queueEntry.newVotes === false) {
      return null
    }
    queueEntry.newVotes = false
    let winningVote: { txHash: string; verifierType: 'beforeAdd' | 'apply'; result: boolean; sign: any }
    const hashCounts: Map<boolean, number> = new Map()

    for (let i = 0; i < numVotes; i++) {
      // eslint-disable-next-line security/detect-object-injection
      const currentVote = queueEntry.votes[i]
      const voteCount = hashCounts.get(currentVote.result) || 0
      hashCounts.set(currentVote.result, voteCount + 1)
      if (voteCount + 1 >= majorityCount) {
        winningVote = currentVote
        break
      }
    }

    if (winningVote != undefined) {
      const appliedReceipt: any = {
        txid: queueEntry.hash,
        result: winningVote.result,
        type: winningVote.verifierType,
        signatures: [],
      }
      for (let i = 0; i < numVotes; i++) {
        // eslint-disable-next-line security/detect-object-injection
        const currentVote = queueEntry.votes[i]
        if (currentVote.result === winningVote.result) {
          appliedReceipt.signatures.push(currentVote.sign)
        }
      }

      queueEntry.appliedReceipt = appliedReceipt

      queueEntry.hasSentFinalReceipt = true
      console.log(' red - tryProduceReceipt appliedReceipt', appliedReceipt)
      let route = ''
      if (queueEntry.appliedReceipt.type === 'beforeAdd') {
        route = 'gossip-addtx'
      } else {
        route = 'gossip-removetx'
      }
      console.log(' red - tryProduceReceipt sendGossip', route, appliedReceipt)
      const signedPayload = crypto.sign(queueEntry)
      Comms.sendGossip(route, signedPayload, null, null, byIdOrder, false, 4, queueEntry.hash, '', true)
      return appliedReceipt
    }
    return null
  } catch (e) {
    /* prettier-ignore */ if (logFlags.error) error(`serviceQueue - tryProduceReceipt: error ${queueEntry.hash} error: ${utils.formatErrorMessage(e)}`)
  }
}

function initVotingProcess(propsals: VotingProposal[]): void {
  console.log(' red - initVotingProcess', propsals)
  try {
    startVoting(propsals)
  } catch (e) {
    console.log(' red - initVotingProcess error', e)
    error(`serviceQueue - initVotingProcess: error ${utils.formatErrorMessage(e)}`)
  }
}

async function startVoting(proposals: VotingProposal[]): Promise<void> {
  console.log(' red - startVoting', proposals)
  for (const proposal of proposals) {
    if (proposal.verifierType === 'apply') {
      const index = txList.findIndex((entry) => entry.hash === proposal.networkTx.txHash)
      if (index === -1) {
        error(`TxHash ${proposal.networkTx.txHash} does not exist in txList`)
        return
      }
      const voteResult = await validateRemoveTx(proposal.networkTx)
      voteForNetworkTx(txList[index].tx, proposal.verifierType, voteResult)
    } else {
      const voteResult = await validateAddTx(proposal.networkTx)
      voteForNetworkTx(
        proposal.networkTx as P2P.ServiceQueueTypes.AddNetworkTx,
        proposal.verifierType,
        voteResult
      )
    }
  }
}

/** FUNCTIONS */

/** CycleCreator Functions */

export function init(): void {
  p2pLogger = logger.getLogger('p2p')

  reset()

  for (const route of routes.internal) {
    Comms.registerInternal(route.name, route.handler)
  }

  for (const [name, handler] of Object.entries(routes.gossip)) {
    Comms.registerGossipHandler(name, handler)
  }

  for (const route of routes.internalBinary) {
    Comms.registerInternalBinary(route.name, route.handler)
  }

  network.registerExternalGet('debug-network-txlist', isDebugModeMiddleware, (req, res) => {
    res.send({ status: 'ok', txList })
  })

  network.registerExternalGet('debug-network-txlisthash', isDebugModeMiddleware, (req, res) => {
    res.send({ status: 'ok', txListHash: crypto.hash(txList) })
  })

  network.registerExternalGet('debug-drop-network-txhash', isDebugModeMiddleware, (req, res) => {
    const txHash = req?.query?.txHash
    if (txHash == null) {
      res.send({ status: 'fail', error: 'txHash not provided' })
      return
    }
    const index = txList.findIndex((entry) => entry.hash === txHash)
    if (index === -1) {
      res.send({ status: 'fail', error: 'txHash not found' })
      return
    }
    txList.splice(index, 1)
    res.send({ status: 'ok' })
  })

  network.registerExternalGet('debug-clear-network-txlist', isDebugModeMiddleware, (req, res) => {
    txList = []
    res.send({ status: 'ok' })
  })

  network.registerExternalGet('debug-network-txcount', isDebugModeMiddleware, (req, res) => {
    const copy = txList.map((entry) => ({
      ...entry,
      count: tryCounts.get(entry.hash) || 0,
    }))
    res.send({ status: 'ok', tryCounts: copy })
  })
}

export function reset(): void {
  txAdd = []
  txRemove = []

  for (const [hash, entry] of processTxVerifiers) {
    if (entry.hasSentFinalReceipt) {
      processTxVerifiers.delete(hash)
    }
  }
}

export function getTxs(): P2P.ServiceQueueTypes.Txs {
  return {
    txadd: [...txAdd],
    txremove: [...txRemove],
  }
}

export function validateRecordTypes(): string {
  return ''
}

export function updateRecord(
  txs: P2P.ServiceQueueTypes.Txs,
  record: P2P.CycleCreatorTypes.CycleRecord,
  prev: P2P.CycleCreatorTypes.CycleRecord
): void {
  record.txadd = txAdd.sort((a, b) => a.hash.localeCompare(b.hash))
  record.txremove = txRemove.sort((a, b) => a.txHash.localeCompare(b.txHash))

  // we need to get the hash of the txlist after the txadd and txremove
  // but we dont want to alter the txList, so we make a copy
  const txListCopy = structuredClone(txList)

  function applyTxAdd(txAddList: typeof record.txadd) {
    for (const txadd of txAddList) {
      const { sign, ...txDataWithoutSign } = txadd.txData
      sortedInsert(txListCopy, {
        hash: txadd.hash,
        tx: {
          hash: txadd.hash,
          txData: txDataWithoutSign,
          type: txadd.type,
          cycle: txadd.cycle,
          priority: txadd.priority,
          involvedAddress: txadd.involvedAddress,
          ...(txadd.subQueueKey && { subQueueKey: txadd.subQueueKey }),
        },
      })
    }
  }

  applyTxAdd(record.txadd)

  for (const txremove of record.txremove) {
    const index = txListCopy.findIndex((entry) => entry.hash === txremove.txHash)
    if (index === -1) {
      error(`updateRecord: TxHash ${txremove.txHash} does not exist in txListCopy`)
    } else {
      txListCopy.splice(index, 1)
    }
  }

  function processShutdownHandlers(cycleRecord: P2P.CycleCreatorTypes.CycleRecord) {
    Nodelist.activeByIdOrder.forEach((node) => {
      for (let [key, handler] of shutdownHandlers) {
        try {
          const txAddData = handler(node, cycleRecord)
          if (txAddData?.txData == null) continue

          const hash = crypto.hash(txAddData.txData)
          if (txListCopy.some((listEntry) => listEntry.hash === hash)) {
            warn(`shutdown - TxHash ${hash} already exists in txListCopy`)
            continue
          }

          const addTx = {
            ...txAddData,
            hash,
            cycle: currentCycle,
          }
          const entry = {
            hash,
            tx: addTx,
          }
          sortedInsert(txListCopy, entry)
          record.txadd.push(addTx)
        } catch (e) {
          error(`Failed to call shutdownHandler (${key}): ${e instanceof Error ? e.stack : e}`)
        }
      }
    })
  }

  if (record.mode === 'shutdown') {
    processShutdownHandlers(prev)
    processShutdownHandlers(record)
    record.txadd = txAdd.sort((a, b) => a.hash.localeCompare(b.hash))
  }
  record.txlisthash = crypto.hash(txListCopy)
}

export function parseRecord(record: P2P.CycleCreatorTypes.CycleRecord): P2P.CycleParserTypes.Change {
  if (record.joinedConsensors.some((entry) => entry.id === Self.id) && hasCycleBeenParsed(record)) {
    info('txList received from syncing has already applied the changes from parsing')
    return {
      added: [],
      removed: [],
      updated: [],
    }
  }

  for (const txadd of record.txadd) {
    if (txList.some((entry) => entry.hash === txadd.hash)) {
      error(`TxHash ${txadd.hash} already exists in txList`)
    } else {
      info(`Adding network tx of type ${txadd.type} and payload ${stringifyReduce(txadd.txData)}`)
      const { sign, ...txDataWithoutSign } = txadd.txData
      sortedInsert(txList, {
        hash: txadd.hash,
        tx: {
          hash: txadd.hash,
          txData: txDataWithoutSign,
          type: txadd.type,
          cycle: txadd.cycle,
          involvedAddress: txadd.involvedAddress,
          priority: txadd.priority,
          ...(txadd.subQueueKey && { subQueueKey: txadd.subQueueKey }),
        },
      })
    }
  }

  for (const txremove of record.txremove) {
    const index = txList.findIndex((entry) => entry.hash === txremove.txHash)
    if (index === -1) {
      error(`TxHash ${txremove.txHash} does not exist in txList`)
    } else {
      txList.splice(index, 1)
    }
  }

  return {
    added: [],
    removed: [],
    updated: [],
  }
}

export function sendRequests(): void {
  const proposals: VotingProposal[] = []
  for (const add of addProposals) {
    if (!txAdd.some((entry) => entry.hash === add.hash)) {
      proposals.push({ networkTx: add, verifierType: 'beforeAdd' })
    }
  }
  for (const remove of removeProposals) {
    if (!txRemove.some((entry) => entry.txHash === remove.txHash)) {
      proposals.push({ networkTx: remove, verifierType: 'apply' })
    }
  }

  initVotingProcess(proposals)
  addProposals.length = 0
  removeProposals.length = 0
}

/** Module Functions */

export function registerShutdownHandler(
  type: string,
  handler: (
    activeNode: P2P.NodeListTypes.Node,
    record: P2P.CycleCreatorTypes.CycleRecord
  ) => Omit<P2P.ServiceQueueTypes.AddNetworkTx, 'cycle' | 'hash'> | null | undefined
): void {
  shutdownHandlers.set(type, handler)
}

export function registerBeforeAddVerifier(
  type: string,
  verifier: (txEntry: P2P.ServiceQueueTypes.AddNetworkTx) => Promise<boolean>
): void {
  beforeAddVerifier.set(type, verifier)
}

export function registerApplyVerifier(
  type: string,
  verifier: (txEntry: P2P.ServiceQueueTypes.AddNetworkTx) => Promise<boolean>
): void {
  applyVerifier.set(type, verifier)
}

export async function addNetworkTx(
  networkTx: Omit<P2P.ServiceQueueTypes.AddNetworkTx, 'hash' | 'cycle'>
): Promise<void> {
  const hash = crypto.hash(networkTx.txData)
  const fullNetworkTx = {
    hash,
    cycle: currentCycle,
    ...networkTx,
  } as P2P.ServiceQueueTypes.AddNetworkTx
  if (await validateAddTx(fullNetworkTx)) {
    makeAddNetworkTxProposals(fullNetworkTx)
  }
}

export function getLatestNetworkTxEntryForSubqueueKey(
  subqueueKey: string
): P2P.ServiceQueueTypes.NetworkTxEntry {
  for (let i = txList.length - 1; i >= 0; i--) {
    if (txList[i].tx.subQueueKey === subqueueKey) {
      return txList[i]
    }
  }
  return undefined
}

function makeAddNetworkTxProposals(networkTx: P2P.ServiceQueueTypes.AddNetworkTx): void {
  if (
    pickAggregators(networkTx.involvedAddress)
      .map((node) => node.id)
      .includes(Self.id)
  ) {
    processTxVerifiers.set(networkTx.hash, {
      hash: networkTx.hash,
      tx: networkTx,
      votes: [],
      executionGroup: executionGroupForAddress(networkTx.involvedAddress),
      newVotes: false,
      hasSentFinalReceipt: false,
      appliedReceipt: null,
    })
  }
  addProposals.push(networkTx)
}

function makeRemoveNetworkTxProposals(removeTx: P2P.ServiceQueueTypes.RemoveNetworkTx): void {
  const index = txList.findIndex((entry) => entry.hash === removeTx.txHash)
  if (index === -1) {
    error(`TxHash ${removeTx.txHash} does not exist in txList`)
    return
  }
  const networkTx = txList[index].tx
  if (
    pickAggregators(networkTx.involvedAddress)
      .map((node) => node.id)
      .includes(Self.id)
  ) {
    processTxVerifiers.set(networkTx.hash, {
      hash: networkTx.hash,
      tx: networkTx,
      votes: [],
      executionGroup: executionGroupForAddress(networkTx.involvedAddress),
      newVotes: false,
      hasSentFinalReceipt: false,
      appliedReceipt: null,
    })
  }
  removeProposals.push(removeTx)
}

function voteForNetworkTx(
  networkTx: P2P.ServiceQueueTypes.AddNetworkTx,
  type: 'beforeAdd' | 'apply',
  result: boolean
): void {
  console.log(' red - voteForNetworkTx', type, stringifyReduce(networkTx), result)
  const vote: ServiceQueueVote = crypto.sign({
    txHash: networkTx.hash,
    result,
    verifierType: type,
  })
  let aggregators = pickAggregators(networkTx.involvedAddress)
  Comms.tellBinary<ServiceQueueVote>(
    aggregators,
    InternalRouteEnum.binary_service_queue_send_vote,
    vote,
    serializeServiceQueueSendVoteReq,
    {}
  )
}

function executionGroupForAddress(address: string): string[] {
  try {
    const { homePartition } = ShardFunctions.addressToPartition(
      stateManager.currentCycleShardData.shardGlobals,
      address
    )
    const homeShardData = stateManager.currentCycleShardData.parititionShardDataMap.get(homePartition)
    return homeShardData.homeNodes[0].consensusNodeForOurNodeFull.map(
      (node: ShardusTypes.Node) => node.publicKey
    )
  } catch (e) {
    error(`Failed to get execution group for address ${address}: ${e instanceof Error ? e.stack : e}`)
    return []
  }
}

function pickAggregators(address: string): ShardusTypes.Node[] {
  const closestNodes = stateManager.getClosestNodes(address, config.sharding.nodesPerConsensusGroup, false)
  const consensusGroup = executionGroupForAddress(address)

  // now find the first n occurrences of closest nodes that are also in consensusGroup
  const aggregators: ShardusTypes.Node[] = []
  for (const node of closestNodes) {
    if (consensusGroup.includes(node.publicKey)) {
      aggregators.push(node)
      if (aggregators.length === config.p2p.serviceQueueAggregators) break
    }
  }
  console.log(' red - pickAggregators', aggregators.length, aggregators)
  return aggregators
}

async function validateAddTx(addTx: P2P.ServiceQueueTypes.AddNetworkTx): Promise<boolean> {
  try {
    if (!addTx || !addTx.txData) {
      warn('Invalid addTx or missing addTx.txData', addTx)
      return false
    }

    if (addTx.cycle < currentCycle - 2 || addTx.cycle > currentCycle) {
      warn(`Invalid cycle ${addTx.cycle} for current cycle ${currentCycle}`)
      return false
    }

    if (addTx.involvedAddress == null || !isValidShardusAddress([addTx.involvedAddress])) {
      warn(`Invalid involvedAddress ${addTx.involvedAddress}`)
      return false
    }

    const involvedAddresses = addTx.involvedAddress
    const selfPubKey = crypto.getPublicKey()
    const isSelfInExecutionGroup = executionGroupForAddress(involvedAddresses).includes(selfPubKey)
    if (!isSelfInExecutionGroup) {
      if (logFlags.p2pNonFatal) {
        info('Not in execution group for network tx', addTx.hash)
      }
      return false
    }

    if (txList.some((entry) => entry.hash === addTx.hash)) {
      if (logFlags.p2pNonFatal) {
        info('Transaction already exists in txList', addTx.hash)
      }
      return false
    }

    if (!beforeAddVerifier.has(addTx.type)) {
      warn('Adding network tx without a verify function!')
      return false
    }

    const verifyFunction = beforeAddVerifier.get(addTx.type)
    if (!verifyFunction) {
      error('Verify function is undefined')
      return false
    }

    if (!(await verifyFunction(addTx))) {
      error(
        `Failed add network tx verification of type ${addTx.type} \n tx: ${stringifyReduce(addTx.txData)}`
      )
      return false
    }
    console.log('add network tx', addTx.type, addTx.txData.publicKey, addTx)
    return true
  } catch (e) {
    error(
      `Failed add network tx verification of type ${addTx.type} \n tx: ${stringifyReduce(
        addTx.txData
      )}\n error: ${e instanceof Error ? e.stack : e}`
    )
    return false
  }
}

export async function validateRemoveTx(removeTx: P2P.ServiceQueueTypes.RemoveNetworkTx): Promise<boolean> {
  const index = txList.findIndex((entry) => entry.hash === removeTx.txHash)
  if (index === -1) {
    /* prettier-ignore */ if (logFlags.p2pNonFatal) warn(`TxHash ${removeTx.txHash} does not exist in txList`)
    return false
  }

  // eslint-disable-next-line security/detect-object-injection
  const listEntry = txList[index]

  const involvedAddresses = listEntry.tx.involvedAddress
  const selfPubKey = crypto.getPublicKey()
  const isSelfInExecutionGroup = executionGroupForAddress(involvedAddresses).includes(selfPubKey)
  if (!isSelfInExecutionGroup) {
    if (logFlags.p2pNonFatal) {
      info('Not in execution group for network tx remove', listEntry.hash)
    }
    return false
  }

  try {
    if (!applyVerifier.has(listEntry.tx.type)) {
      // todo: should this throw or not?
      warn('Remove network tx without a verify function!')
    } else if (!(await applyVerifier.get(listEntry.tx.type)(listEntry.tx))) {
      error(`Failed remove network tx verification of type ${listEntry.tx.type} \n
                     tx: ${stringifyReduce(listEntry.tx.txData)}`)
      return false
    }
  } catch (e) {
    error(`Failed remove network tx verification of type ${listEntry.tx.type} \n
                   tx: ${stringifyReduce(listEntry.tx.txData)}\n
                   error: ${e instanceof Error ? e.stack : e}`)
    return false
  }

  return true
}

export async function processNetworkTransactions(record: P2P.CycleCreatorTypes.CycleRecord): Promise<void> {
  info('Process Network Transactions')
  if (record.mode !== 'processing') {
    return
  }
  const processedSubQueueKeys = new Set<string>()
  let length = Math.min(txList.length, config.p2p.networkTransactionsToProcessPerCycle)
  for (let i = 0; i < length && currentQuarter === 3; i++) {
    try {
      // eslint-disable-next-line security/detect-object-injection
      if (!txList[i]) {
        warn(`txList[${i}] is undefined`)
        continue
      }

      // eslint-disable-next-line security/detect-object-injection
      const record = txList[i].tx

      if (record.subQueueKey != null && processedSubQueueKeys.has(record.subQueueKey)) {
        if (length < txList.length) {
          length += 1
        }
        continue
      }

      if (applyVerifier.has(record.type) && !(await applyVerifier.get(record.type)(record))) {
        const emitParams: Omit<ShardusEvent, 'type'> = {
          nodeId: record.txData.nodeId,
          reason: 'Try Network Transaction',
          time: CycleChain.newest.start,
          publicKey: record.txData.publicKey,
          cycleNumber: record.cycle,
          additionalData: record,
        }
        /* prettier-ignore */ if (logFlags.p2pNonFatal) info('emit network transaction event', Utils.safeStringify(emitParams))
        Self.emitter.emit('try-network-transaction', emitParams)
        countTry(txList[i].hash)
        if (record.subQueueKey != null) {
          processedSubQueueKeys.add(record.subQueueKey)
        }
      } else {
        // eslint-disable-next-line security/detect-object-injection
        /* prettier-ignore */ if (logFlags.p2pNonFatal) info('removeNetworkTx', txList[i].hash)
        // eslint-disable-next-line security/detect-object-injection
        const removeTx = { txHash: txList[i].hash, cycle: currentCycle }
        if (await validateRemoveTx(removeTx)) {
          makeRemoveNetworkTxProposals(removeTx)
        }
      }
    } catch (e) {
      // eslint-disable-next-line security/detect-object-injection
      error(`Failed to process network transaction ${txList[i]?.hash}: ${e instanceof Error ? e.stack : e}`)
    }
  }
}

export async function syncTxListFromArchiver(): Promise<void> {
  const archiver: P2P.SyncTypes.ActiveNode = getRandomAvailableArchiver()
  if (!archiver) {
    throw Error('Fatal: Could not get random archiver')
  }

  const txListResult: Result<P2P.ServiceQueueTypes.NetworkTxEntry[], Error> = await getFromArchiver(
    archiver,
    'network-txs-list'
  )

  if (txListResult.isErr()) {
    const nodeListUrl = `http://${archiver.ip}:${archiver.port}/network-txs-list`
    throw Error(`Fatal: Could not get tx list from archiver ${nodeListUrl}: ` + txListResult.error.message)
  }

  const latestTxListHash = CycleChain?.newest?.txlisthash

  if (!latestTxListHash) {
    warn('failed to get hash of latest tx list from cycle record')
    return
  }

  if (latestTxListHash === crypto.hash(txListResult.value)) {
    txList = txListResult.value
    info('first nodes successfully synced tx list from archiver in restart mode')
  } else {
    throw Error(
      'Fatal: Hash of tx list from archiver does not match hash of latest tx list from cycle record'
    )
  }
}

function hasCycleBeenParsed(record: P2P.CycleCreatorTypes.CycleRecord): boolean {
  for (const txAdd of record.txadd) {
    if (!txList.some((entry) => entry.hash === txAdd.hash)) {
      return false
    }
  }

  for (const txRemove of record.txremove) {
    if (txList.some((entry) => entry.hash === txRemove.txHash)) {
      return false
    }
  }

  return true
}

function countTry(txHash: string): void {
  if (tryCounts.has(txHash)) {
    tryCounts.set(txHash, tryCounts.get(txHash) + 1)
  } else {
    tryCounts.set(txHash, 1)
  }
}

export function getTxListHash(): string {
  return crypto.hash(txList)
}

export function getTxList(): Array<P2P.ServiceQueueTypes.NetworkTxEntry> {
  return txList
}

export function setTxList(_txList: P2P.ServiceQueueTypes.NetworkTxEntry[]): void {
  txList = _txList
}

function sortedInsert(
  list: { hash: string; tx: P2P.ServiceQueueTypes.AddNetworkTx }[],
  entry: { hash: string; tx: P2P.ServiceQueueTypes.AddNetworkTx }
): void {
  const index = list.findIndex(
    (item) =>
      item.tx.cycle > entry.tx.cycle ||
      (item.tx.cycle === entry.tx.cycle && item.tx.priority < entry.tx.priority) || // Compare by priority if cycle is the same
      (item.tx.cycle === entry.tx.cycle && item.tx.priority === entry.tx.priority && item.hash > entry.hash) // Compare by hash if both cycle and priority are the same
  )
  if (index === -1) {
    list.push(entry)
  } else {
    list.splice(index, 0, entry)
  }
}

function verifyAppliedReceipt(payload: VerifierEntry & SignedObject): boolean {
  const receipt = payload.appliedReceipt
  console.log(' red - verifyAppliedReceipt', receipt)
  const executionGroup = executionGroupForAddress(payload.tx.involvedAddress)

  let validSignatures = new Set<string>()
  for (const vote of payload.votes) {
    if (vote.result !== receipt.result) {
      error(`verifyAppliedReceipt(): vote result does not match receipt result`, vote, receipt)
      return false
    }
    if (vote.txHash !== receipt.txid) {
      error(`verifyAppliedReceipt(): vote txHash does not match receipt txid`, vote, receipt)
      return false
    }
    if (vote.verifierType !== receipt.type) {
      error(`verifyAppliedReceipt(): vote verifierType does not match receipt type`, vote, receipt)
      return false
    }
    if (validSignatures.has(vote.sign.owner)) {
      error(`verifyAppliedReceipt(): vote has duplicate signature`, vote)
      return false
    }
    if (!crypto.verify(vote, vote.sign.owner)) {
      error(`verifyAppliedReceipt(): signature invalid`, vote.sign.owner)
      return false
    }
    if (payload.appliedReceipt.signatures.some((sig) => !executionGroup.includes(sig.owner))) {
      const problematicSign = payload.appliedReceipt.signatures.find((sig) => !executionGroup.includes(sig.owner))
      error(`appliedReceipt found signature not in executionGroup`)
      return false
    }
    validSignatures.add(vote.sign.owner)
  }

  const requiredMajority = Math.ceil(executionGroup.length * config.p2p.requiredVotesPercentage)
  if (validSignatures.size < requiredMajority) {
    error(`verifyAppliedReceipt(): not enough valid signatures`, validSignatures, requiredMajority, receipt.txid)
    return false
  }

  return true
}

function info(...msg: unknown[]): void {
  const entry = `ServiceQueue: ${msg.join(' ')}`
  p2pLogger.info(entry)
}

function warn(...msg: unknown[]): void {
  const entry = `ServiceQueue: ${msg.join(' ')}`
  p2pLogger.warn(entry)
}

function error(...msg: unknown[]): void {
  const entry = `ServiceQueue: ${msg.join(' ')}`
  p2pLogger.error(entry)
}
