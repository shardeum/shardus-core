import { Handler } from 'express'
import { P2P } from '@shardus/types'
import { Node } from '@shardus/types/src/p2p/NodeListTypes'
import { GossipHandler, InternalHandler, Route, SignedObject } from '@shardus/types/src/p2p/P2PTypes'
import * as Comms from '../Comms'
import { crypto, network } from '../Context'
import { getRandomAvailableArchiver } from '../Utils'
import * as logging from './logging'
import { lostArchiversMap } from './state'
import { currentCycle, currentQuarter } from '../CycleCreator'
import * as Self from '../../p2p/Self'
import * as funcs from './functions'
import {
  ArchiverDownMsg,
  ArchiverUpMsg,
  InvestigateArchiverMsg,
} from '@shardus/types/src/p2p/LostArchiverTypes'


// to-do: make a setting?
const initialCyclesToWait = 3

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
  const target = upMsg.downTx.investigateTx.target
  // to-do: check target is a string or hexstring and min length
  const record = lostArchiversMap.get(target)
  if (!record) {
    // nothing to do
    logging.info(`lostArchiverUpGossip: no record for target ${target}. returning`)
    return
  }
  logging.info(`lostArchiverUpGossip: record: ${record}`)
  logging.info(`lostArchiverUpGossip: setting status to 'up' and gossiping`)
  record.status = 'up'
  // to-do: idea:
  // record.updated = {source: 'lostArchiverUpGossip', cycle: currentCycle, quarter: currentQuarter, what: 'up'}
  // or even:
  // record.updated.push({source: 'lostArchiverUpGossip', cycle: currentCycle, quarter: currentQuarter, what: 'up'})
  // ... is LostArchiverRecord in the cycle record? if not, we're good to add this debugging info
  Comms.sendGossip('lost-archiver-up', payload, tracker, sender, null, false) // isOrigin: false
}

const lostArchiverDownGossip: GossipHandler<SignedObject<ArchiverDownMsg>, Node['id']> = (
  payload,
  sender,
  tracker
) => {
  // the original gossip source is the investigator node that confirmed the archiver is down

  logging.info(`lostArchiverDownGossip: payload: ${payload}, sender: ${sender}, tracker: ${tracker}`)

  // check args
  if (!payload) throw new Error(`lostArchiverDownGossip: missing payload`)
  if (!sender) throw new Error(`lostArchiverDownGossip: missing sender`)
  if (!tracker) throw new Error(`lostArchiverDownGossip: missing tracker`)
  if (!hasProperties(payload, 'type investigateTx cycle'))
    throw new Error(`lostArchiverUpGossip: invalid payload: ${payload}`)
  const error = funcs.errorForArchiverDownMsg(payload)
  if (error) {
    logging.warn(`lostArchiverDownGossip: invalid payload error: ${error}, payload: ${payload}`)
    return
  }

  const downMsg = payload as SignedObject<ArchiverDownMsg>
  const target = downMsg.investigateTx.target
  // to-do: check target is a string or hexstring and min length
  let record = lostArchiversMap.get(target)
  if (!record) {
    record = {
      isInvestigator: false, // to-do: is this correct?
      gossipped: false,
      target,
      status: 'down',
      archiverDownMsg: downMsg,
      cyclesToWait: initialCyclesToWait,
    }
    lostArchiversMap.set(target, record)
  }
  Comms.sendGossip('lost-archiver-down', payload, tracker, sender, null, false) // isOrigin: false
  record.gossipped = true
  // to-do: idea: record the update
}

/** Internal */

const investigateLostArchiverRoute: Route<InternalHandler<SignedObject<InvestigateArchiverMsg>>> = {
  method: 'GET',
  name: 'internal-investigate-tx',
  handler: (payload, response, sender) => {
    // we're being told to investigate a seemingly lost archiver

    logging.info(`investigateLostArchiverRoute: payload: ${payload}, response: ${response}, sender: ${sender}`)

    // check args
    if (!payload) throw new Error(`lostArchiverDownGossip: missing payload`)
    if (!response) throw new Error(`lostArchiverDownGossip: missing response`)
    if (!sender) throw new Error(`lostArchiverDownGossip: missing sender`)
    if (!hasProperties(payload, 'type target investigator sender cycle'))
      throw new Error(`lostArchiverUpGossip: invalid payload: ${payload}`)
    if (payload.type !== 'investigate')
      throw new Error(`lostArchiverUpGossip: invalid payload type: ${payload.type}`)
    if (funcs.errorForInvestigateArchiverMsg(payload)) {
      logging.warn(`lostArchiverUpGossip: invalid payload: ${payload}`)
      return
    }

    if (crypto.getPublicKey() !== payload.investigator) {
      logging.info(`lostArchiverInvestigate: not the investigator. returning`)
      return
      // to-do: check cycle too?
      // original comment:
      // Ignore hits here if we're not the designated Investigator for the given Archiver and cycle
    }

    funcs.investigateArchiver(payload.target)

    // Call the investigateArchiver function to continue with investigation
    // investigator node investigates lost archiver
    // puts the lost archiver into its own lostArchiversMap
    // to-do: does the step below belong here? in that case the investigateArchiver() above will likely need a return value
    //        or is this done by the investigateArchiver() function?
    // if archiver is down
    //   schedules to gossip SignedArchiverDownMsg on downArchiver gossip route in next sendRequests()
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
    const upMsg = req.body as SignedObject<ArchiverUpMsg>
    const target = upMsg.downTx.investigateTx.target
    // to-do: check target is a string or hexstring and min length
    const record = lostArchiversMap.get(target)
    if (!record) {
      logging.info(`refuteLostArchiverRoute: no record for target ${target}. returning`)
      res.json({ status: 'failure', message: 'no record for target' })
      return
    }
    record.status = 'up'

    // to-do: not sure how to do the following based on the fields I see in LostArchiverRecord
    // update refuting archiver in their lostArchiversMap

    // gossip SignedArchiverUpMsg to other nodes on the upArchiverGossip route
    Comms.sendGossip('lost-archiver-up', upMsg, null, null, null, true) // isOrigin: true

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
  for (const route of routes.external)
    network._registerExternal(route.method, route.name, route.handler)
  for (const route of routes.internal)
    Comms.registerInternal(route.name, route.handler)
  for (const [name, handler] of Object.entries(routes.gossip))
    Comms.registerGossipHandler(name, handler)
}
