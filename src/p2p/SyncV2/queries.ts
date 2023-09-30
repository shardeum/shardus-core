/**
 * `queries` submodule. Contains logic pertaining to anything that
 * requires an external node to be queried, including robust queries.
 */

import { hexstring, P2P } from '@shardus/types'
import { errAsync, ResultAsync } from 'neverthrow'
import { attempt, robustQuery } from '../Utils'
import * as http from '../../http'
import { logger } from '../Context'
import { Logger } from 'log4js'
import { JoinRequest } from '@shardus/types/build/src/p2p/JoinTypes'

/** A `ResultAsync` that wraps an `UnwrappedRobustResult`. */
export type RobustQueryResultAsync<T> = ResultAsync<UnwrappedRobustResult<ActiveNode, T>, Error>

/** A successful RobustQueryResult whose value is an unwrapped `Ok` `Result`. */
type UnwrappedRobustResult<N, V> = {
  winningNodes: N[]
  value: V
}

// Convenience type aliases.
type ActiveNode = P2P.SyncTypes.ActiveNode
type Validator = P2P.NodeListTypes.Node
type Archiver = P2P.ArchiversTypes.JoinedArchiver
type CycleRecord = P2P.CycleCreatorTypes.CycleRecord

const MAX_RETRIES = 3

let mainLogger: Logger
export function initLogger(): void {
  mainLogger = logger.getLogger('main')
}

/**
 * Executes a robust query to a specified endpoint across multiple nodes, providing more fault tolerance.
 *
 * @param {ActiveNode[]} nodes - An array of active nodes to query.
 * @param {string} endpointName - The name of the endpoint to call on the active nodes.
 *
 * The function runs a robust query, logs the query, and ensures the result of the query is robust.
 * It makes an HTTP GET request to the specified endpoint for each node, and if the call fails,
 * an error message is returned.
 *
 * @returns {RobustQueryResultAsync<T>} - A ResultAsync object. On success, it contains a result object with
 * the winning nodes and the returned value. On failure, it contains an Error object. The function is asynchronous
 * and can be awaited.
 */
function makeRobustQueryCall<T>(nodes: ActiveNode[], endpointName: string): RobustQueryResultAsync<T> {
  // query function that makes the endpoint call as specified
  const queryFn = (node: ActiveNode): ResultAsync<T, Error> => {
    const ip = node.ip
    const port = node.port

    // queries the cyclemarker endpoint defined in ../Join.ts
    return ResultAsync.fromPromise(
      http.get(`${ip}:${port}/${endpointName}`),
      (err) => new Error(`couldn't query ${endpointName}: ${err}`)
    )
  }

  // run the robust query, wrapped in an async Result return the unwrapped result (with `map`) if successful
  const logPrefix = `syncv2-robust-query-${endpointName}`
  return ResultAsync.fromPromise(
    attempt(async () => await robustQuery(nodes, queryFn), {
      maxRetries: MAX_RETRIES,
      logPrefix,
      logger: mainLogger,
    }),
    (err) => new Error(`robust query failed for ${endpointName}: ${err}`)
  ).andThen((robustResult) => {
    // ensuring the result was robust as well.
    if (!robustResult.isRobustResult) {
      return errAsync(new Error(`result of ${endpointName} wasn't robust`))
    }
    return robustResult.topResult.map((value) => ({
      winningNodes: robustResult.winningNodes,
      value,
    }))
  })
}

/**
 * Performs a simple fetch operation from a given node to a specified endpoint. The operation is retried up to
 * MAX_RETRIES times in case of failure.
 *
 * @param {ActiveNode} node - An active node to fetch data from.
 * @param {string} endpointName - The name of the endpoint to fetch data from.
 *
 * The function attempts to make an HTTP GET request to the specified endpoint. If the call fails,
 * it retries the operation and returns an error message.
 *
 * @returns {ResultAsync<T, Error>} - A ResultAsync object. On success, it will contain the data fetched, and
 * on error, it will contain an Error object. The function is asynchronous and can be awaited.
 */
function attemptSimpleFetch<T>(
  node: ActiveNode,
  endpointName: string,
  params: Record<string, string> = {}
): ResultAsync<T, Error> {
  let url = `${node.ip}:${node.port}/${endpointName}`;
  if (params) {
    const encodedParams = new URLSearchParams(params).toString();
    url += `?${encodedParams}`;
  }

  return ResultAsync.fromPromise(
    attempt(async () => await http.get(url), {
      maxRetries: MAX_RETRIES,
      logPrefix: `syncv2-simple-fetch-${endpointName}`,
      logger: mainLogger,
    }),
    (err) => new Error(`simple fetch failed for ${endpointName}: ${err}`)
  )
}

/** Executes a robust query to retrieve the cycle marker from the network. */
export function robustQueryForCycleRecordHash(nodes: ActiveNode[]): RobustQueryResultAsync<hexstring> {
  return makeRobustQueryCall(nodes, 'current-cycle-hash')
}

/** Executes a robust query to retrieve the validator list hash and next cycle timestamp from the network. */
export function robustQueryForValidatorListHash(
  nodes: ActiveNode[]
): RobustQueryResultAsync<{ nodeListHash: hexstring, nextCycleTimestamp: number }> {
  return makeRobustQueryCall(nodes, 'validator-list-hash')
}

/** Executes a robust query to retrieve the archiver list hash from the network. */
export function robustQueryForArchiverListHash(
  nodes: ActiveNode[]
): RobustQueryResultAsync<{ archiverListHash: hexstring }> {
  return makeRobustQueryCall(nodes, 'archiver-list-hash')
}

/** Executes a robust query to retrieve the standby list hash from the network. */
export function robustQueryForStandbyNodeListHash(
  nodes: ActiveNode[]
): RobustQueryResultAsync<{ standbyNodeListHash: hexstring }> {
  return makeRobustQueryCall(nodes, 'standby-list-hash')
}

/** Retrives the cycle by marker from the node. */
export function getCycleDataFromNode(node: ActiveNode, expectedMarker: hexstring): ResultAsync<CycleRecord, Error> {
  return attemptSimpleFetch(node, 'cycle-by-marker', {
    marker: expectedMarker
  })
}

/** Gets the full validator list from the specified node. */
export function getValidatorListFromNode(node: ActiveNode, expectedHash: hexstring): ResultAsync<Validator[], Error> {
  return attemptSimpleFetch(node, 'validator-list', {
    hash: expectedHash,
  })
}

/** Gets the full archiver list from the specified archiver. */
export function getArchiverListFromNode(node: ActiveNode, expectedHash: hexstring): ResultAsync<Archiver[], Error> {
  return attemptSimpleFetch(node, 'archiver-list', {
    hash: expectedHash,
  })
}

/** Gets the full standby list from the specified standby. */
export function getStandbyNodeListFromNode(node: ActiveNode, expectedHash: hexstring): ResultAsync<JoinRequest[], Error> {
  return attemptSimpleFetch(node, 'standby-list', {
    hash: expectedHash,
  })
}
