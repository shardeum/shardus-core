import { Logger } from 'log4js'
import { logger, config } from './Context'
import { nodes } from './NodeList'
import { P2P, Utils } from '@shardus/types'
import * as events from 'events'
import * as Self from './Self'

let p2pLogger: Logger
let queue = [
  {
    type: 'rewardTx',
    data: {
      start: 1,
      end: 2,
    },
  },
  {
    type: 'penltyTx',
    data: {
      start: 2,
      end: 3,
    },
  },
  {
    type: 'customTx',
    data: {
      start: 4,
      end: 5,
    },
  },
]

export function init(): void {
  p2pLogger = logger.getLogger('p2p')
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

export function updateRecord(
  txs: P2P.ServiceQueueTypes.Txs,
  record: P2P.CycleCreatorTypes.CycleRecord,
  prev: P2P.CycleCreatorTypes.CycleRecord
): void {
  console.log('updateRecord')
  console.log('queue', queue)
  console.log('record queue', record.serviceQueue)
  queue = prev?.serviceQueue || []
  const removedId = [...record.removed, ...record.appRemoved, ...record.apoptosized]
  for (const id of removedId) {
    const node = nodes.get(id)
    console.log('removing', node.publicKey)
    queue.push({
      publicKey: node.publicKey,
      startCycle: node.activeCycle,
      endCycle: record.counter,
      rewardRate: 0,
    })
  }
  record.serviceQueue = queue
  console.log('record queue', record.serviceQueue)
  console.log('queue', queue)
}

export function validateRecordTypes(): string {
  return ''
}

export function processNetworkTransactions(): void {
  info('processNetworkTransactions')
  const length = Math.min(queue.length, config.p2p.networkTransactionsToProcessPerCycle)
  for (let i = 0; i < length; i++) {
    const record = queue[i]
    info('emit network transaction event', Utils.safeStringify(record))
    Self.emitter.emit('try-network-transaction', record)
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
