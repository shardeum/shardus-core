import * as shardFunctionTypes from '../../state-manager/shardFunctionTypes';
import { NetworkHash } from '../../p2p/StateParser';

/** TYPES */

export interface Record {
  networkDataHash: NetworkHash[];
  networkReceiptHash: NetworkHash[];
  networkSummaryHash: NetworkHash[];
}
interface Account {
  accountId: string;
  hash: string;
}
export type PartitionRanges = Map<
  shardFunctionTypes.AddressRange['partition'],
  shardFunctionTypes.AddressRange
>;
type PartitionAccounts = Map<
  shardFunctionTypes.AddressRange['partition'],
  Account[]
>;

export type PartitionHashes = Map<
  shardFunctionTypes.AddressRange['partition'],
  string
>;

export type ReceiptMapHashes = Map<
  shardFunctionTypes.AddressRange['partition'],
  string
>;


export type NetworkStateHash = string;
export type NetworkReceiptHash = string;
export type NetworkSummarytHash = string;
export type PartitionNum = number;
export enum offerResponse {
  needed = 'needed',
  notNeeded = 'not_needed',
  tryLater = 'try_later',
  sendTo = 'send_to'
}
