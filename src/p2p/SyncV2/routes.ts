/**
 * `routes` submodule. Defines any routes that need to be exposed and
 * available for other nodes to query.
 */

import { P2P } from '@shardus/types'
import { Handler } from 'express'
import * as CycleChain from '../CycleChain'
import { network } from '../Context'
import * as NodeList from '../NodeList'
import * as Archivers from '../Archivers'
import * as CycleCreator from '../CycleCreator'

/** An endpoint that returns the latest node list hash. */
const validatorListHashRoute: P2P.P2PTypes.Route<Handler> = {
  method: 'GET',
  name: 'validator-list-hash',
  handler: (_req, res) => {
    const nextCycleTimestamp = CycleCreator.nextQ1Start
    res.json({ nodeListHash: NodeList.getNodeListHash(), nextCycleTimestamp })
  },
}

/** An endpoint that returns the latest archiver list hash. */
const archiverListHashRoute: P2P.P2PTypes.Route<Handler> = {
  method: 'GET',
  name: 'archiver-list-hash',
  handler: (_req, res) => {
    res.json({ archiverListHash: Archivers.getArchiverListHash() })
  },
}

/** An endpoint that returns the last cycle's marker (hash). */
const newestCycleHashRoute: P2P.P2PTypes.Route<Handler> = {
  method: 'GET',
  name: 'current-cycle-hash',
  handler: (_req, res) => {
    res.json(CycleChain.getCurrentCycleMarker())
  },
}

/** An endpoint that returns the last hashed validator list if the expected (requested)
  * hash matches. */
const validatorListRoute: P2P.P2PTypes.Route<Handler> = {
  method: 'GET',
  name: 'validator-list',
  handler: (req, res) => {
    const expectedHash = req.query.hash

    // return the validator list if the hash from the requester matches
    if (expectedHash && expectedHash === NodeList.getNodeListHash()) {
      res.json(NodeList.getLastHashedNodeList())
    } else {
      console.error(`rejecting validator list request: expected '${expectedHash}' != '${NodeList.getNodeListHash()}'`)
      res.status(404).send(`validator list with hash '${expectedHash}' not found`)
    }
  },
}

/** An endpoint that returns the last hashed archiver list if the expected (requested)
  * hash matches. */
const archiverListRoute: P2P.P2PTypes.Route<Handler> = {
  method: 'GET',
  name: 'archiver-list',
  handler: (req, res) => {
    const expectedHash = req.query.hash

    // return the archiver list if the hash from the requester matches
    if (expectedHash && expectedHash === Archivers.getArchiverListHash()) {
      res.json(Archivers.getLastHashedArchiverList())
    } else {
      console.error(`rejecting archiver list request: expected '${expectedHash}' != '${Archivers.getArchiverListHash()}'`)
      res.status(404).send(`archiver list with hash '${expectedHash}' not found`)
    }
  },
}

/** An endpoint that returns the cycle corresponding to the requested marker. */
const cycleByMarkerRoute: P2P.P2PTypes.Route<Handler> = {
  method: 'GET',
  name: 'cycle-by-marker',
  handler: (req, res) => {
    // get the cycle corresponding to the marker. return it if it exists, or
    // otherwise return an error.
    const cycle = CycleChain.cyclesByMarker[req.query.marker as string]
    if (cycle) {
      res.json(cycle)
    } else {
      res.status(404).send(`cycle with marker '${req.query.hash}' not found`)
    }
  },
}

const newestCycleRecordRoute: P2P.P2PTypes.Route<Handler> = {
    method: 'GET',
    name: 'newest-cycle-record',
    handler: (_req, res) => {
        res.json(CycleChain.newest)
    }
}

/** Registers all routes as external routes. */
export function initRoutes(): void {
  const routes = [
    validatorListHashRoute,
    archiverListHashRoute,
    newestCycleHashRoute,
    validatorListRoute,
    archiverListRoute,
    cycleByMarkerRoute,
    newestCycleRecordRoute
  ]

  for (const route of routes) {
    network._registerExternal(route.method, route.name, route.handler)
  }
}
