/** TYPES */

import { CycleRecord as Cycle } from "../shared-types/Cycle/CycleCreatorTypes"

export type NetworkStateHash = string
export type NetworkReceiptHash = string
export type NetworkSummarytHash = string

export interface NetworkHash {
  cycle: number
  hash: string
}

export interface StateHashes {
  counter: Cycle['counter']
  partitionHashes: object
  networkHash: NetworkStateHash
}

export interface ReceiptHashes {
  counter: Cycle['counter']
  receiptMapHashes: object
  networkReceiptHash: NetworkReceiptHash
}

export interface SummaryHashes {
  counter: Cycle['counter']
  summaryHashes: object
  networkSummaryHash: NetworkSummarytHash
}

export interface Transaction {
  id: string
}

export interface StateMetaData {
  counter: Cycle['counter']
  stateHashes: StateHashes[]
  receiptHashes: ReceiptHashes[]
  summaryHashes: SummaryHashes[]
}

export type ValidTypes = Cycle | StateMetaData

export enum TypeNames {
  CYCLE = 'CYCLE',
  STATE_METADATA = 'STATE_METADATA',
}

export type TypeName<T extends ValidTypes> = T extends Cycle
  ? TypeNames.CYCLE
  : TypeNames.STATE_METADATA

export type TypeIndex<T extends ValidTypes> = T extends Cycle
  ? Cycle['counter']
  : StateMetaData['counter']
export interface DataRequest<T extends ValidTypes> {
  type: TypeName<T>
  lastData: TypeIndex<T>
}

// Need to reduce these types from state-manager-types
export type ReceiptMap = { [txId: string]: string[] }

export type ReceiptMapResult = {
  cycle: number
  partition: number
  receiptMap: ReceiptMap
  txCount: number
}

type OpaqueBlob = any

export type SummaryBlob = {
  cycle: number
  latestCycle: number //The highest cycle that was used in this summary.
  counter: number
  errorNull: number
  partition: number
  opaqueBlob: OpaqueBlob
}

// Stats collected for a cycle
export type StatsClump = {
  error: boolean
  cycle: number
  dataStats: SummaryBlob[]
  txStats: SummaryBlob[]
  covered: number[]
  coveredParititionCount: number
  skippedParitionCount: number
}

export type CycleMarker = string

export type StateData = {
  parentCycle?: CycleMarker
  networkHash?: string
  partitionHashes?: string[]
}

export type Receipt = {
  parentCycle?: CycleMarker
  networkHash?: string
  partitionHashes?: string[]
  partitionMaps?: { [partition: number]: ReceiptMapResult }
  partitionTxs?: { [partition: number]: any }
}

export type Summary = {
  parentCycle?: CycleMarker
  networkHash?: string
  partitionHashes?: string[]
  partitionBlobs?: { [partition: number]: SummaryBlob }
}

// For Explorer; maybe we need to push to another file; Also need to apply this in shardFunctions.ts
export function addressNumberToPartition(
  numPartitions: number,
  addressNum: number
): number {
  // 2^32  4294967296 or 0xFFFFFFFF + 1
  let size = Math.round((0xffffffff + 1) / numPartitions)
  let homePartition = Math.floor(addressNum / size)
  if (homePartition === numPartitions) {
    homePartition = homePartition - 1
  }

  return homePartition
}
