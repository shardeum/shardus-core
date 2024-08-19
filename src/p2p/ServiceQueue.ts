import { Logger } from 'log4js'
import { logger, config, crypto, network, stateManager } from './Context'
import * as CycleChain from './CycleChain'
import { P2P, Utils } from '@shardus/types'
import { OpaqueTransaction, ShardusEvent } from '../shardus/shardus-types'
import { stringifyReduce, validateTypes } from '../utils'
import * as Comms from './Comms'
import { profilerInstance } from '../utils/profiler'
import * as Self from './Self'
import { currentCycle, currentQuarter } from './CycleCreator'
import { logFlags } from '../logger'
import { byIdOrder } from './NodeList'
import { nestedCountersInstance } from '../utils/nestedCounters'
import { getFromArchiver } from './Archivers'
import { Result } from 'neverthrow'
import { getRandomAvailableArchiver } from './Utils'
import { isDebugModeMiddleware } from '../network/debugMiddleware'
import { nodeListFromStates } from './Join'
import * as utils from '../utils'
import rfdc from 'rfdc'
import { ShardusTypes } from '../index'

interface VerifierEntry {
  hash: string
  tx: P2P.ServiceQueueTypes.NetworkTxEntry
  votes: { txHash: string; type: 'add' | 'remove'; result: boolean; sign: any }[]
  newVotes: boolean
  executionGroup: []
  appliedReceipt: any
  hasSentFinalReceipt: boolean
}

/** STATE */

const clone = rfdc()

let p2pLogger: Logger
let txList: P2P.ServiceQueueTypes.NetworkTxEntry[] = []
let txAdd: P2P.ServiceQueueTypes.AddNetworkTx[] = []
let txRemove: P2P.ServiceQueueTypes.RemoveNetworkTx[] = []
const beforeAddVerifier = new Map<string, (txEntry: P2P.ServiceQueueTypes.AddNetworkTx) => Promise<boolean>>()
const applyVerifier = new Map<string, (txEntry: P2P.ServiceQueueTypes.AddNetworkTx) => Promise<boolean>>()
const tryCounts = new Map<string, number>()
const processTxVerifiers = new Map<string, VerifierEntry>()

/** ROUTES */

const addTxGossipRoute: P2P.P2PTypes.GossipHandler<VerifierEntry> = async (payload, sender, tracker) => {
  profilerInstance.scopedProfileSectionStart('serviceQueue - addTx')

  if ([1, 2].includes(currentQuarter) === false) {
    /* prettier-ignore */ if (logFlags.error) info('gossip-addtx: Got request after quarter 2')
    return
  }

  try {
    /* prettier-ignore */ if (logFlags.p2pNonFatal) info(`Got addTx gossip: ${Utils.safeStringify(payload)}`)
    let err = ''
    err = validateTypes(payload, {
      hash: 's',
      votes: 'o',
      newVotes: 'n',
      executionGroup: 'a',
      appliedReceipt: 'o',
      hasSentFinalReceipt: 'b',
    })
    if (err) {
      warn('addTxGossipRoute bad payload: ' + err)
      return
    }

    // const signer = byPubKey.get(payload.sign.owner)
    // if (!signer) {
    //   /* prettier-ignore */ if (logFlags.error) warn('gossip-addtx: Got request from unknown node')
    //   return
    // }

    if (txAdd.some((entry) => entry.hash === payload.hash)) {
      return
    }

    // if (!crypto.verify(payload, payload.sign.owner)) {
    //   if (logFlags.console) console.log(`addTxGossipRoute(): signature invalid`, payload.sign.owner)
    //   /* prettier-ignore */ nestedCountersInstance.countEvent('serviceQueue.ts', `addTxGossipRoute(): signature invalid`)
    //   return
    // }

    // const { sign, ...unsignedAddNetworkTx } = payload
    if (!txAdd.some((entry) => entry.hash === payload.hash)) {
      const addTxCopy = clone(payload.tx.tx)
      const { sign, ...txDataWithoutSign } = addTxCopy.txData
      addTxCopy.txData = txDataWithoutSign
      txAdd.push(addTxCopy)

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
    }
  } finally {
    profilerInstance.scopedProfileSectionEnd('serviceQueue - addTx')
  }
}

const removeTxGossipRoute: P2P.P2PTypes.GossipHandler<VerifierEntry> = async (payload, sender, tracker) => {
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
    // let err = validateTypes(payload, { txHash: 's', cycle: 'n', sign: 'o' })
    // if (err) {
    //   warn('removeTxGossipRoute bad payload: ' + err)
    //   return
    // }
    // err = validateTypes(payload.sign, { owner: 's', sig: 's' })
    // if (err) {
    //   /* prettier-ignore */ if (logFlags.error) warn('gossip-removetx: bad input sign ' + err)
    //   return
    // }

    // const signer = byPubKey.get(payload.sign.owner)
    // if (!signer) {
    //   /* prettier-ignore */ if (logFlags.error) warn('gossip-removetx: Got request from unknown node')
    //   return
    // }

    if (txRemove.some((entry) => entry.txHash === payload.hash)) {
      return
    }

    // if (!crypto.verify(payload, payload.sign.owner)) {
    //   if (logFlags.console) console.log(`removeTxGossipRoute(): signature invalid`, payload.sign.owner)
    //   /* prettier-ignore */ nestedCountersInstance.countEvent('serviceQueue.ts', `removeTxGossipRoute(): signature invalid`)
    //   return
    // }
    // const { sign, ...unsignedRemoveNetworkTx } = payload
    // could also place check inside _removeNetworkTx
    if (!txRemove.some((entry) => entry.txHash === payload.hash)) {
      txRemove.push({ txHash: payload.hash, cycle: payload.tx.tx.cycle })

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
    }
  } finally {
    profilerInstance.scopedProfileSectionEnd('serviceQueue - removeTx')
  }
}

const sendVoteHandler: P2P.P2PTypes.Route<
  P2P.P2PTypes.InternalHandler<{ txHash: string; type: 'add' | 'remove'; result: boolean; sign: any }>
> = {
  name: 'send_service_queue_vote',
  handler: (payload, respond, header, sign) => {
    const route = 'send_service_queue_vote'
    profilerInstance.scopedProfileSectionStart(route, false)
    try {
      const collectedVote = payload

      if (!collectedVote.sign) {
        /* prettier-ignore */ nestedCountersInstance.countEvent('serviceQueue', 'send-vote: no sign found')
        return
      }

      if (!processTxVerifiers.has(collectedVote.txHash)) {
        /* prettier-ignore */ nestedCountersInstance.countEvent('serviceQueue', 'send-vote: tx not found in txList')
        return
      }

      tryAppendVote(processTxVerifiers.get(collectedVote.txHash), collectedVote)
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
  internal: [sendVoteHandler],
  internalBinary: [],
  gossip: {
    ['gossip-addtx']: addTxGossipRoute,
    ['gossip-removetx']: removeTxGossipRoute,
  },
}

function tryAppendVote(
  queueEntry: VerifierEntry,
  collectedVote: { txHash: string; type: 'add' | 'remove'; result: boolean; sign: any }
): boolean {
  if (!queueEntry.executionGroup.some((node) => node === collectedVote.sign.owner)) {
    nestedCountersInstance.countEvent('serviceQueue', 'Vote sender not in execution group')
    return false
  }

  const numVotes = queueEntry.votes.length

  if (numVotes === 0) {
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

  queueEntry.votes.push(collectedVote)
  queueEntry.newVotes = true
  return true
}

function tryProduceReceipt(queueEntry: VerifierEntry): Promise<any> {
  try {
    if (queueEntry.appliedReceipt != null) {
      nestedCountersInstance.countEvent(`serviceQueue`, 'tryProduceReceipt appliedReceipt != null')
      return queueEntry.appliedReceipt
    }

    let votingGroup = queueEntry.executionGroup
    const majorityCount = Math.ceil(votingGroup.length * this.config.p2p.requiredVotesPercentage)
    const numVotes = queueEntry.votes.length

    if (numVotes < majorityCount) {
      return null
    }
    if (queueEntry.newVotes === false) {
      return null
    }
    queueEntry.newVotes = false
    let winningVote: boolean
    let type: string
    const hashCounts: Map<boolean, number> = new Map()

    for (let i = 0; i < numVotes; i++) {
      // eslint-disable-next-line security/detect-object-injection
      const currentVote = queueEntry.votes[i]
      const voteCount = hashCounts.get(currentVote.result) || 0
      hashCounts.set(currentVote.result, voteCount + 1)
      if (voteCount + 1 > majorityCount) {
        winningVote = currentVote.result
        type = currentVote.type
        break
      }
    }

    if (winningVote != undefined) {
      const appliedReceipt: any = {
        txid: queueEntry.hash,
        result: undefined,
        type,
      }
      for (let i = 0; i < numVotes; i++) {
        // eslint-disable-next-line security/detect-object-injection
        const currentVote = queueEntry.votes[i]
        if (currentVote.result === winningVote) {
          appliedReceipt.signatures.push(currentVote.sign)
        }
      }

      appliedReceipt.result = winningVote
      queueEntry.appliedReceipt = appliedReceipt

      queueEntry.hasSentFinalReceipt = true
      let route = ''
      if (queueEntry.appliedReceipt.type === 'add') {
        route = 'gossip-addtx'
      } else {
        route = 'gossip-removetx'
      }
      Comms.sendGossip(route, appliedReceipt, null, null, byIdOrder, false, 4, queueEntry.hash, '', true)
      return appliedReceipt
    }
    return null
  } catch (e) {
    /* prettier-ignore */ if (logFlags.error) error(`serviceQueue - tryProduceReceipt: error ${queueEntry.hash} error: ${utils.formatErrorMessage(e)}`)
  }
}

async function initVotingProcess(): Promise<void> {
  processTxVerifiers.clear()

  let length = Math.min(txList.length, config.p2p.networkTransactionsToProcessPerCycle)
  for (let i = 0; i < length; i++) {
    if (
      !pickAggregators(txList[i].hash)
        .map((node) => node.id)
        .includes(Self.id)
    ) {
      continue
    }
    processTxVerifiers.set(txList[i].hash, {
      hash: txList[i].hash,
      tx: txList[i],
      votes: [],
      executionGroup: this.stateManager.getClosestNodes(
        txList[i].hash,
        config.sharding.nodesPerConsensusGroup,
        false
      ),
      newVotes: false,
      hasSentFinalReceipt: false,
      appliedReceipt: null,
    })
  }

  for (const [hash, entry] of processTxVerifiers) {
    ;(async function retryUntilSuccess(entry) {
      while (!entry.hasSentFinalReceipt && currentQuarter === 2) {
        await tryProduceReceipt(entry)
      }
    })(entry)
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

  network.registerExternalGet('debug-network-txlist', isDebugModeMiddleware, (req, res) => {
    res.send({ status: 'ok', txList })
  })

  network.registerExternalGet('debug-network-txlisthash', isDebugModeMiddleware, (req, res) => {
    res.send({ status: 'ok', txListHash: crypto.hash(txList) })
  })

  network.registerExternalGet('debug-drop-network-txhash', isDebugModeMiddleware, (req, res) => {
    const txHash = req.query.txHash
    const index = txList.findIndex((entry) => entry.hash === txHash)
    if (index === -1) {
      res.send({ status: 'fail', error: 'txHash not found' })
      return
    }
    txList.splice(index, 1)
    res.send({ status: 'ok' })
  })

  network.registerExternalGet('debug-network-txcount', isDebugModeMiddleware, (req, res) => {
    res.send({ status: 'ok', tryCounts: Array.from(tryCounts) })
  })
}

export function reset(): void {
  txAdd = []
  txRemove = []
  initVotingProcess()
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
  const txListCopy = clone(txList)

  for (const txadd of record.txadd) {
    const { sign, ...txDataWithoutSign } = txadd.txData
    sortedInsert(txListCopy, {
      hash: txadd.hash,
      tx: {
        hash: txadd.hash,
        txData: txDataWithoutSign,
        type: txadd.type,
        cycle: txadd.cycle,
        ...(txadd.subQueueKey && { subQueueKey: txadd.subQueueKey }),
      },
    })
  }

  for (const txremove of record.txremove) {
    const index = txListCopy.findIndex((entry) => entry.hash === txremove.txHash)
    if (index === -1) {
      error(`updateRecord: TxHash ${txremove.txHash} does not exist in txListCopy`)
    } else {
      txListCopy.splice(index, 1)
    }
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
  return
}

/** Module Functions */

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
  type: string,
  tx: OpaqueTransaction,
  involvedAddress: string,
  subQueueKey?: string
): Promise<void> {
  const isRemote = stateManager.transactionQueue.isAccountRemote(involvedAddress)
  if (isRemote) {
    return
  }
  const hash = crypto.hash(tx)
  const networkTx = {
    hash,
    type,
    txData: tx,
    cycle: currentCycle,
    subQueueKey,
  } as P2P.ServiceQueueTypes.AddNetworkTx
  if (await _addNetworkTx(networkTx)) {
    voteForNetworkTx(hash, 'add', true)
  } else {
    voteForNetworkTx(hash, 'add', false)
  }
}

function voteForNetworkTx(txHash: string, type: 'add' | 'remove', result: boolean): void {
  const isRemote = stateManager.transactionQueue.isAccountRemote(txHash)
  if (isRemote) {
    return
  }

  const vote = crypto.sign({ txHash, result, type })
  Comms.tell(pickAggregators(txHash), 'send_service_queue_vote', vote)
}

function pickAggregators(hash: string): ShardusTypes.Node[] {
  const executionGroup = stateManager.getClosestNodes(hash, config.sharding.nodesPerConsensusGroup, false)
  return executionGroup.slice(0, config.p2p.serviceQueueAggregators)
}

async function _addNetworkTx(addTx: P2P.ServiceQueueTypes.AddNetworkTx): Promise<boolean> {
  try {
    if (!addTx || !addTx.txData) {
      warn('Invalid addTx or missing addTx.txData', addTx)
      return false
    }

    if (addTx.cycle < currentCycle - 1 || addTx.cycle > currentCycle) {
      warn(`Invalid cycle ${addTx.cycle} for current cycle ${currentCycle}`)
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

export async function _removeNetworkTx(removeTx: P2P.ServiceQueueTypes.RemoveNetworkTx): Promise<boolean> {
  const index = txList.findIndex((entry) => entry.hash === removeTx.txHash)
  if (index === -1) {
    /* prettier-ignore */ if (logFlags.p2pNonFatal) warn(`TxHash ${removeTx.txHash} does not exist in txList`)
    return false
  }

  // eslint-disable-next-line security/detect-object-injection
  const listEntry = txList[index]
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

export async function processNetworkTransactions(): Promise<void> {
  info('Process Network Transactions')
  const processedSubQueueKeys = new Set<string>()
  let length = Math.min(txList.length, config.p2p.networkTransactionsToProcessPerCycle)
  for (let i = 0; i < length; i++) {
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
        if (await _removeNetworkTx(removeTx)) {
          voteForNetworkTx(txList[i].hash, 'remove', true)
        } else {
          voteForNetworkTx(txList[i].hash, 'remove', false)
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
    warn('failled to get hash of latest tx list from cycle record')
    return
  }

  if (latestTxListHash === crypto.hash(txListResult.value)) {
    txList = txListResult.value
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
      item.tx.cycle > entry.tx.cycle || (item.tx.cycle === entry.tx.cycle && item.hash > entry.tx.hash)
  )
  if (index === -1) {
    list.push(entry)
  } else {
    list.splice(index, 0, entry)
  }
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

function omitKey(obj: any, keyToOmit: string) {
  // deep emit key from object
  const newObj = { ...obj };
  for (const key in newObj) {
    if (key === keyToOmit) {
      delete newObj[key];
    } else if (typeof newObj[key] === 'object') {
      newObj[key] = omitKey(newObj[key], keyToOmit);
    }
  }
}