import { P2P } from "@shardus/types"
import { ArchiverDownTranaction, ArchiverInvestigateTransaction, ArchiverPingMessage, ArchiverUpTransaction } from "./txs"

type Node = P2P.NodeListTypes.Node
type Route<T> = P2P.P2PTypes.Route<T>
type InternalHandler<P> = P2P.P2PTypes.InternalHandler<P>
type GossipHandler<P, S> = P2P.P2PTypes.GossipHandler<P, S>

const gossipNodeDownTxRoute: GossipHandler<ArchiverDownTranaction, Node['id']> = (payload, sender, tracker) => {
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

const internalPingRoute: Route<InternalHandler<ArchiverPingMessage>> = {
  method: 'GET',
  name: 'internal-ping',
  handler: (payload, response, sender) => {
    // TODO
  },
}

export const routes = {
  internal: [internalInvestigateTxRoute, internalPingRoute],
  gossip: {
    'gossip-node-down-tx': gossipNodeDownTxRoute,
    'gossip-node-up-tx': gossipNodeUpTxRoute,
  },
}
