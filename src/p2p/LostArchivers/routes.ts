import { P2P } from '@shardus/types'
import {
  ArchiverDownMsg,
  ArchiverRefutesLostMsg,
  ArchiverUpMsg,
  InvestigateArchiverMsg,
} from '@shardus/types/build/src/p2p/LostArchiverTypes'
import { Node } from '@shardus/types/build/src/p2p/NodeListTypes'
import { GossipHandler, InternalHandler, Route, SignedObject } from '@shardus/types/build/src/p2p/P2PTypes'
import { Handler } from 'express'
import * as Comms from '../Comms'
import { crypto, network } from '../Context'
import { getRandomAvailableArchiver } from '../Utils'
import * as funcs from './functions'
import * as logging from './logging'
import { lostArchiversMap } from './state'
import { currentQuarter } from '../CycleCreator'
import { id } from '../Self'
import { inspect } from 'util'
import { byIdOrder } from '../NodeList'

/**
 * Returns true if the given object is not nullish and has all the given keys.
 * Used for checking arguments.
 */
function hasProperties(obj: object, keys: string | string[]): boolean {
  if (obj == null) return false
  if (typeof keys === 'string') keys = keys.split(/\s+/)
  for (const key of keys) {
    if (!(key in obj)) return false
  }
  return true
}

/** Gossip */

const lostArchiverUpGossip: GossipHandler<SignedObject<ArchiverUpMsg>, Node['id']> = (
  payload,
  sender,
  tracker
) => {
  // the original gossip source is a node or nodes that the archiver notified as to the fact
  // that rumors of its death were highly exaggerated

  // Ignore gossip outside of Q1 and Q2
  if (![1, 2].includes(currentQuarter)) {
    logging.warn('lostArchiverUpGossip: not in Q1 or Q2')
  }

  // to-do: need a guard on logging logging.info() and others?
  logging.info(`lostArchiverUpGossip: payload: ${payload}, sender: ${sender}, tracker: ${tracker}`)

  // check args
  if (!payload) throw new Error(`lostArchiverUpGossip: missing payload`)
  if (!sender) throw new Error(`lostArchiverUpGossip: missing sender`)
  if (!tracker) throw new Error(`lostArchiverUpGossip: missing tracker`)
  if (!hasProperties(payload, 'type downTx cycle'))
    throw new Error(`lostArchiverUpGossip: invalid payload: ${payload}`)
  const error = funcs.errorForArchiverUpMsg(payload)
  if (error) {
    logging.warn(`lostArchiverUpGossip: invalid payload error: ${error}, payload: ${payload}`)
    return
  }

  const upMsg = payload as SignedObject<ArchiverUpMsg>
  const target = upMsg.downMsg.investigateMsg.target
  // to-do: check target is a string or hexstring and min length
  const record = lostArchiversMap.get(target)
  if (!record) {
    // nothing to do
    logging.info(`lostArchiverUpGossip: no record for target ${target}. returning`)
    return
  }
  logging.info(`lostArchiverUpGossip: record: ${record}`)

  // Return if we have already processed this message
  if (record && ['up'].includes(record.status)) return

  logging.info(`lostArchiverUpGossip: setting status to 'up' and gossiping`)
  record.status = 'up'
  record.archiverUpMsg = upMsg
  // to-do: idea:
  // record.updated = {source: 'lostArchiverUpGossip', cycle: currentCycle, quarter: currentQuarter, what: 'up'}
  // or even:
  // record.updated.push({source: 'lostArchiverUpGossip', cycle: currentCycle, quarter: currentQuarter, what: 'up'})
  // ... is LostArchiverRecord in the cycle record? if not, we're good to add this debugging info
  Comms.sendGossip('lost-archiver-up', payload, tracker, id, byIdOrder, false) // isOrigin: false
}

const lostArchiverDownGossip: GossipHandler<SignedObject<ArchiverDownMsg>, Node['id']> = (
  payload,
  sender,
  tracker
) => {
  // the original gossip source is the investigator node that confirmed the archiver is down

  // Ignore gossip outside of Q1 and Q2
  if (![1, 2].includes(currentQuarter)) {
    logging.warn('lostArchiverUpGossip: not in Q1 or Q2')
  }

  logging.info(`lostArchiverDownGossip: payload: ${inspect(payload)}, sender: ${sender}, tracker: ${tracker}`)

  // check args
  if (!payload) throw new Error(`lostArchiverDownGossip: missing payload`)
  if (!sender) throw new Error(`lostArchiverDownGossip: missing sender`)
  if (!tracker) throw new Error(`lostArchiverDownGossip: missing tracker`)
  if (!hasProperties(payload, 'type investigateMsg cycle'))
    throw new Error(`lostArchiverDownGossip: invalid payload: ${inspect(payload)}`)
  const error = funcs.errorForArchiverDownMsg(payload)
  if (error) {
    logging.warn(`lostArchiverDownGossip: invalid payload error: ${error}, payload: ${inspect(payload)}`)
    return
  }

  const downMsg = payload as SignedObject<ArchiverDownMsg>
  const target = downMsg.investigateMsg.target
  // to-do: check target is a string or hexstring and min length
  let record = lostArchiversMap.get(target)
  // Return if we have already processed this message
  if (record && ['up', 'down'].includes(record.status)) return
  // If we dont have an entry in lostArchiversMap, make one
  if (!record) {
    record = funcs.createLostArchiverRecord({
      target,
      status: 'down',
      archiverDownMsg: downMsg
    })
    lostArchiversMap.set(target, record)
  }
  // Otherwise, set status to 'down' and save the downMsg
  else {
    record.status = 'down'
    record.archiverDownMsg = downMsg
  }
  Comms.sendGossip('lost-archiver-down', payload, tracker, id, byIdOrder, false) // isOrigin: false
  record.gossippedDownMsg = true
  // to-do: idea: record the update
}

/** Internal */

const investigateLostArchiverRoute: Route<InternalHandler<SignedObject<InvestigateArchiverMsg>>> = {
  method: 'GET',
  name: 'lost-archiver-investigate',
  handler: (payload, response, sender) => {
    // we're being told to investigate a seemingly lost archiver

    logging.info(
      `investigateLostArchiverRoute: payload: ${payload}, sender: ${sender}`
    )

    // check args
    if (!payload) throw new Error(`investigateLostArchiverRoute: missing payload`)
    if (!response) throw new Error(`investigateLostArchiverRoute: missing response`)
    if (!sender) throw new Error(`investigateLostArchiverRoute: missing sender`)
    if (!hasProperties(payload, 'type target investigator sender cycle'))
      throw new Error(`investigateLostArchiverRoute: invalid payload: ${payload}`)
    if (payload.type !== 'investigate')
      throw new Error(`investigateLostArchiverRoute: invalid payload type: ${payload.type}`)
    if (funcs.errorForInvestigateArchiverMsg(payload)) {
      logging.warn(`investigateLostArchiverRoute: invalid payload: ${payload}`)
      return
    }

    if (id !== payload.investigator) {
      logging.info(`investigateLostArchiverRoute: not the investigator. returning`)
      return
      // to-do: check cycle too?
      // original comment:
      // Ignore hits here if we're not the designated Investigator for the given Archiver and cycle
    }

    funcs.investigateArchiver(payload)
  },
}

/** External */

const refuteLostArchiverRoute: P2P.P2PTypes.Route<Handler> = {
  method: 'POST',
  name: 'lost-archiver-refute',
  handler: (req, res) => {
    // to-do: verify that validateArchiverUpMsg checks the signature or that whatever machinery invokes this route does; or do it ourselves
    // called by a refuting archiver
    const error = funcs.errorForArchiverUpMsg(req.body)
    if (error) {
      logging.warn(
        `refuteLostArchiverRoute: invalid archiver up message error: ${error}, payload: ${req.body}`
      )
      res.json({ status: 'failure', message: error })
      return
    }
    const refuteMsg = req.body as SignedObject<ArchiverRefutesLostMsg>
    const target = refuteMsg.archiver
    // to-do: check target is a string or hexstring and min length
    let record = lostArchiversMap.get(target)
    if (!record) {
      record = funcs.createLostArchiverRecord({target, status: 'up', archiverRefuteMsg: refuteMsg})
      lostArchiversMap.set(target, record)
    }
    if (record.status !== 'up') record.status = 'up'
    if (!record.archiverRefuteMsg) record.archiverRefuteMsg = refuteMsg
    res.json({ status: 'success' })
  },
}

const enableReportFakeLostArchiver = false // set this to `true` during testing, but never commit as `true`

// to-do: debug middleware?
const reportFakeLostArchiverRoute: P2P.P2PTypes.Route<Handler> = {
  method: 'GET',
  name: 'report-fake-lost-archiver',
  handler: (_req, res) => {
    if (enableReportFakeLostArchiver) {
      logging.warn('/report-fake-lost-archiver: reporting fake lost archiver')
      res.json(
        crypto.sign({
          status: 'accepted',
          message: 'will report fake lost archiver',
        })
      )
      const arch = getRandomAvailableArchiver()
      if (arch) {
        // to-do: report it lost
      }
    }
  },
}

const routes = {
  external: [refuteLostArchiverRoute, reportFakeLostArchiverRoute],
  internal: [investigateLostArchiverRoute],
  gossip: {
    'lost-archiver-up': lostArchiverUpGossip,
    'lost-archiver-down': lostArchiverDownGossip,
  },
}

export function registerRoutes(): void {
  for (const route of routes.external) {
    network._registerExternal(route.method, route.name, route.handler)
  }
  for (const route of routes.internal) {
    Comms.registerInternal(route.name, route.handler)
  }
  for (const [name, handler] of Object.entries(routes.gossip)) {
    Comms.registerGossipHandler(name, handler)
  }
}
