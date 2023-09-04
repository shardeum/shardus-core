/**
 * SyncV2 a p2p module that contains all of the functionality for the new
 * Node List Sync v2.
 */

import { errAsync, okAsync, ResultAsync } from 'neverthrow'
import { hexstring, P2P } from '@shardus/types'
import {
  getCycleDataFromNode,
  initLogger,
  robustQueryForCycleRecordHash,
  robustQueryForValidatorListHash,
  getValidatorListFromNode,
  getArchiverListFromNode,
  robustQueryForArchiverListHash,
  robustQueryForStandbyNodeListHash,
  getStandbyNodeListFromNode,
} from './queries'
import { verifyArchiverList, verifyCycleRecord, verifyValidatorList } from './verify'
import * as Archivers from '../Archivers'
import * as NodeList from '../NodeList'
import * as CycleChain from '../CycleChain'
import { initRoutes } from './routes'
import { digestCycle } from '../Sync'
import { StandbyAdditionInfo } from '@shardus/types/build/src/p2p/JoinTypes'
import { addStandbyNodes } from '../Join/v2'

/** Initializes logging and endpoints for Sync V2. */
export function init(): void {
  initLogger()
  initRoutes()
}

/**
 * This function synchronizes nodes, archivers and cycle records.
 *
 * @export
 * @param {P2P.SyncTypes.ActiveNode[]} activeNodes - An array of active nodes that can be queried for synchronization. The function first synchronizes the validator list, the archiver list, and then the latest cycle record respectively.
 *
 * Only active nodes are added to the NodeList, and all the archivers are added to the Archivers list.
 * The cycle record is then appended to the CycleChain.
 *
 * @returns {ResultAsync<void, Error>} - A ResultAsync object. On success, it will contain void and on
 * error, it will contain an Error object. The function is asynchronous and can be awaited.
 */
export function syncV2(activeNodes: P2P.SyncTypes.ActiveNode[]): ResultAsync<void, Error> {
  return syncValidValidatorList(activeNodes).andThen(([validatorList, validatorListHash]) =>
    syncArchiverList(activeNodes).andThen(([archiverList, archiverListHash]) =>
      syncStandbyNodeList(activeNodes).andThen((standbyNodeList) =>
      syncLatestCycleRecord(activeNodes).andThen((cycle) => {
        if (cycle.nodeListHash !== validatorListHash) {
          return errAsync(
            new Error(
              `validator list hash from received cycle (${cycle.nodeListHash}) does not match the hash received from robust query (${validatorListHash})`
            )
          )
        } else if (cycle.archiverListHash !== archiverListHash) {
          return errAsync(
            new Error(
              `archiver list hash from received cycle (${cycle.archiverListHash}) does not match the hash received from robust query (${archiverListHash})`
            )
          )
        }

        NodeList.reset()
        NodeList.addNodes(validatorList)

          // add archivers
        for (const archiver of archiverList) {
          Archivers.archivers.set(archiver.publicKey, archiver)
        }

          // add standby nodes
          addStandbyNodes(...standbyNodeList)

          // add latest cycle
        CycleChain.reset()
        digestCycle(cycle, 'syncV2')

        return okAsync(void 0)
      })
    )
  )
  )
}

/**
 * This function queries for a validator list from other active nodes.
 *
 * @param {P2P.SyncTypes.ActiveNode[]} activeNodes - An array of active nodes to be queried.
 * The function first performs a robust query for the latest node list hash.
 * Then, it requests a full list from one of the winning nodes using the hash
 * retrieved. The node receiving the request may or may not have the list whose
 * hash matches the one requested.
 *
 * @returns {ResultAsync<[P2P.NodeListTypes.Node[], hexstring], Error>} - A
 * ResultAsync object. On success, it will contain an array of Node objects and
 * the validator list hash, and on error, it will contain an Error object. The
 * function is asynchronous and can be awaited.
 */
function syncValidValidatorList(
  activeNodes: P2P.SyncTypes.ActiveNode[]
): ResultAsync<[P2P.NodeListTypes.Node[], hexstring], Error> {
  // run a robust query for the lastest node list hash
  return robustQueryForValidatorListHash(activeNodes).andThen(({ value, winningNodes }) =>
    // get full node list from one of the winning nodes
    getValidatorListFromNode(winningNodes[0], value.nodeListHash).andThen((nodeList) =>
      // verify a hash of the retrieved node list matches the hash from before.
      // if it does, return the node list
      verifyValidatorList(nodeList, value.nodeListHash).map(
        () => [nodeList, value.nodeListHash] as [P2P.NodeListTypes.Node[], hexstring]
      )
    )
  )
}

/**
 * This function queries for an archiver list from other active nodes.
 *
 * @param {P2P.SyncTypes.ActiveNode[]} activeNodes - An array of active nodes to be queried.
 * The function first performs a robust query for the latest archiver list hash.
 * Then, it requests a full list from one of the winning nodes using the hash
 * retrieved. The node receiving the request may or may not have the list whose
 * hash matches the one requested.
 *
 * @returns {ResultAsync<[P2P.ArchiversTypes.JoinedArchiver[], hexstring], Error>} - A ResultAsync object. On success, it will contain an array of
 * JoinedArchiver objects and the archiver list hash, and on error, it will contain an Error object. The function is asynchronous and can be awaited.
 */
function syncArchiverList(
  activeNodes: P2P.SyncTypes.ActiveNode[]
): ResultAsync<[P2P.ArchiversTypes.JoinedArchiver[], hexstring], Error> {
  // run a robust query for the lastest archiver list hash
  return robustQueryForArchiverListHash(activeNodes).andThen(({ value, winningNodes }) =>
    // get full archiver list from one of the winning nodes
    getArchiverListFromNode(winningNodes[0], value.archiverListHash).andThen((archiverList) =>
      // verify a hash of the retrieved archiver list matches the hash from before.
      // if it does, return the archiver list
      verifyArchiverList(archiverList, value.archiverListHash).map(
        () => [archiverList, value.archiverListHash] as [P2P.ArchiversTypes.JoinedArchiver[], hexstring]
      )
    )
  )
}

/**
 * This function queries for a valid standby node list.
 *
 * @param {P2P.SyncTypes.ActiveNode[]} activeNodes - An array of active nodes to be queried.
 * The function first performs a robust query for the latest standby node list hash.
 * Then, it requests a full list from one of the winning nodes using the hash
 * retrieved. The node receiving the request may or may not have the list whose
 * hash matches the one requested.
 *
 * @returns {ResultAsync<P2P.ArchiversTypes.JoinedArchiver[], Error>} - A ResultAsync object. On success, it will contain 
 * an array of StandbyAdditionInfo objects, and on error, it will contain an Error object. The function is asynchronous
 * and can be awaited.
 */
function syncStandbyNodeList(
  activeNodes: P2P.SyncTypes.ActiveNode[]
): ResultAsync<StandbyAdditionInfo[], Error> {
  // run a robust query for the lastest archiver list hash
  return robustQueryForStandbyNodeListHash(activeNodes).andThen(({ value, winningNodes }) => {
    // get full archiver list from one of the winning nodes
    return getStandbyNodeListFromNode(winningNodes[0], value.standbyNodeListHash)
  })
}

/**
 * Synchronizes the latest cycle record from a list of active nodes.
 *
 * @param {P2P.SyncTypes.ActiveNode[]} activeNodes - An array of active nodes to be queried.
 * The function first performs a robust query for the latest cycle record hash.
 * After obtaining the hash, it retrieves the current cycle data from one of the winning nodes.
 * It then verifies whether the cycle record marker matches the previously obtained hash.
 * If it matches, the cycle record is returned.
 *
 * @returns {ResultAsync<P2P.CycleCreatorTypes.CycleRecord, Error>} - A ResultAsync object.
 * On success, it will contain a CycleRecord object, and on error, it will contain an Error object.
 * The function is asynchronous and can be awaited.
 */
function syncLatestCycleRecord(
  activeNodes: P2P.SyncTypes.ActiveNode[]
): ResultAsync<P2P.CycleCreatorTypes.CycleRecord, Error> {
  // run a robust query for the latest cycle record hash
  return robustQueryForCycleRecordHash(activeNodes).andThen(({ value: cycleRecordHash, winningNodes }) =>
    // get current cycle record from node
    getCycleDataFromNode(winningNodes[0], cycleRecordHash).andThen((cycle) =>
      // verify the cycle record marker matches the hash from before. if it
      // does, return the cycle
      verifyCycleRecord(cycle, cycleRecordHash).map(() => cycle)
    )
  )
}
