import { Logger } from 'log4js'
import { logger } from './Context'
import { byPubKey } from './NodeList'
import { P2P } from '@shardus/types'

interface ServiceEntry {
  id: string
  start: number
  end: number
}

let p2pLogger: Logger
const queue: ServiceEntry[] = []

export function init(): void {
  p2pLogger = logger.getLogger('p2p')
}

export function reset(): void {}

export function sendRequests(): void {}

export function getTxs(): any {
  return queue
}

export function parseRecord(record: P2P.CycleCreatorTypes.CycleRecord): P2P.CycleParserTypes.Change {
  return {
    added: [],
    removed: [],
    updated: [],
  }
}

export function updateRecord(
  txs: P2P.LostTypes.Txs,
  record: P2P.CycleCreatorTypes.CycleRecord & { serviceQueue: any[] },
  prev: P2P.CycleCreatorTypes.CycleRecord
): void {
  const removedId = record.removed
  for (const id in removedId) {
    const node = byPubKey.get(id)
    queue.push({
      id,
      start: node.activeTimestamp,
      end: Number(record.counter),
    })
  }
  record.serviceQueue = queue
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
