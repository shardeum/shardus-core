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
import * as JoinV2 from '../Join/v2'
import { profilerInstance } from '../../utils/profiler'
import { logFlags } from '../../logger'
import { jsonHttpResWithSize } from '../../utils'
import { Utils } from '@shardus/types'

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

/** An endpoint that returns the latest standby node list hash. */
const standbyListHashRoute: P2P.P2PTypes.Route<Handler> = {
  method: 'GET',
  name: 'standby-list-hash',
  handler: (_req, res) => {
    res.json({ standbyNodeListHash: JoinV2.getStandbyListHash() })
  },
}

/** An endpoint that returns the last cycle's marker (hash). */
const newestCycleHashRoute: P2P.P2PTypes.Route<Handler> = {
  method: 'GET',
  name: 'current-cycle-hash',
  handler: (_req, res) => {
    res.json({ currentCycleHash: CycleChain.getCurrentCycleMarker() })
  },
}

/** An endpoint that returns the last hashed validator list if the expected (requested)
 * hash matches. */
const validatorListRoute: P2P.P2PTypes.Route<Handler> = {
  method: 'GET',
  name: 'validator-list',
  handler: (req, res) => {
    let respondSize = 0
    profilerInstance.scopedProfileSectionStart('validator-list', false)
    try {
      const expectedHash = req.query.hash

      // return the validator list if the hash from the requester matches
      if (expectedHash && expectedHash === NodeList.getNodeListHash()) {
        //res.json(NodeList.getLastHashedNodeList())
        const getLastHashedNodeList = NodeList.getLastHashedNodeList()
        respondSize = jsonHttpResWithSize(res, getLastHashedNodeList)
      } else {
        /* prettier-ignore */ if (logFlags.debug) console.error( `rejecting validator list request: expected '${expectedHash}' != '${NodeList.getNodeListHash()}'` )
        res.status(404).json({ error: `validator list with hash '${expectedHash}' not found` })
      }
    } finally {
      profilerInstance.scopedProfileSectionEnd('validator-list', respondSize)
    }
  },
}

/** An endpoint that returns the last hashed archiver list if the expected (requested)
 * hash matches. */
const archiverListRoute: P2P.P2PTypes.Route<Handler> = {
  method: 'GET',
  name: 'archiver-list',
  handler: (req, res) => {
    profilerInstance.scopedProfileSectionStart('archiver-list', false)
    const expectedHash = req.query.hash

    // return the archiver list if the hash from the requester matches
    if (expectedHash && expectedHash === Archivers.getArchiverListHash()) {
      res.json(Archivers.getLastHashedArchiverList())
    } else {
      /* prettier-ignore */ if (logFlags.debug) console.error( `rejecting archiver list request: expected '${expectedHash}' != '${Archivers.getArchiverListHash()}'` )
      res.status(404).json({ error: `archiver list with hash '${expectedHash}' not found` })
    }
    profilerInstance.scopedProfileSectionEnd('archiver-list')
  },
}

/** An endpoint that returns the last hashed standby list if the expected (requested)
 * hash matches. */
const standbyListRoute: P2P.P2PTypes.Route<Handler> = {
  method: 'GET',
  name: 'standby-list',
  handler: (req, res) => {
    let respondSize = 0
    profilerInstance.scopedProfileSectionStart('standby-list', false)

    try {
      const expectedHash = req.query.hash

      // return the standby list if the hash from the requester matches
      if (expectedHash && expectedHash === JoinV2.getStandbyListHash()) {
        const standbyList = JoinV2.getLastHashedStandbyList()
        //todo could make a helper that does response but gets size to
        // const standbyListStr = JSON.stringify(standbyList)
        // respondSize = standbyListStr.length
        // res.write(standbyListStr)
        // res.end()
        respondSize = jsonHttpResWithSize(res, standbyList)
        //res.json(standbyList)
      } else {
        /* prettier-ignore */ if (logFlags.debug) console.error( `rejecting standby list request: expected '${expectedHash}' != '${JoinV2.getStandbyListHash()}'` )
        res.status(404).json({ error: `standby list with hash '${expectedHash}' not found` })
      }
    } finally {
      profilerInstance.scopedProfileSectionEnd('standby-list', respondSize)
    }
  },
}

/** An endpoint that returns the cycle corresponding to the requested marker. */
const cycleByMarkerRoute: P2P.P2PTypes.Route<Handler> = {
  method: 'GET',
  name: 'cycle-by-marker',
  handler: (req, res) => {
    profilerInstance.scopedProfileSectionStart('cycle-by-marker', false)

    // get the cycle corresponding to the marker. return it if it exists, or
    // otherwise return an error.
    const cycle = CycleChain.cyclesByMarker[req.query.marker as string]
    if (cycle) {
      res.json(cycle)
    } else {
      res.status(404).json({ error: `cycle with marker '${req.query.marker}' not found` })
    }
    profilerInstance.scopedProfileSectionEnd('cycle-by-marker')
  },
}

const newestCycleRecordRoute: P2P.P2PTypes.Route<Handler> = {
  method: 'GET',
  name: 'newest-cycle-record',
  handler: (_req, res) => {
    profilerInstance.scopedProfileSectionStart('newest-cycle-record', false)
    res.json(CycleChain.newest)
    profilerInstance.scopedProfileSectionEnd('newest-cycle-record')
  },
}

/** Registers all routes as external routes. */
export function initRoutes(): void {
  const routes = [
    validatorListHashRoute,
    archiverListHashRoute,
    standbyListHashRoute,
    newestCycleHashRoute,
    validatorListRoute,
    archiverListRoute,
    standbyListRoute,
    cycleByMarkerRoute,
    newestCycleRecordRoute,
  ]

  for (const route of routes) {
    network._registerExternal(route.method, route.name, route.handler)
  }
}
