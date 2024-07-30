import { Logger } from 'log4js'
import { logger, config, crypto } from './Context'
import { P2P, Utils } from "@shardus/types";
import { OpaqueTransaction } from '../shardus/shardus-types'
import { stringifyReduce, validateTypes } from '../utils'
import * as Comms from './Comms'
import { profilerInstance } from '../utils/profiler'
import * as Self from './Self'
import { currentCycle, currentQuarter } from "./CycleCreator";
import { logFlags } from '../logger'
import { byIdOrder } from './NodeList'

let p2pLogger: Logger
const txList: Array<{ hash: string, tx: P2P.ServiceQueueTypes.AddNetworkTx }> = []
let txAdd: P2P.ServiceQueueTypes.AddNetworkTx[] = []
let txRemove: P2P.ServiceQueueTypes.RemoveNetworkTx[] = []
const beforeAddVerify = new Map()
const beforeRemoveVerify = new Map()

export function registerBeforeAddVerify(
  type: string,
  verifier: (txData: OpaqueTransaction) => boolean
) {
  beforeAddVerify.set(type, verifier)
}

export function registerBeforeRemoveVerify(
  type: string,
  verifier: (txData: OpaqueTransaction) => boolean
) {
  beforeRemoveVerify.set(type, verifier)
}

export function init(): void {
  p2pLogger = logger.getLogger('p2p')

  reset()

  for (const [name, handler] of Object.entries(routes.gossip)) {
    Comms.registerGossipHandler(name, handler)
  }
}

export function reset(): void {
  txAdd = []
  txRemove = []
}

export function sendRequests(): void {}

export function getTxs(): any {
  return
}

export function parseRecord(record: P2P.CycleCreatorTypes.CycleRecord): P2P.CycleParserTypes.Change {
  return {
    added: [],
    removed: [],
    updated: [],
  }
}

export function addNetworkTx(type: string, tx: OpaqueTransaction): string {
  let networkTx = {type, txData: tx, cycle: currentCycle}
  const hash = _addNetworkTx(networkTx)
  // todo: are we one of the 5 closest otherwise don't gossip
  Comms.sendGossip('gossip-addtx', networkTx, '', Self.id, byIdOrder, true) // use Self.id so we don't gossip to ourself
  return hash
}

function _addNetworkTx(addTx: P2P.ServiceQueueTypes.AddNetworkTx): string {
  try {
    if (!beforeAddVerify.has(addTx.type)) {
      // todo: should this throw or not?
      warn('Adding network tx without a verify function!')
    } else if (!beforeAddVerify.get(addTx.type)(addTx.txData)) {
      error(`Failed add network tx verification of type ${addTx.type} \n
                     tx: ${stringifyReduce(addTx.txData)}`)
      return
    }
  } catch (e) {
    error(`Failed add network tx verification of type ${addTx.type} \n
                   tx: ${stringifyReduce(addTx.txData)}\n 
                   error: ${e instanceof Error ? e.stack : e}`)
    return
  }
  const txHash = crypto.hash(addTx.txData)
  if (!txList.find(entry => entry.hash === txHash)) {
    info(`Adding network tx of type ${addTx.type} and payload ${stringifyReduce(addTx.txData)}`)
    txAdd.push(addTx)
    sortedInsert({ hash: txHash, tx: addTx })
    return crypto.hash(addTx.txData)
  }
  return
}

export function removeNetworkTx(txHash: string): boolean {
  const removeTx = {txHash, cycle: currentCycle}
  const removed = _removeNetworkTx(removeTx)
  Comms.sendGossip('gossip-removetx', removeTx, '', Self.id, byIdOrder, true) // use Self.id so we don't gossip to ourself
  return removed
}

export function _removeNetworkTx(removeTx: P2P.ServiceQueueTypes.RemoveNetworkTx): boolean {
  const index = txList.findIndex(entry => entry.hash === removeTx.txHash)
  if (index === -1) {
    error(`TxHash ${removeTx.txHash} does not exist in txList`)
    return false
  }
  const listEntry = txList[index]
  try {
    if (!beforeRemoveVerify.has(listEntry.tx.type)) {
      // todo: should this throw or not?
      warn('Remove network tx without a verify function!')
    } else if (!beforeRemoveVerify.get(listEntry.tx.type)(listEntry.tx.txData)) {
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
  txRemove.push(removeTx)
  txList.splice(index, 1)
  return true
}

export function updateRecord(
  txs: P2P.ServiceQueueTypes.Txs,
  record: P2P.CycleCreatorTypes.CycleRecord,
  prev: P2P.CycleCreatorTypes.CycleRecord
): void {
  record.txadd = txAdd
  record.txremove = txRemove
  record.txlisthash = crypto.hash(txList.map(entry => entry.tx.txData))
}

export function validateRecordTypes(): string {
  return ''
}

export function processNetworkTransactions(): void {
  info('processNetworkTransactions')
  const length = Math.min(txList.length, config.p2p.networkTransactionsToProcessPerCycle)
  for (let i = 0; i < length; i++) {
    const record = txList[i].tx
    if (beforeRemoveVerify.has(record.type) && !beforeRemoveVerify.get(record.type)(record.txData)) {
      info('emit network transaction event', Utils.safeStringify(record))
      Self.emitter.emit('try-network-transaction', record)
    } else {
      removeNetworkTx(txList[i].hash)
    }
  }
}

const addTxGossipRoute: P2P.P2PTypes.GossipHandler<P2P.ServiceQueueTypes.AddNetworkTx> = (
  payload,
  sender,
  tracker
) => {
  profilerInstance.scopedProfileSectionStart('serviceQueue - addTx')
  try {
    /* prettier-ignore */ if (logFlags.p2pNonFatal) info(`Got Apoptosis gossip: ${Utils.safeStringify(payload)}`)
    let err = ''
    err = validateTypes(payload, { type: 's', txData: 'o', cycle: 'n' })
    if (err) {
      warn('addTxGossipRoute bad payload: ' + err)
      return
    }
    // todo: which quartes?
    if ([1, 2].includes(currentQuarter)) {
      if (_addNetworkTx(payload)) {
        Comms.sendGossip('gossip-addtx', payload, tracker, Self.id, byIdOrder, false) // use Self.id so we don't gossip to ourself
      }
    }
  } finally {
    profilerInstance.scopedProfileSectionEnd('serviceQueue - addTx')
  }
}

const removeTxGossipRoute: P2P.P2PTypes.GossipHandler<P2P.ServiceQueueTypes.RemoveNetworkTx> = (
  payload,
  sender,
  tracker
) => {
  profilerInstance.scopedProfileSectionStart('serviceQueue - removeTx')
  try {
    /* prettier-ignore */ if (logFlags.p2pNonFatal) info(`Got removeTx gossip: ${Utils.safeStringify(payload)}`)
    const err = validateTypes(payload, { txHash: 's', cycle: 'n' })
    if (err) {
      warn('removeTxGossipRoute bad payload: ' + err)
      return
    }
    // todo: which quartes?
    if ([1, 2].includes(currentQuarter)) {
      if (_removeNetworkTx(payload)) {
        Comms.sendGossip('gossip-removetx', payload, tracker, Self.id, byIdOrder, false) // use Self.id so we don't gossip to ourself
      }
    }
  } finally {
    profilerInstance.scopedProfileSectionEnd('serviceQueue - removeTx')
  }
}

function sortedInsert(entry: { hash: string, tx: P2P.ServiceQueueTypes.AddNetworkTx }) {
  const index = txList.findIndex(item =>
    item.tx.cycle > entry.tx.cycle ||
    (item.tx.cycle === entry.tx.cycle && item.hash > entry.hash)
  )
  if (index === -1) {
    txList.push(entry)
  } else {
    txList.splice(index, 0, entry)
  }
}

function info(...msg: unknown[]) {
  const entry = `ServiceQueue: ${msg.join(' ')}`
  p2pLogger.info(entry)
}

function warn(...msg: unknown[]) {
  const entry = `ServiceQueue: ${msg.join(' ')}`
  p2pLogger.warn(entry)
}

function error(...msg: unknown[]) {
  const entry = `ServiceQueue: ${msg.join(' ')}`
  p2pLogger.error(entry)
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
