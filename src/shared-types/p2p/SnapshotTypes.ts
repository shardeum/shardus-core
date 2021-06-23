import * as shardFunctionTypes from '../../state-manager/shardFunctionTypes'
import { CycleRecord } from '../p2p/CycleCreatorTypes'

/** TYPES */

export interface StateMetaData {
  counter: CycleRecord['counter']
  stateHashes: StateHashes[]
  receiptHashes: ReceiptHashes[]
  summaryHashes: SummaryHashes[]
}

export type ValidTypes = CycleRecord | StateMetaData

export enum TypeNames {
  CYCLE = 'CYCLE',
  STATE_METADATA = 'STATE_METADATA',
}

export interface NamesToTypes {
  CYCLE: CycleRecord
  STATE_METADATA: StateMetaData
}

export type TypeName<T extends ValidTypes> = T extends CycleRecord
  ? TypeNames.CYCLE
  : TypeNames.STATE_METADATA

export type TypeIndex<T extends ValidTypes> = T extends CycleRecord
  ? CycleRecord['counter']
  : StateMetaData['counter']

export interface NetworkHash {
  cycle: number
  hash: string
}

export interface StateHashes {
  counter: CycleRecord['counter']
  partitionHashes: object
  networkHash: NetworkStateHash
}

export interface ReceiptHashes {
  counter: CycleRecord['counter']
  receiptMapHashes: object
  networkReceiptHash: NetworkReceiptHash
}

export interface SummaryHashes {
  counter: CycleRecord['counter']
  summaryHashes: object
  networkSummaryHash: NetworkSummarytHash
}

export interface Record {
  networkDataHash: NetworkHash[]
  networkReceiptHash: NetworkHash[]
  networkSummaryHash: NetworkHash[]
}
interface Account {
  accountId: string
  hash: string
}
export type PartitionRanges = Map<
  shardFunctionTypes.AddressRange['partition'],
  shardFunctionTypes.AddressRange
>
type PartitionAccounts = Map<
  shardFunctionTypes.AddressRange['partition'],
  Account[]
>

export type PartitionHashes = Map<
  shardFunctionTypes.AddressRange['partition'],
  string
>

export type ReceiptMapHashes = Map<
  shardFunctionTypes.AddressRange['partition'],
  string
>

export type NetworkStateHash = string
export type NetworkReceiptHash = string
export type NetworkSummarytHash = string
export type PartitionNum = number
export enum offerResponse {
  needed = 'needed',
  notNeeded = 'not_needed',
  tryLater = 'try_later',
  sendTo = 'send_to',
}
