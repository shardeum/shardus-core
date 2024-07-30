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
import { byIdOrder, byPubKey } from './NodeList'
import { nestedCountersInstance } from '../utils/nestedCounters'

let p2pLogger: Logger
const txList: Array<{ hash: string; tx: P2P.ServiceQueueTypes.AddNetworkTx }> = []
let txAdd: P2P.ServiceQueueTypes.AddNetworkTx[] = []
let txRemove: P2P.ServiceQueueTypes.RemoveNetworkTx[] = []
const beforeAddVerify = new Map()
const beforeRemoveVerify = new Map()

export function registerBeforeAddVerify(type: string, verifier: (txData: OpaqueTransaction) => boolean) {
  beforeAddVerify.set(type, verifier)
}

export function registerBeforeRemoveVerify(type: string, verifier: (txData: OpaqueTransaction) => boolean) {
  beforeRemoveVerify.set(type, verifier)
}

export function init(): void {
  p2pLogger = logger.getLogger('p2p')

  reset()

  for (const [name, handler] of Object.entries(routes.gossip)) {
    Comms.registerGossipHandler(name, handler)
  }
}

export function reset(): void {}

export function sendRequests(): void {
  for (const add of txAdd) {
    const signedAdd = crypto.sign(add)
    Comms.sendGossip('gossip-addtx', signedAdd, '', Self.id, byIdOrder, true)
  }

  for (const remove of txRemove) {
    const signedRemove = crypto.sign(remove)
    Comms.sendGossip('gossip-removetx', signedRemove, '', Self.id, byIdOrder, true)
  }

  txAdd = []
  txRemove = []
}

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

export function addNetworkTx(type: string, tx: OpaqueTransaction): void {
  let networkTx = { type, txData: tx, cycle: currentCycle }
  txAdd.push(networkTx)
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
  if (!txList.find((entry) => entry.hash === txHash)) {
    info(`Adding network tx of type ${addTx.type} and payload ${stringifyReduce(addTx.txData)}`)
    sortedInsert({ hash: txHash, tx: addTx })
    return crypto.hash(addTx.txData)
  }
  return
}

export function removeNetworkTx(txHash: string): void {
  const removeTx = { txHash, cycle: currentCycle }
  txRemove.push(removeTx)
}

export function _removeNetworkTx(removeTx: P2P.ServiceQueueTypes.RemoveNetworkTx): boolean {
  const index = txList.findIndex((entry) => entry.hash === removeTx.txHash)
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
  record.txlisthash = crypto.hash(txList.map((entry) => entry.tx.txData))
}

export function validateRecordTypes(): string {
  return ''
}

export function processNetworkTransactions(): void {
  info('Process Network Transactions')
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

const addTxGossipRoute: P2P.P2PTypes.GossipHandler<P2P.ServiceQueueTypes.SignedAddNetworkTx> = (
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
    }
    if (!crypto.verify(payload, payload.sign.owner)) {
      if (logFlags.console) console.log(`addTxGossipRoute(): signature invalid`, payload.sign.owner)
      /* prettier-ignore */ nestedCountersInstance.countEvent('serviceQueue.ts', `addTxGossipRoute(): signature invalid`)
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

const removeTxGossipRoute: P2P.P2PTypes.GossipHandler<P2P.ServiceQueueTypes.SignedRemoveNetworkTx> = (
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
    }
    if (!crypto.verify(payload, payload.sign.owner)) {
      if (logFlags.console) console.log(`removeTxGossipRoute(): signature invalid`, payload.sign.owner)
      /* prettier-ignore */ nestedCountersInstance.countEvent('serviceQueue.ts', `removeTxGossipRoute(): signature invalid`)
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
