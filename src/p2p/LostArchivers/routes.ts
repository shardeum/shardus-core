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
import { ArchiverDownMsg, ArchiverUpMsg, InvestigateArchiverMsg } from '@shardus/types/src/p2p/LostArchiverTypes'
import { info } from 'console'


// to-do: make a setting?
const initialCyclesToWait = 3

/** Gossip */

const lostArchiverUpGossip: GossipHandler<SignedObject<ArchiverUpMsg>, Node['id']> = (
  payload,
  sender,
  tracker
) => {
  // the original gossip source is a node or nodes that the archiver notified as to the fact
  // that rumors of its death were highly exaggerated

  // check args
  if (!payload) throw new Error(`lostArchiverUpGossip: missing payload`)
  if (!sender) throw new Error(`lostArchiverUpGossip: missing sender`)
  if (!tracker) throw new Error(`lostArchiverUpGossip: missing tracker`)
  if (!('type' in payload && 'downTx' in payload && 'cycle' in payload))
    throw new Error(`lostArchiverUpGossip: invalid payload: ${payload}`)

  // to-do: need a guard on logging info() and others
  info(`lostArchiverUpGossip: payload: ${payload}, sender: ${sender}, tracker: ${tracker}`)
  const upMsg = payload as SignedObject<ArchiverUpMsg>
  const target = upMsg.downTx.investigateTx.target
  // to-do: check target is a string or hexstring and min length
  const record = lostArchiversMap.get(target)
  if (!record) {
    // nothing to do
    info(`lostArchiverUpGossip: no record for target ${target}. returning`)
    return
  }
  info(`lostArchiverUpGossip: record: ${record}`)
  info(`lostArchiverUpGossip: setting status to 'up' and gossiping`)
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

  // check args
  if (!payload) throw new Error(`lostArchiverDownGossip: missing payload`)
  if (!sender) throw new Error(`lostArchiverDownGossip: missing sender`)
  if (!tracker) throw new Error(`lostArchiverDownGossip: missing tracker`)
  if (!('type' in payload && 'investigate' in payload && 'cycle' in payload))
    throw new Error(`lostArchiverUpGossip: invalid payload: ${payload}`)
  
  info(`lostArchiverDownGossip: payload: ${payload}, sender: ${sender}, tracker: ${tracker}`)
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

const lostArchiverInvestigate: Route<InternalHandler<SignedObject<InvestigateArchiverMsg>>> = {
  method: 'GET',
  name: 'internal-investigate-tx',
  handler: (payload, response, sender) => {
    // TODO
    // We will be receiving Investigate messages here for us to investigate Archivers
    // Ignore hits here if we're not the designated Investigator for the given Archiver
    // and cycle
    // Call the investigateArchiver function to continue with investigation
    // investigator node investigates lost archiver
    // puts the lost archiver into its own lostArchiversMap
    // if archiver is down
    //   schedules to gossip SignedArchiverDownMsg on downArchiver gossip route in next sendRequests()
  },
}

/** External */

const lostArchiverRefute: P2P.P2PTypes.Route<Handler> = {
  method: 'POST',
  name: 'lost-archiver-refute',
  handler: (req, res) => {
    // node receives SignedArchiverUpMsg from refuting archiver
    // update refuting archiver in their lostArchiversMap
    // gossip SignedArchiverUpMsg to other nodes on the upArchiverGossip route

    res.json({ success: true })
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
  external: [lostArchiverRefute, reportFakeLostArchiverRoute],
  internal: [lostArchiverInvestigate],
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
