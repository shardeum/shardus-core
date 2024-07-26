import { Logger } from 'log4js'
import { logger } from './Context'
import { nodes } from "./NodeList";
import { P2P } from '@shardus/types'

let p2pLogger: Logger
let queue: P2P.ServiceQueueTypes.ServiceEntry[] = []

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
