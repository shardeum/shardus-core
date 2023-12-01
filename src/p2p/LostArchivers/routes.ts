import { P2P } from '@shardus/types'
import { Node } from '@shardus/types/build/src/p2p/NodeListTypes'
import { GossipHandler, InternalHandler, Route, SignedObject } from '@shardus/types/build/src/p2p/P2PTypes'
import { Handler } from 'express'
import * as Comms from '../Comms'
import { crypto, network } from '../Context'
import { getRandomAvailableArchiver } from '../Utils'
import * as logging from './logging'
import { ArchiverDownMsg, ArchiverUpMsg, InvestigateArchiverMsg } from '@shardus/types/build/src/p2p/LostArchiverTypes'

/** Gossip */

const lostArchiverUpGossip: GossipHandler<SignedObject<ArchiverUpMsg>, Node['id']> = (payload, sender, tracker) => {
  // nodes receive ArchiverUpMsg from gossiping nodes
  // if target archiver not in lostArchiverMap, return
  // update target archiver in their lostArchiversMap
  //   set status = 'up'
  // gossip ArchiverUpMsg to other nodes
}

const lostArchiverDownGossip: GossipHandler<SignedObject<ArchiverDownMsg>, Node['id']> = (
  payload,
  sender,
  tracker
) => {
  // nodes receive ArchiverDownMsg gossip from investigator
  // add lost archiver to their own lostArchiversMap if not already there
  //   set status = 'down'
  //   set gossipped = false
  // gossip ArchiverDownMsg to other nodes
  //   set gossipped = true
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
