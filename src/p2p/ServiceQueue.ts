import { Logger } from 'log4js'
import { logger, config, crypto, network } from './Context';
import * as CycleChain from './CycleChain'
import { P2P, Utils } from '@shardus/types'
import { OpaqueTransaction, ShardusEvent } from '../shardus/shardus-types'
import { stringifyReduce, validateTypes } from '../utils'
import * as Comms from './Comms'
import { profilerInstance } from '../utils/profiler'
import * as Self from './Self'
import { currentCycle, currentQuarter } from './CycleCreator'
import { logFlags } from '../logger'
import { byIdOrder, byPubKey } from './NodeList'
import { nestedCountersInstance } from '../utils/nestedCounters'
import { getFromArchiver } from './Archivers'
import { Result } from 'neverthrow'
import { getRandomAvailableArchiver } from './Utils'
import { isDebugModeMiddleware } from '../network/debugMiddleware';

/** STATE */

let p2pLogger: Logger
let txList: Array<{ hash: string; tx: P2P.ServiceQueueTypes.AddNetworkTx }> = []
let txAdd: P2P.ServiceQueueTypes.AddNetworkTx[] = []
let txRemove: P2P.ServiceQueueTypes.RemoveNetworkTx[] = []
const addProposal: P2P.ServiceQueueTypes.SignedAddNetworkTx[] = []
const removeProposal: P2P.ServiceQueueTypes.SignedRemoveNetworkTx[] = []
const beforeAddVerifier = new Map<string, (txData: OpaqueTransaction) => Promise<boolean>>()
const applyVerifier = new Map<string, (txData: OpaqueTransaction) => Promise<boolean>>()

/** ROUTES */

const addTxGossipRoute: P2P.P2PTypes.GossipHandler<P2P.ServiceQueueTypes.SignedAddNetworkTx> = async (
  payload,
  sender,
  tracker
) => {
  profilerInstance.scopedProfileSectionStart('serviceQueue - addTx')
  try {
    /* prettier-ignore */ if (logFlags.p2pNonFatal) info(`Got addTx gossip: ${Utils.safeStringify(payload)}`)
    let err = ''
    err = validateTypes(payload, { type: 's', txData: 'o', cycle: 'n', sign: 'o' })
    if (err) {
      warn('addTxGossipRoute bad payload: ' + err)
      return
    }
    err = validateTypes(payload.sign, { owner: 's', sig: 's' })
    if (err) {
      /* prettier-ignore */ if (logFlags.error) warn('gossip-addtx: bad input sign ' + err)
      return
    }

    const signer = byPubKey.get(payload.sign.owner)
    if (!signer) {
      /* prettier-ignore */ if (logFlags.error) warn('gossip-addtx: Got request from unknown node')
      return
    }
    if (!crypto.verify(payload, payload.sign.owner)) {
      if (logFlags.console) console.log(`addTxGossipRoute(): signature invalid`, payload.sign.owner)
      /* prettier-ignore */ nestedCountersInstance.countEvent('serviceQueue.ts', `addTxGossipRoute(): signature invalid`)
      return
    }
    // todo: which quartes?
    if ([1, 2].includes(currentQuarter)) {
      if (await _addNetworkTx(payload)) {
        Comms.sendGossip('gossip-addtx', payload, tracker, Self.id, byIdOrder, false) // use Self.id so we don't gossip to ourself
      }
    }
  } finally {
    profilerInstance.scopedProfileSectionEnd('serviceQueue - addTx')
  }
}

const removeTxGossipRoute: P2P.P2PTypes.GossipHandler<P2P.ServiceQueueTypes.SignedRemoveNetworkTx> = async (
  payload,
  sender,
  tracker
) => {
  profilerInstance.scopedProfileSectionStart('serviceQueue - removeTx')
  try {
    /* prettier-ignore */ if (logFlags.p2pNonFatal) info(`Got removeTx gossip: ${Utils.safeStringify(payload)}`)
    let err = validateTypes(payload, { txHash: 's', cycle: 'n', sign: 'o' })
    if (err) {
      warn('removeTxGossipRoute bad payload: ' + err)
      return
    }
    err = validateTypes(payload.sign, { owner: 's', sig: 's' })
    if (err) {
      /* prettier-ignore */ if (logFlags.error) warn('gossip-removetx: bad input sign ' + err)
      return
    }

    const signer = byPubKey.get(payload.sign.owner)
    if (!signer) {
      /* prettier-ignore */ if (logFlags.error) warn('gossip-removetx: Got request from unknown node')
      return
    }
    if (!crypto.verify(payload, payload.sign.owner)) {
      if (logFlags.console) console.log(`removeTxGossipRoute(): signature invalid`, payload.sign.owner)
      /* prettier-ignore */ nestedCountersInstance.countEvent('serviceQueue.ts', `removeTxGossipRoute(): signature invalid`)
      return
    }
    // todo: which quartes?
    if ([1, 2].includes(currentQuarter)) {
      if (await _removeNetworkTx(payload)) {
        Comms.sendGossip('gossip-removetx', payload, tracker, Self.id, byIdOrder, false) // use Self.id so we don't gossip to ourself
      }
    }
  } finally {
    profilerInstance.scopedProfileSectionEnd('serviceQueue - removeTx')
  }
}


const routes = {
  external: [],
  internal: [],
  internalBinary: [],
  gossip: {
    ['gossip-addtx']: addTxGossipRoute,
    ['gossip-removetx']: removeTxGossipRoute,
  },
}

/** FUNCTIONS */

/** CycleCreator Functions */

export function init(): void {
  p2pLogger = logger.getLogger('p2p')

  reset()

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
}

export function reset(): void {
  txAdd = []
  txRemove = []
}

export function getTxs(): any {
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
  record.txadd = txAdd
  record.txremove = txRemove
  record.txlisthash = crypto.hash(txList)
}

export function parseRecord(record: P2P.CycleCreatorTypes.CycleRecord): P2P.CycleParserTypes.Change {
  return {
    added: [],
    removed: [],
    updated: [],
  }
}

export function sendRequests(): void {
  for (const add of addProposal) {
    Comms.sendGossip('gossip-addtx', add, '', Self.id, byIdOrder, true)
  }

  for (const remove of removeProposal) {
    Comms.sendGossip('gossip-removetx', remove, '', Self.id, byIdOrder, true)
  }
  addProposal.length = 0
  removeProposal.length = 0
}

/** Module Functions */

export function registerBeforeAddVerifier(
  type: string,
  verifier: (txData: OpaqueTransaction) => Promise<boolean>) {
  beforeAddVerifier.set(type, verifier)
}

export function registerApplyVerifier(
  type: string,
  verifier: (txData: OpaqueTransaction) => Promise<boolean>) {
  applyVerifier.set(type, verifier)
}

export async function addNetworkTx(type: string, tx: OpaqueTransaction, subQueueKey?: string): Promise<void> {
  const networkTx = {
    type,
    txData: tx,
    cycle: currentCycle,
    subQueueKey,
  } as P2P.ServiceQueueTypes.AddNetworkTx
  if (await _addNetworkTx(networkTx)) {
    txAdd.push(networkTx)
    makeAddNetworkTxProposals(networkTx)
  }
}

function makeAddNetworkTxProposals(networkTx: P2P.ServiceQueueTypes.AddNetworkTx): void {
  addProposal.push(crypto.sign(networkTx))
}

function makeRemoveNetworkTxProposals(networkTx: P2P.ServiceQueueTypes.RemoveNetworkTx): void {
  removeProposal.push(crypto.sign(networkTx))
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

    const txHash = crypto.hash(addTx.txData)
    if (txList.some((entry) => entry.hash === txHash)) {
      if (logFlags.p2pNonFatal) {
        info('Transaction already exists in txList', txHash)
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

    if (!(await verifyFunction(addTx.txData))) {
      error(
        `Failed add network tx verification of type ${addTx.type} \n tx: ${stringifyReduce(addTx.txData)}`
      )
      return false
    }

    info(`Adding network tx of type ${addTx.type} and payload ${stringifyReduce(addTx.txData)}`)
    sortedInsert({
      hash: txHash,
      tx: {
        txData: addTx.txData,
        type: addTx.type,
        cycle: addTx.cycle,
        ...(addTx.subQueueKey && { subQueueKey: addTx.subQueueKey }),
      },
    })

    return true
  } catch (e) {
    error(
      `Failed add network tx verification of type ${addTx.type} \n tx: ${stringifyReduce(
        addTx.txData
      )}\n error: ${e instanceof Error ? e.stack : e}`
    )
    return
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
    } else if (!await applyVerifier.get(listEntry.tx.type)(listEntry.tx.txData)) {
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

  txList.splice(index, 1)
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

      if (applyVerifier.has(record.type) && !(await applyVerifier.get(record.type)(record.txData))) {
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
        if (record.subQueueKey != null) {
          processedSubQueueKeys.add(record.subQueueKey)
        }
      } else {
        // eslint-disable-next-line security/detect-object-injection
        /* prettier-ignore */ if (logFlags.p2pNonFatal) info('removeNetworkTx', txList[i].hash)
        // eslint-disable-next-line security/detect-object-injection
        const removeTx = { txHash: txList[i].hash, cycle: currentCycle }
        if (await _removeNetworkTx(removeTx)) {
          txRemove.push(removeTx)
          makeRemoveNetworkTxProposals(removeTx)
        }
      }
    } catch (e){
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

  const txListResult: Result<{ hash: string; tx: P2P.ServiceQueueTypes.AddNetworkTx }[], Error> =
    await getFromArchiver(archiver, 'network-txs-list')

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

export function getTxListHash(): string {
  return crypto.hash(txList)
}

export function getTxList(): Array<{ hash: string; tx: P2P.ServiceQueueTypes.AddNetworkTx }> {
  return txList
}

export function setTxList(_txList: { hash: string; tx: P2P.ServiceQueueTypes.AddNetworkTx }[]): void {
  txList = _txList
}

function sortedInsert(entry: { hash: string; tx: P2P.ServiceQueueTypes.AddNetworkTx }): void {
  const index = txList.findIndex(
    (item) => item.tx.cycle > entry.tx.cycle || (item.tx.cycle === entry.tx.cycle && item.hash > entry.hash)
  )
  if (index === -1) {
    txList.push(entry)
  } else {
    txList.splice(index, 0, entry)
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
