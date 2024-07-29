import { Logger } from 'log4js'
import { logger, config, crypto } from './Context'
import { P2P, Utils } from "@shardus/types";
import { OpaqueTransaction } from '../shardus/shardus-types'
import { stringifyReduce, validateTypes } from "../utils";
import * as Comms from './Comms'
import { profilerInstance } from '../utils/profiler'
import * as Self from './Self'
import { currentQuarter } from "./CycleCreator";
import { logFlags } from "../logger";
import { byIdOrder } from "./NodeList";

let p2pLogger: Logger
const txList: Map<string, P2P.ServiceQueueTypes.NetworkTx> = new Map()
const txAdd: P2P.ServiceQueueTypes.NetworkTx[] = []
const txRemove: string[] = []
const beforeAddVerify = new Map()
const beforeRemoveVerify = new Map()

export function registerBeforeAddVerify(type: string, verifier: () => boolean) {
  beforeAddVerify.set(type, verifier)
}

export function registerBeforeRemoveVerify(type: string, verifier: () => boolean) {
  beforeRemoveVerify.set(type, verifier)
}

export function init(): void {
  p2pLogger = logger.getLogger('p2p')
  for (const route of routes.internal) {
    Comms.registerInternal(route.name, route.handler)
  }
}

export function reset(): void {}

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
  const hash = _addNetworkTx(type, tx)
  // todo: are we one of the 5 closest otherwise don't gossip
  Comms.sendGossip('gossip-addtx', {type, txData: tx}, '', Self.id, byIdOrder, true) // use Self.id so we don't gossip to ourself
  return hash
}

function _addNetworkTx(type: string, tx: OpaqueTransaction): string {
  try {
    if (!beforeAddVerify.has(type)) {
      // todo: should this throw or not?
      warn('Adding network tx without a verify function!')
    } else if (!beforeAddVerify.get(type)()) {
      error(`Failed add network tx verification of type ${type} \n
                     tx: ${stringifyReduce(tx)}`)
      return
    }
  } catch (e) {
    error(`Failed add network tx verification of type ${type} \n
                   tx: ${stringifyReduce(tx)}\n 
                   error: ${e instanceof Error ? e.stack : e}`)
    return
  }
  txAdd.push({ type, txData: tx })
  return crypto.hash(tx)
}

export function removeNetworkTx(txHash: string): boolean {
  const removed = _removeNetworkTx(txHash)
  Comms.sendGossip('gossip-removetx', txHash, '', Self.id, byIdOrder, true) // use Self.id so we don't gossip to ourself
  return removed
}

export function _removeNetworkTx(txHash: string): boolean {
  if (!txList.has(txHash)) {
    error(`TxHash ${txHash} does not exist in txList`)
    return false
  }
  const listEntry = txList.get(txHash)
  try {
    if (!beforeRemoveVerify.has(listEntry.type)) {
      // todo: should this throw or not?
      warn('Remove network tx without a verify function!')
    } else if (!beforeRemoveVerify.get(listEntry.type)()) {
      error(`Failed remove network tx verification of type ${listEntry.type} \n
                     tx: ${stringifyReduce(listEntry.txData)}`)
      return false
    }
  } catch (e) {
    error(`Failed add network tx verification of type ${listEntry.type} \n
                   tx: ${stringifyReduce(listEntry.txData)}\n 
                   error: ${e instanceof Error ? e.stack : e}`)
    return false
  }
  txRemove.push(txHash)
  return true
}

export function updateRecord(
  txs: P2P.ServiceQueueTypes.Txs,
  record: P2P.CycleCreatorTypes.CycleRecord,
  prev: P2P.CycleCreatorTypes.CycleRecord
): void {
  record.txadd = txAdd
  record.txremove = txRemove
  record.txlisthash = crypto.hash(txList.values())
}

export function validateRecordTypes(): string {
  return ''
}

export function processNetworkTransactions(): void {
  info('processNetworkTransactions')
  const length = Math.min(txList.size, config.p2p.networkTransactionsToProcessPerCycle)
  let i = 0
  for (const [key, entry] of txList) {
    if (i >= length) {
      return
    }
    const record = entry
    info('emit network transaction event', Utils.safeStringify(record))
    Self.emitter.emit('try-network-transaction', record)
    i++
  }
}

const addTxGossipRoute: P2P.P2PTypes.GossipHandler<P2P.ServiceQueueTypes.NetworkTx> = (
  payload,
  sender,
  tracker
) => {
  profilerInstance.scopedProfileSectionStart('serviceQueue - addTx')
  try {
    /* prettier-ignore */ if (logFlags.p2pNonFatal) info(`Got Apoptosis gossip: ${Utils.safeStringify(payload)}`)
    let err = ''
    err = validateTypes(payload, { type: 's', txData: 'o' })
    if (err) {
      warn('addTxGossipRoute bad payload: ' + err)
      return
    }
    // todo: which quartes?
    if ([1, 2].includes(currentQuarter)) {
      if (_addNetworkTx(payload.type, payload.txData)) {
        Comms.sendGossip('gossip-addtx', payload, tracker, Self.id, byIdOrder, false) // use Self.id so we don't gossip to ourself
      }
    }
  } finally {
    profilerInstance.scopedProfileSectionEnd('serviceQueue - addTx')
  }
}

const removeTxGossipRoute: P2P.P2PTypes.GossipHandler<string> = (
  payload,
  sender,
  tracker
) => {
  profilerInstance.scopedProfileSectionStart('serviceQueue - removeTx')
  try {
    /* prettier-ignore */ if (logFlags.p2pNonFatal) info(`Got removeTx gossip: ${Utils.safeStringify(payload)}`)
    const err = validateTypes(payload, { type: 's', txData: 'o' })
    if (typeof payload !== 'string') {
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
