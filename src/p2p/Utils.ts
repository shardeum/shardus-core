import * as crypto from 'crypto';
import util from 'util';
import { logFlags } from '../logger';
import * as utils from '../utils';
import { getRandom, sleep, stringifyReduce } from '../utils';
import FastRandomIterator from '../utils/FastRandomIterator';
import { nestedCountersInstance } from '../utils/nestedCounters';
import { profilerInstance } from '../utils/profiler';
import { config, stateManager } from './Context';
import * as Context from './Context';
import * as Self from './Self';
import * as NodeList from './NodeList';
import { Logger } from 'log4js';
import { P2P } from '@shardus/types';
import { Result } from 'neverthrow';
import { getPublicNodeInfo } from './Self';
import * as http from '../http';
import { ok, err } from 'neverthrow';
import { postToArchiver, getNumArchivers, getRandomArchiver } from './Archivers';
import { JoinedArchiver } from '@shardus/types/build/src/p2p/ArchiversTypes';
import { ActiveNode } from '@shardus/types/build/src/p2p/SyncTypes';
export type QueryFunction<Node, Response> = (node: Node) => PromiseLike<Response>;

export type VerifyFunction<Result> = (result: Result) => boolean;

export type EqualityFunction<Value> = (val1: Value, val2: Value) => boolean;

export type CompareFunction<Result> = (result: Result) => Comparison;

export enum Comparison {
  BETTER,
  EQUAL,
  WORSE,
  ABORT,
}

export interface CompareQueryError<Node> {
  node: Node;
  error: string;
}

export type CompareFunctionResult<Node> = Array<CompareQueryError<Node>>;

export interface SequentialQueryError<Node> {
  node: Node;
  error: Error;
  response?: unknown;
}

export interface SequentialQueryResult<Node> {
  result: unknown;
  errors: Array<SequentialQueryError<Node>>;
}

export type SeedNodesList = {
  nodeList: P2P.P2PTypes.Node[];
  joinRequest: P2P.ArchiversTypes.Request | undefined;
  restartCycleRecord: P2P.ArchiversTypes.RestartCycleRecord | undefined;
  dataRequestCycle: unknown;
  dataRequestStateMetaData: unknown;
};

export async function compareQuery<Node = unknown, Response = unknown>(
  nodes: Node[],
  queryFn: QueryFunction<Node, Response>,
  compareFn: CompareFunction<Response>,
  matches: number
): Promise<CompareFunctionResult<Node>> {
  let abort: boolean;
  let startOver: boolean;
  let errors: Array<CompareQueryError<Node>>;
  let matched: number;

  do {
    abort = false;
    startOver = false;
    errors = [];
    matched = 0;

    for (const node of nodes) {
      try {
        const response = await queryFn(node);

        switch (compareFn(response)) {
          case Comparison.BETTER:
            // We start over
            startOver = true;
            break;
          case Comparison.EQUAL:
            matched++;
            if (matched >= matches) return errors;
            break;
          case Comparison.WORSE:
            // Try the next one
            break;
          case Comparison.ABORT:
            // End everything and return
            abort = true;
            break;
          default:
        }

        if (abort) break;
        if (startOver) break;
      } catch (error) {
        errors.push({
          node,
          error: JSON.stringify(error, Object.getOwnPropertyNames(error)),
        });
      }
    }
  } while (startOver);

  return errors;
}

/**
 * TODO PERF replace shuffle with fastRandomIterator (currently sequentialQuery is unused)
 * @param nodes
 * @param queryFn
 * @param verifyFn
 */
export async function sequentialQuery<Node = unknown, Response = unknown>(
  nodes: Node[],
  queryFn: QueryFunction<Node, Response>,
  verifyFn: VerifyFunction<Response> = () => true
): Promise<SequentialQueryResult<Node>> {
  nodes = [...nodes];
  utils.shuffleArray(nodes);

  let result: Response;
  const errors: Array<SequentialQueryError<Node>> = [];

  for (const node of nodes) {
    try {
      const response = await queryFn(node);
      if (verifyFn(response) === false) {
        errors.push({
          node,
          error: new Error('Response failed verifyFn'),
          response,
        });
        continue;
      }
      result = response;
    } catch (error) {
      errors.push({
        node,
        error,
      });
    }
  }

  return {
    result,
    errors,
  };
}

type TallyItem<N, T> = {
  value: T; // Response type is from a template
  count: number;
  nodes: N[]; // Shardus.Node[] Not using this because robustQuery uses a generic Node, maybe it should be non generic?
};

export type RobustQueryResult<N, R> = {
  topResult: R;
  winningNodes: N[];
  isRobustResult: boolean;
};

class Tally<Node, Response> {
  winCount: number;
  equalFn: EqualityFunction<Response>;
  items: TallyItem<Node, Response>[];
  extraDebugging: boolean;

  constructor(winCount: number, equalFn: EqualityFunction<Response>, extraDebugging = false) {
    this.winCount = winCount;
    this.equalFn = equalFn;
    this.items = [];
    this.extraDebugging = extraDebugging;
  }

  add(response: Response, node: Node): TallyItem<Node, Response> | null {
    if (response === null) {
      if (this.extraDebugging) nestedCountersInstance.countEvent('robustQuery', `response is null`);
      return null;
    }
    // We search to see if we've already seen this item before
    for (const item of this.items) {
      // If the value of the new item is not equal to the current item, we continue searching
      if (!this.equalFn(response, item.value)) continue;
      // If the new item is equal to the current item in the list,
      // we increment the current item's counter and add the current node to the list
      item.count++;
      item.nodes.push(node);
      // Here we check our win condition if the current item's counter was incremented
      // If we meet the win requirement, we return an array with the value of the item,
      // and the list of nodes who voted for that item
      if (item.count >= this.winCount) {
        return item;
      }
      // Otherwise, if the win condition hasn't been met,
      // We return null to indicate no winner yet
      return null;
    }
    // If we made it through the entire items list without finding a match,
    // We create a new item and set the count to 1
    const newItem = { value: response, count: 1, nodes: [node] };
    this.items.push(newItem);
    // Finally, we check to see if the winCount is 1,
    // and return the item we just created if that is the case
    if (this.winCount === 1) return newItem; //return [newItem, [node]]
  }
  getHighestCount() {
    if (!this.items.length) return 0;
    let highestCount = 0;
    for (const item of this.items) {
      if (item.count > highestCount) {
        highestCount = item.count;
      }
    }
    return highestCount;
  }
  getHighestCountItem(): TallyItem<Node, Response> | null {
    if (!this.items.length) return null;
    let highestCount = 0;
    let highestIndex = 0;
    let i = 0;
    for (const item of this.items) {
      if (item.count > highestCount) {
        highestCount = item.count;
        highestIndex = i;
      }
      i += 1;
    }
    return this.items[highestIndex];
  }
}

/**
 * [TODO] robustQuery should handle being given an enourmous node list (Dont copy and shuffle it)
 *
 * TODO replace console.log with a specific log funtion.
 *
 * Note -
 * robustQuery should NOT be given a node list that includes yourself (Use NodeList.activeOthersByIdOrder).
 * OR
 * the queryFunction can return null if the node being queried is Self.id
 *
 * @param nodes
 * @param queryFn
 * @param equalityFn
 * @param redundancy
 * @param shuffleNodes
 * @param strictRedundancy
 * @param extraDebugging
 */
export async function robustQuery<Node = unknown, Response = unknown>(
  nodes: Node[] = [],
  queryFn: QueryFunction<Node, Response>,
  equalityFn: EqualityFunction<Response> = util.isDeepStrictEqual,
  redundancy = 3,
  shuffleNodes = true,
  strictRedundancy = false,
  extraDebugging = false,
  note = 'general',
  maxRetry = 20
): Promise<RobustQueryResult<Node, Response>> {
  if (nodes.length === 0) throw new Error('No nodes given.');
  if (typeof queryFn !== 'function') {
    throw new Error(`Provided queryFn ${queryFn} is not a valid function.`);
  }
  // let originalRedundancy = redundancy
  if (redundancy < 1) {
    redundancy = 3;
  }
  if (redundancy > nodes.length) {
    if (strictRedundancy) {
      if (extraDebugging)
        nestedCountersInstance.countEvent('robustQuery', `${note} not enough nodes to meet strictRedundancy`);
      if (logFlags.console || config.debug.robustQueryDebug || extraDebugging)
        console.log('robustQuery: isRobustResult=false. not enough nodes to meet strictRedundancy');
      return { topResult: null, winningNodes: [], isRobustResult: false };
    }
    redundancy = nodes.length;
  }

  const responses = new Tally<Node, Response>(redundancy, equalityFn);
  let errors = 0;

  // old shuffle.  replaced by FastRandomIterator has much better performance as the pools size grows.
  // this will be helpfull for large networks with many active nodes.
  // nodes = [...nodes]
  // if (shuffleNodes === true) {
  //   utils.shuffleArray(nodes)
  // }

  let randomNodeIterator: FastRandomIterator = null;
  if (shuffleNodes === true) {
    randomNodeIterator = new FastRandomIterator(nodes.length, redundancy);
  } else {
    nodes = [...nodes];
  }

  const nodeCount = nodes.length;

  const queryNodes = async (nodes: Node[]): Promise<TallyItem<Node, Response> | null> => {
    // Wrap the query so that we know which node it's coming from
    const wrappedQuery = async (node: Node) => {
      const response = await queryFn(node);
      return { response, node };
    };

    // We create a promise for each of the first `redundancy` nodes in the shuffled array
    const queries = [];
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      queries.push(wrappedQuery(node));
    }
    if (logFlags.profiling_verbose)
      profilerInstance.scopedProfileSectionStart(`robustQuery ${note} queryNodes`);
    const [results, errs] = await utils.robustPromiseAll<{ response: Response; node: Node }>(queries);
    if (logFlags.profiling_verbose)
      profilerInstance.scopedProfileSectionEnd(`robustQuery ${note} queryNodes`);

    if (logFlags.console || config.debug.robustQueryDebug || extraDebugging) {
      console.log('robustQuery results', note, results);
      console.log('robustQuery errs', note, errs);
    }

    let finalResult: TallyItem<Node, Response>;
    for (const result of results) {
      const { response, node } = result;
      if (response === null) {
        if (extraDebugging) nestedCountersInstance.countEvent('robustQuery', `${note} response is null`);
        continue;
      } // ignore null response; can be null if we tried to query ourself
      finalResult = responses.add(response, node);
      if (finalResult) {
        if (extraDebugging) nestedCountersInstance.countEvent('robustQuery', `${note} got final result`);
        break;
      }
    }
    if (extraDebugging) {
      console.log('robustQuery tally items', note, responses.items);
      console.log('robustQuery final result', note, finalResult);
    }

    for (const err of errs) {
      if (logFlags.console || config.debug.robustQueryDebug || extraDebugging)
        console.log('robustQuery: err:', err);
      errors += 1;
      if (extraDebugging) nestedCountersInstance.countEvent('robustQuery', `${note} error: ${err.message}`);
    }

    if (!finalResult) {
      if (extraDebugging) nestedCountersInstance.countEvent('robustQuery', `${note} no final result`);
      return null;
    }
    return finalResult;
  };

  let finalResult: TallyItem<Node, Response> = null;
  let tries = 0;
  while (!finalResult) {
    tries += 1;
    const toQuery = redundancy - responses.getHighestCount();
    if (nodes.length < toQuery) {
      /* prettier-ignore */ if (logFlags.console || config.debug.robustQueryDebug || extraDebugging) console.log(`robustQuery: ${note} stopping since we ran out of nodes to query.`)
      if (extraDebugging)
        nestedCountersInstance.countEvent(
          'robustQuery',
          `${note} stopping since we ran out of nodes to query.`
        );
      break;
    }
    let nodesToQuery: Node[];
    if (shuffleNodes) {
      let index = randomNodeIterator.getNextIndex();
      nodesToQuery = [];
      while (index >= 0 && nodesToQuery.length < toQuery) {
        nodesToQuery.push(nodes[index]);
        index = randomNodeIterator.getNextIndex();
      }
    } else {
      nodesToQuery = nodes.splice(0, toQuery);
    }
    finalResult = await queryNodes(nodesToQuery);
    if (tries >= maxRetry) {
      /* prettier-ignore */ if (logFlags.console || config.debug.robustQueryDebug || extraDebugging) console.log('robustQuery: stopping after 20 tries.')
      if (extraDebugging) nestedCountersInstance.countEvent('robustQuery', `${note} stopped after 20 tries`);
      break;
    }
  }
  nestedCountersInstance.countEvent('robustQuery', `${note} tries: ${tries}`);
  if (finalResult) {
    const isRobustResult = finalResult.count >= redundancy;
    if (config.debug.robustQueryDebug || extraDebugging)
      console.log(`robustQuery: ${note} stopping since we got a finalResult:${stringifyReduce(finalResult)}`);
    if (extraDebugging)
      nestedCountersInstance.countEvent(
        'robustQuery',
        `${note} stopping since we got finalResult:${stringifyReduce(finalResult)}`
      );
    return {
      topResult: finalResult.value,
      winningNodes: finalResult.nodes,
      isRobustResult,
    };
  } else {
    // Note:  We return the item that had the most nodes reporting it. However, the caller should know
    //        The calling code can now check isRobustResult to see if a topResult is valid
    if (logFlags.console || config.debug.robustQueryDebug || extraDebugging)
      console.log(
        `robustQuery: Could not get ${redundancy} ${
          redundancy > 1 ? 'redundant responses' : 'response'
        } from ${nodeCount} ${nodeCount !== 1 ? 'nodes' : 'node'}. Encountered ${errors} query errors.`
      );
    const highestCountItem = responses.getHighestCountItem();
    if (highestCountItem === null) {
      if (config.debug.robustQueryDebug || extraDebugging) {
        console.log(
          `isRobustResult=false. highestCountItem=null robust tally dump: ${stringifyReduce(responses)}`
        );
      }
      //if there was no highestCountItem then we had no responses at all
      /* prettier-ignore */ if (logFlags.console || config.debug.robustQueryDebug || extraDebugging) console.log('robustQuery: isRobustResult=false. no responses at all')
      if (extraDebugging)
        nestedCountersInstance.countEvent('robustQuery', `isRobustResult=false. no responses at all`);
      return { topResult: null, winningNodes: [], isRobustResult: false };
    }
    //this isRobustResult should always be false if we get to this code.
    const isRobustResult = highestCountItem.count >= redundancy;
    if (logFlags.console || config.debug.robustQueryDebug)
      console.log('robustQuery: isRobustResult=false. returning highest count response');
    if (config.debug.robustQueryDebug || extraDebugging) {
      console.log(`isRobustResult=false. robust tally dump: ${stringifyReduce(responses)}`);
    }
    if (extraDebugging)
      nestedCountersInstance.countEvent(
        'robustQuery',
        `${note} isRobustResult=false. returning highest count response. ${stringifyReduce(responses)}`
      );
    return {
      topResult: highestCountItem.value,
      winningNodes: highestCountItem.nodes,
      isRobustResult,
    };
  }

  // NOTE: this function does not throw errors for situations where we don't have enough responses.
  // instead we return a structured result with enough information about how the query worked.
  // throwing errors was causing problems in past testing.
  // it is OK to throw errors for stuff that is an unexected code mistake in cases where the code would
  //   fail right away.
}

/**
 * Attempts to execute a given asynchronous function up to a certain number of retries upon failure.
 *
 * @template T The type of the resolved value of the input function.
 * @param {() => Promise<T>} fn - The asynchronous function to execute. This function should return a Promise that resolves to a value of type `T`.
 * @param {AttemptOptions} options - Optional. Options passed to change the behavior of this function. See the `AttemptOptions` interface in this same file for details.
 * @returns {Promise<T>} A Promise that resolves to the return value of the input function, if successful.
 * @throws Will throw an error if the function fails all attempts. The error will be the last error thrown by the input function.
 */
export async function attempt<T>(fn: () => Promise<T>, options?: AttemptOptions): Promise<T> {
  // fallback to option defaults if needed
  const maxRetries = options?.maxRetries || 3;
  const delay = options?.delay || 2000;
  const logPrefix = options?.logPrefix || 'attempt';
  const logger = options?.logger;

  // initialize our lastError variable
  let lastError = new Error('out of retries');

  // loop until we're successful
  for (let i = 0; i < maxRetries; i++) {
    try {
      // run the function and return the result. if the funciton fails,
      // we'll catch it below
      return await fn();
    } catch (e) {
      // log the error
      if (logger && logFlags.error) logger.error(`${logPrefix}: attempt failure #${i + 1}: ${e.message}`);

      // save the error in case we need to throw it later
      lastError = e;

      // sleep before trying again
      await sleep(delay);
      continue;
    }
  }

  // log that we've run out of attempts
  if (logger && logFlags.error) logger.error(`${logPrefix}: giving up`);

  // think fast!
  throw lastError;
}

/** A little interface to represent the options you can pass to the `attempt` function. */
export interface AttemptOptions {
  /** The maximum number of attempts to execute the function. */
  maxRetries?: number;

  /** The delay between attempts, in milliseconds. */
  delay?: number;

  /** A log prefix to prepend to error logs on each failure. */
  logPrefix?: string;

  /** The logger to write to on failures. */
  logger?: Logger;

  /** optional timeout default 1000ms */
  timeout?: number;
}

export function generateUUID(): string {
  const buffer = crypto.randomBytes(16);
  buffer[6] = (buffer[6] & 0x0f) | 0x40; // Version 4
  buffer[8] = (buffer[8] & 0x3f) | 0x80; // Variant

  const uuid = buffer.toString('hex');
  return `${uuid.substring(0, 8)}-${uuid.substring(8, 4)}-${uuid.substring(12, 4)}-${uuid.substring(
    16,
    4
  )}-${uuid.substring(20)}`;
}

export function getOurNodeIndex(): number | null {
  let nodeInfo = stateManager.currentCycleShardData.nodeShardDataMap.get(Self.id);

  // no such node in the list
  if (!nodeInfo) return null;

  return nodeInfo.ourNodeIndex;
}

export const getOurNodeIndexFromSyncingList = (): number | null => {
  let nodeIndex = NodeList.syncingByIdOrder.findIndex((node) => node.id === Self.id);
  console.log('getOurNodeIndexFromSyncingList', nodeIndex);
  if (nodeIndex === -1) return null;
  return nodeIndex;
};

export function getRandomAvailableArchiver(): P2P.SyncTypes.ActiveNode {
  if (getNumArchivers() === 0) {
    // original version - choose among *configured* archivers
    // note that over time these could go down and new ones could join the network
    // but may be useful during startup (not verified)
    const availableArchivers = Context.config.p2p.existingArchivers;
    return getRandom(availableArchivers, 1)[0];
  }
  return getRandomArchiver(); // from Archivers.ts
}

export async function getActiveNodesFromArchiver(
  archiver: ActiveNode
): Promise<Result<P2P.P2PTypes.SignedObject<SeedNodesList>, Error>> {
  const nodeInfo = getPublicNodeInfo();
  return await postToArchiver<unknown, P2P.P2PTypes.SignedObject<SeedNodesList>>(
    archiver,
    'nodelist',
    Context.crypto.sign({
      nodeInfo,
    }),
    10000
  ).mapErr((e) => {
    // transform the error if we get one
    nestedCountersInstance.countRareEvent(
      'archiver_nodelist',
      'Could not get seed list from seed node server 2 '
    );
    const nodeListUrl = `http://${archiver.ip}:${archiver.port}/nodelist`;
    return Error(`Could not get seed list from seed node server 2 ${nodeListUrl}: ` + e.message);
  });
}

function isNodeRecentlyRotatedIn(idx: number, numActiveNodes: number): boolean {
  return (
    numActiveNodes >= 10 + config.p2p.rotationEdgeToAvoid &&
    config.p2p.rotationEdgeToAvoid &&
    idx <= config.p2p.rotationEdgeToAvoid
  );
}

function isNodeNearRotatingOut(idx: number, numActiveNodes: number): boolean {
  return (
    numActiveNodes >= 10 + config.p2p.rotationEdgeToAvoid &&
    config.p2p.rotationEdgeToAvoid &&
    idx >= numActiveNodes - config.p2p.rotationEdgeToAvoid
  );
}

/**
 * Returns true if a node was recently rotate in or
 * will be rotated out soon
 * @param nodeId
 * @returns
 */
export function isNodeInRotationBounds(nodeId: string): boolean {
  const { idx, total } = NodeList.getAgeIndexForNodeId(nodeId);
  // skip freshly rotated in nodes
  if (isNodeRecentlyRotatedIn(idx, total)) {
    nestedCountersInstance.countEvent('skip-newly-rotated-node', nodeId);
    return true;
  }

  // skip about to be rotated out nodes
  if (isNodeNearRotatingOut(idx, total)) {
    nestedCountersInstance.countEvent('skip-about-to-rotate-out-node', nodeId);
    return true;
  }
  return false;
}
