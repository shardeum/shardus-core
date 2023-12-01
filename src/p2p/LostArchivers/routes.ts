import { Handler } from 'express'
import { P2P } from "@shardus/types"
import { crypto } from '../Context'
import { getRandomAvailableArchiver } from "../Utils";
import { ArchiverDownTransaction, ArchiverInvestigateTransaction, ArchiverPingMessage, ArchiverUpTransaction } from "./txs"
import * as logging from './logging'


type Node = P2P.NodeListTypes.Node
type Route<T> = P2P.P2PTypes.Route<T>
type InternalHandler<P> = P2P.P2PTypes.InternalHandler<P>
type GossipHandler<P, S> = P2P.P2PTypes.GossipHandler<P, S>


const gossipNodeDownTxRoute: GossipHandler<ArchiverDownTransaction, Node['id']> = (payload, sender, tracker) => {
  // TODO
}


const gossipNodeUpTxRoute: GossipHandler<ArchiverUpTransaction, Node['id']> = (payload, sender, tracker) => {
  // TODO
}


const internalInvestigateTxRoute: Route<InternalHandler<ArchiverInvestigateTransaction>> = {
  method: 'GET',
  name: 'internal-investigate-tx',
  handler: (payload, response, sender) => {
    // TODO
    
    // We will be receiving Investigate messages here for us to investigate Archivers

    // Ignore hits here if we're not the designated Investigator for the given Archiver 
    // and cycle

    // Call the investigateArchiver function to continue with investigation
  },
}


const enableReportFakeLostArchiver = false // set this to `true` during testing, but never commit as `true`


// to-do: debug middleware?
const reportFakeLostArchiverRoute: P2P.P2PTypes.Route<Handler> = {
  method: 'GET',
  name: 'repot-fake-lost-archiver',
  handler: (_req, res) => {
    if (enableReportFakeLostArchiver) {
      logging.warn('/report-fake-lost-archiver: reporting fake lost archiver')
      res.json(crypto.sign({
        status: 'accepted',
        message: 'will report fake lost archiver'}))
      const arch = getRandomAvailableArchiver()
      if (arch) {
        // to-do: report it lost
      }
    }
  },
}


const internalPingRoute: Route<InternalHandler<ArchiverPingMessage>> = {
  method: 'GET',
  name: 'internal-ping',
  handler: (payload, response, sender) => {
    // TODO

    // to-do: The Lost (node) module already has a ping route, can we just reuse it, or do we have different requirements?
    //        Lost.ts line 100, const pingNodeRoute: P2P.P2PTypes.Route<P2P.P2PTypes.InternalHandler<SignedPingMessage>>
  },
}


export const routes = {
  external: [reportFakeLostArchiverRoute],
  internal: [internalInvestigateTxRoute, internalPingRoute],
  gossip: {
    'gossip-node-down-tx': gossipNodeDownTxRoute,
    'gossip-node-up-tx': gossipNodeUpTxRoute,
  },
}
