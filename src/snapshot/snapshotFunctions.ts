import got from 'got';
import { P2P, StateManager } from '@shardus/types';
import stream from 'stream';
import zlib from 'zlib';
import { logFlags } from '../logger';
import * as Context from '../p2p/Context';
import * as NodeList from '../p2p/NodeList';
import * as Self from '../p2p/Self';
import * as ShardusTypes from '../shardus/shardus-types';
import ShardFunctions from '../state-manager/shardFunctions';
import { Cycle, CycleShardData } from '../state-manager/state-manager-types';
import { safetyModeVals, snapshotLogger } from './index';
import { hashMap } from './partition-gossip';
import { NetworkClass } from '../network';
import { Utils } from '@shardus/types';

/** TYPES */

type txId = string;
type txId2 = string;
type ReceiptMap = Map<txId, txId2[]>;

type PartitionNum = number;

const fakeReceipMap = new Map();

export function calculatePartitionBlock(shard: { ourStoredPartitions: number[] }): Map<number, ReceiptMap> {
  const partitionToReceiptMap: Map<PartitionNum, ReceiptMap> = new Map();
  for (const partition of shard.ourStoredPartitions) {
    partitionToReceiptMap.set(partition, fakeReceipMap);
  }
  // set receiptMap for global partition
  partitionToReceiptMap.set(-1, fakeReceipMap);
  return partitionToReceiptMap;
}

export function createNetworkHash(hashes: Map<number, string>): P2P.SnapshotTypes.NetworkStateHash {
  let hashArray = [];
  for (const [, hash] of hashes) {
    hashArray.push(hash);
  }
  hashArray = hashArray.sort();
  const hash = Context.crypto.hash(hashArray);
  return hash;
}

export function updateStateHashesByCycleMap(
  counter: Cycle['counter'],
  stateHash: P2P.SnapshotTypes.StateHashes,
  stateHashesByCycle: Iterable<readonly [number, P2P.SnapshotTypes.StateHashes]>
): Map<number, P2P.SnapshotTypes.StateHashes> {
  const newStateHashByCycle: Map<Cycle['counter'], P2P.SnapshotTypes.StateHashes> = new Map(
    stateHashesByCycle
  );
  const transformedStateHash = {
    ...stateHash,
    partitionHashes: convertMapToObj(stateHash.partitionHashes),
  };
  newStateHashByCycle.set(counter, transformedStateHash);
  if (newStateHashByCycle.size > 100 && counter > 100) {
    const limit = counter - 100;
    for (const [key] of newStateHashByCycle) {
      if (key < limit) {
        newStateHashByCycle.delete(key);
      }
    }
  }
  return newStateHashByCycle;
}

export function updateReceiptHashesByCycleMap(
  counter: Cycle['counter'],
  receiptHash: P2P.SnapshotTypes.ReceiptHashes,
  receiptHashesByCycle: Iterable<readonly [number, P2P.SnapshotTypes.ReceiptHashes]>
): Map<number, P2P.SnapshotTypes.ReceiptHashes> {
  const newReceiptHashesByCycle: Map<Cycle['counter'], P2P.SnapshotTypes.ReceiptHashes> = new Map(
    receiptHashesByCycle
  );

  const transformedStateHash = {
    ...receiptHash,
    receiptMapHashes: convertMapToObj(receiptHash.receiptMapHashes),
  };
  newReceiptHashesByCycle.set(counter, transformedStateHash);
  if (newReceiptHashesByCycle.size > 100 && counter > 100) {
    const limit = counter - 100;
    for (const [key] of newReceiptHashesByCycle) {
      if (key < limit) {
        newReceiptHashesByCycle.delete(key);
      }
    }
  }
  return newReceiptHashesByCycle;
}

export function updateSummaryHashesByCycleMap(
  counter: Cycle['counter'],
  summaryHashes: P2P.SnapshotTypes.SummaryHashes,
  summaryHashesByCycle: Iterable<readonly [number, P2P.SnapshotTypes.SummaryHashes]>
): Map<number, P2P.SnapshotTypes.SummaryHashes> {
  const newSummaryHashesByCycle: Map<Cycle['counter'], P2P.SnapshotTypes.SummaryHashes> = new Map(
    summaryHashesByCycle
  );

  const transformedSummaryHash = {
    ...summaryHashes,
    summaryHashes: convertMapToObj(summaryHashes.summaryHashes),
  };
  newSummaryHashesByCycle.set(counter, transformedSummaryHash);
  if (newSummaryHashesByCycle.size > 100 && counter > 100) {
    const limit = counter - 100;
    for (const [key] of newSummaryHashesByCycle) {
      if (key < limit) {
        newSummaryHashesByCycle.delete(key);
      }
    }
  }
  return newSummaryHashesByCycle;
}

export async function savePartitionAndNetworkHashes(
  shard: CycleShardData,
  partitionHashes: hashMap,
  networkHash: P2P.SnapshotTypes.NetworkStateHash
): Promise<void> {
  for (const [partitionId, hash] of partitionHashes) {
    await Context.storage.addPartitionHash({
      partitionId,
      cycleNumber: shard.cycleNumber,
      hash,
    });
  }
  await Context.storage.addNetworkState({
    cycleNumber: shard.cycleNumber,
    hash: networkHash,
  });
}

export async function saveReceiptAndNetworkHashes(
  shard: CycleShardData,
  receiptMapHashes: hashMap,
  networkReceiptHash: P2P.SnapshotTypes.NetworkReceiptHash
): Promise<void> {
  for (const [partitionId, hash] of receiptMapHashes) {
    await Context.storage.addReceiptMapHash({
      partitionId,
      cycleNumber: shard.cycleNumber,
      hash,
    });
  }
  await Context.storage.addNetworkReceipt({
    cycleNumber: shard.cycleNumber,
    hash: networkReceiptHash,
  });
}

export async function saveSummaryAndNetworkHashes(
  shard: CycleShardData,
  summaryHashes: hashMap,
  summaryReceiptHash: P2P.SnapshotTypes.NetworkSummarytHash
): Promise<void> {
  for (const [partitionId, hash] of summaryHashes) {
    await Context.storage.addSummaryHash({
      partitionId,
      cycleNumber: shard.cycleNumber,
      hash,
    });
  }
  await Context.storage.addNetworkSummary({
    cycleNumber: shard.cycleNumber,
    hash: summaryReceiptHash,
  });
}

export async function readOldCycleRecord(): Promise<P2P.CycleCreatorTypes.CycleRecord> {
  const oldCycles = await Context.storage.listOldCycles();
  if (oldCycles && oldCycles.length > 0) return oldCycles[0];
}

export async function readOldNetworkHash(): Promise<{ hash: string }> {
  try {
    const networkStateHash = await Context.storage.getLastOldNetworkHash();
    log('Read Old network state hash', networkStateHash);
    if (networkStateHash && networkStateHash.length > 0) return networkStateHash[0];
  } catch (e) {
    snapshotLogger.error('Unable to read old network state hash');
  }
}

export async function readOldPartitionHashes(): Promise<{ hash: string; partitionId: string }[]> {
  try {
    const partitionHashes = await Context.storage.getLastOldPartitionHashes();
    log('Read Old partition_state_hashes', partitionHashes);
    return partitionHashes;
  } catch (e) {
    snapshotLogger.error('Unable to read old partition hashes');
  }
}

export async function calculateOldDataMap(
  shardGlobals: StateManager.shardFunctionTypes.ShardGlobals,
  nodeShardDataMap: StateManager.shardFunctionTypes.NodeShardDataMap,
  oldPartitionHashMap: Map<number, string>,
  lastSnapshotCycle: number
): Promise<Map<P2P.SnapshotTypes.PartitionNum, ShardusTypes.AccountsCopy[]>> {
  const partitionShardDataMap: StateManager.shardFunctionTypes.ParititionShardDataMap = new Map();
  const oldDataMap: Map<P2P.SnapshotTypes.PartitionNum, ShardusTypes.AccountsCopy[]> = new Map();
  ShardFunctions.computePartitionShardDataMap(
    shardGlobals,
    partitionShardDataMap,
    0,
    shardGlobals.numPartitions
  );

  /**
   * [NOTE] [AS] Need to do this because type of 'cycleJoined' field differs
   * between ShardusTypes.Node (number) and P2P/Node (string)
   */
  const nodes = NodeList.byIdOrder as unknown as ShardusTypes.Node[];

  ShardFunctions.computeNodePartitionDataMap(
    shardGlobals,
    nodeShardDataMap,
    nodes,
    partitionShardDataMap,
    nodes,
    true,
    false // this is not the active node list.  Perf will be slower so we may want to
    // rework this calculation
  );

  // If we have old data, figure out which partitions we have and put into OldDataMap
  for (const [partitionId, partitonObj] of partitionShardDataMap) {
    try {
      const lowAddress = partitonObj.homeRange.low;
      const highAddress = partitonObj.homeRange.high;
      const oldAccountCopiesInPartition = await Context.storage.getOldAccountCopiesByCycleAndRange(
        lastSnapshotCycle,
        lowAddress,
        highAddress
      );
      if (oldAccountCopiesInPartition) {
        const existingHash = oldPartitionHashMap.get(partitionId);
        const oldAccountsWithoutCycleNumber = oldAccountCopiesInPartition.map(
          (acc: { accountId: string; data: unknown; timestamp: number; hash: string; isGlobal: boolean }) => {
            return {
              accountId: acc.accountId,
              data: acc.data,
              timestamp: acc.timestamp,
              hash: acc.hash,
              isGlobal: acc.isGlobal,
            };
          }
        );
        const computedHash = Context.crypto.hash(oldAccountsWithoutCycleNumber);
        log(`old accounts in partition: ${partitionId}: `, oldAccountCopiesInPartition);
        log(computedHash, existingHash);
        log('partition: ', partitionId);
        log('existing hash: ', existingHash);
        log('computed hash: ', computedHash);

        // make sure that we really have correct data only if hashes match
        if (computedHash === existingHash) {
          oldDataMap.set(partitionId, oldAccountCopiesInPartition);
        }
      }
    } catch (e) {
      console.log(e);
    }
  }

  // check if we have global account in old DB
  try {
    const oldGlobalAccounts = await Context.storage.getOldGlobalAccountCopies(lastSnapshotCycle);
    if (oldGlobalAccounts) {
      const existingGlobalHash = oldPartitionHashMap.get(-1);
      const oldGlobalAccWithoutCycleNumber = oldGlobalAccounts.map(
        (acc: { accountId: string; data: unknown; timestamp: number; hash: string; isGlobal: boolean }) => {
          return {
            accountId: acc.accountId,
            data: acc.data,
            timestamp: acc.timestamp,
            hash: acc.hash,
            isGlobal: acc.isGlobal,
          };
        }
      );
      const computedGlobalHash = Context.crypto.hash(oldGlobalAccWithoutCycleNumber);
      log('existing global hash', existingGlobalHash);
      log('computed global hash', computedGlobalHash);
      // make sure that we really have correct data only if hashes match
      if (computedGlobalHash === existingGlobalHash) {
        oldDataMap.set(-1, oldGlobalAccounts);
      }
    }
  } catch (e) {
    console.log(e);
  }
  return oldDataMap;
}

export function copyOldDataToDataToMigrate(
  oldDataMap: Map<number, ShardusTypes.AccountsCopy[]>,
  dataToMigrate: Map<number, ShardusTypes.AccountsCopy[]>
): void {
  for (const [key, value] of oldDataMap) {
    if (!dataToMigrate.has(key)) {
      dataToMigrate.set(key, value);
    }
  }
}

export function getMissingPartitions(
  shardGlobals: StateManager.shardFunctionTypes.ShardGlobals,
  oldDataMap: Map<number, ShardusTypes.AccountsCopy[]>
): number[] {
  log('Checking missing partitions...');
  const missingPartitions = [];
  const { homePartition } = ShardFunctions.addressToPartition(shardGlobals, Self.id);
  log(`Home partition for us is: ${homePartition}`);
  const { partitionStart, partitionEnd } = ShardFunctions.calculateStoredPartitions2(
    shardGlobals,
    homePartition
  );
  log('partition start: ', partitionStart);
  log('partition end: ', partitionEnd);
  const partitionsToCheck = [];
  if (partitionStart < partitionEnd) {
    for (let i = partitionStart; i <= partitionEnd; i++) {
      partitionsToCheck.push(i);
    }
  } else if (partitionStart > partitionEnd) {
    const largestPartition = safetyModeVals.safetyNum - 1;
    for (let i = partitionStart; i <= largestPartition; i++) {
      partitionsToCheck.push(i);
    }
    for (let i = 0; i <= partitionEnd; i++) {
      partitionsToCheck.push(i);
    }
  }
  log('Partitions to check: ', partitionsToCheck);
  log('oldDataMap', oldDataMap);
  for (const partitionId of partitionsToCheck) {
    if (!oldDataMap.has(partitionId)) {
      missingPartitions.push(partitionId);
    }
  }
  // check for virtual global partiton
  if (!oldDataMap.has(-1)) {
    missingPartitions.push(-1);
  }
  return missingPartitions;
}

export function registerDownloadRoutes(
  network: NetworkClass,
  oldDataMap: Map<number, ShardusTypes.AccountsCopy[]>,
  oldPartitionHashMap: Map<number, string>
): void {
  let dataToSend = {};
  for (const [partitionId] of oldDataMap) {
    // eslint-disable-next-line security/detect-object-injection
    dataToSend[partitionId] = {
      data: oldDataMap.get(partitionId),
      hash: oldPartitionHashMap.get(partitionId),
    };
  }
  dataToSend = Utils.safeStringify(dataToSend);
  if (logFlags.console) console.log('Registering download route', typeof dataToSend, dataToSend);

  network.registerExternalGet('download-snapshot-data', (_req, res) => {
    const readerStream = stream.Readable.from([dataToSend]);
    const gzip = zlib.createGzip();

    res.set('content-disposition', 'attachment; filename="snapshot-data"');
    res.set('content-type', 'application/gzip');

    readerStream.on('error', (err) => console.log('rs Error', err));
    gzip.on('error', (err) => console.log('gzip Error', err));
    res.on('error', (err) => console.log('res Error', err));

    readerStream
      .pipe(gzip)
      .pipe(res)
      .on('end', () => {
        res.end({ success: true });
      });
  });
}

export async function downloadDataFromNode(url: string): Promise<unknown> {
  log('Downloading snapshot data from server...', url);
  const res = await got(url, {
    timeout: 1000, //  Omar - setting this to 1 sec
    retry: 0, // Omar - setting this to 0.
    decompress: true,
    encoding: null,
    headers: {
      'Content-Encoding': 'gzip',
    },
  });
  return new Promise((resolve, reject) => {
    zlib.unzip(res.body, (err, result) => {
      if (err) {
        reject(err);
      } else {
        try {
          const parsedData = Utils.safeJsonParse(result.toString());
          resolve(parsedData);
        } catch (e) {
          resolve(null);
        }
      }
    });
  });
}

/** If necessary, convert `inputMap` to a plan object. If the value passed to
 * this function is a `Map`, it will be converted. if it is not a `Map`,
 * we'll just return the value as it was passed. */
export function convertMapToObj(inputMap: Map<symbol, unknown> | object): object {
  if (inputMap instanceof Map) {
    const obj = {};
    for (const [key, value] of inputMap) {
      // eslint-disable-next-line security/detect-object-injection
      obj[key] = value;
    }
    return obj;
  } else {
    return inputMap;
  }
}

function log(...things: unknown[]): void {
  if (logFlags.console) console.log('DBG', 'SNAPSHOT', ...things);
}
