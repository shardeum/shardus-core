/** ROUTES */

import * as Comms from '../Comms'
import * as CycleChain from '../CycleChain'
import * as CycleCreator from '../CycleCreator'
import * as NodeList from '../NodeList'
import * as Self from '../Self'
import * as utils from '../../utils'
import { Handler } from "express"
import { P2P } from "@shardus/types"
import { addJoinRequest, computeSelectionNum, getAllowBogon, setAllowBogon, validateJoinRequest, verifyJoinRequestSignature, warn } from "."
import { config } from '../Context'
import { isBogonIP } from '../../utils/functions/checkIP'
import { isPortReachable } from '../../utils/isPortReachable'
import { nestedCountersInstance } from '../../utils/nestedCounters'
import { profilerInstance } from '../../utils/profiler'
import * as acceptance from './v2/acceptance'
import { attempt } from '../Utils'
import { getStandbyNodesInfoMap, saveJoinRequest } from './v2'
import { processNewUnjoinRequest, UnjoinRequest } from './v2/unjoin'

const cycleMarkerRoute: P2P.P2PTypes.Route<Handler> = {
  method: 'GET',
  name: 'cyclemarker',
  handler: (_req, res) => {
    const marker = CycleChain.newest ? CycleChain.newest.previous : '0'.repeat(64)
    res.json(marker)
  },
}

const joinRoute: P2P.P2PTypes.Route<Handler> = {
  method: 'POST',
  name: 'join',
  handler: async (req, res) => {
    const joinRequest = req.body
    if (CycleCreator.currentQuarter < 1) {
      // if currentQuarter <= 0 then we are not ready
      res.end()
      return
    }

    if (
      NodeList.activeByIdOrder.length === 1 &&
      Self.isFirst &&
      isBogonIP(joinRequest.nodeInfo.externalIp) &&
      config.p2p.forceBogonFilteringOn === false
    ) {
      setAllowBogon(true)
    }
    nestedCountersInstance.countEvent('p2p', `join-allow-bogon-firstnode:${getAllowBogon()}`)

    const externalIp = joinRequest.nodeInfo.externalIp
    const externalPort = joinRequest.nodeInfo.externalPort
    const internalIp = joinRequest.nodeInfo.internalIp
    const internalPort = joinRequest.nodeInfo.internalPort

    const externalPortReachable = await isPortReachable({ host: externalIp, port: externalPort })
    const internalPortReachable = await isPortReachable({ host: internalIp, port: internalPort })

    if (!externalPortReachable || !internalPortReachable) {
      return res.json({
        success: false,
        fatal: true,
        reason: `IP or Port is not reachable. ext:${externalIp}:${externalPort} int:${internalIp}:${internalPort}}`,
      })
    }

    // if the port of the join request was reachable, this join request is free to be
    // gossiped to all nodes according to Join Protocol v2.
    if (config.p2p.useJoinProtocolV2) {
      // ensure this join request doesn't already exist in standby nodes
      if (getStandbyNodesInfoMap().has(joinRequest.nodeInfo.publicKey)) {
        return res.status(400).json({
          success: false,
          fatal: true,
          reason: `Join request for pubkey ${joinRequest.nodeInfo.publicKey} already exists as a standby node`,
        })
      }

      // then validate the join request. if it's invalid for any reason, return
      // that reason.
      const validationError = validateJoinRequest(joinRequest)
      if (validationError) {
        return res.status(400).json(validationError)
      }

      // then, verify the signature of the join request. this has to be done
      // before selectionNum is calculated because we will mutate the original
      // join request.
      const signatureError = verifyJoinRequestSignature(joinRequest);
      if (signatureError) return signatureError;

      // then, calculate the selection number for this join request.
      const selectionNumResult = computeSelectionNum(joinRequest)
      if (selectionNumResult.isErr()) {
        console.error(`failed to compute selection number for node ${joinRequest.nodeInfo.publicKey}:`, JSON.stringify(selectionNumResult.error))
        return res.status(500).json(selectionNumResult.error)
      }
      joinRequest.selectionNum = selectionNumResult.value

      // add the join request to the global list of join requests. this will also
      // add it to the list of new join requests that will be processed as part of
      // cycle creation to create a standy node list.
      saveJoinRequest(joinRequest)

      // finally, gossip it to other nodes.
      Comms.sendGossip('gossip-valid-join-requests', joinRequest, '', null, NodeList.byIdOrder, true)

      // respond with the number of standby nodes for the user's information
      return res.status(200).send({ numStandbyNodes: getStandbyNodesInfoMap().size })
    } else {
      //  Validate of joinReq is done in addJoinRequest
      const joinRequestResponse = addJoinRequest(joinRequest)

      // if the join request was valid and accepted, gossip that this join request
      // was accepted to other nodes
      if (joinRequestResponse.success) {
        // only gossip join requests if we are still using the old join protocol
        Comms.sendGossip('gossip-join', joinRequest, '', null, NodeList.byIdOrder, true)
        nestedCountersInstance.countEvent('p2p', 'initiate gossip-join')
      }
      return res.json(joinRequestResponse)
    }
  },
}

const unjoinRoute: P2P.P2PTypes.Route<Handler> = {
  method: 'POST',
  name: 'unjoin',
  handler: (req, res) => {
    const joinRequest = req.body
    const processResult = processNewUnjoinRequest(joinRequest)
    if (processResult.isErr()) {
      return res.status(500).send(processResult.error)
    }

    Comms.sendGossip('gossip-unjoin', joinRequest, '', null, NodeList.byIdOrder, true)
  }
}

const joinedRoute: P2P.P2PTypes.Route<Handler> = {
  method: 'GET',
  name: 'joined/:publicKey',
  handler: (req, res) => {
    // Respond with id if node's join request was accepted, otherwise undefined
    let err = utils.validateTypes(req, { params: 'o' })
    if (err) {
      warn('joined/:publicKey bad req ' + err)
      res.json()
    }
    err = utils.validateTypes(req.params, { publicKey: 's' })
    if (err) {
      warn('joined/:publicKey bad req.params ' + err)
      res.json()
    }
    const publicKey = req.params.publicKey
    const node = NodeList.byPubKey.get(publicKey)
    res.json({ node })
  },
}

const acceptedRoute: P2P.P2PTypes.Route<Handler> = {
  method: 'POST',
  name: 'accepted',
  handler: async (req, res) => {
    try {
      await attempt(async () => {
        const result = await acceptance.confirmAcceptance(req.body)
        if (result.isErr()) {
          throw result.error
        } else if (!result.value) {
          throw new Error(`this node was not found in cycle ${req.body.cycleMarker}; assuming not accepted`)
        } else {
          acceptance.getEventEmitter().emit('accepted')
        }
      }, {
        maxRetries: 5,
        delay: 2000,
      })
    } catch (err) {
      res.status(400).send(err)
    }
  },
}

const gossipJoinRoute: P2P.P2PTypes.GossipHandler<P2P.JoinTypes.JoinRequest, P2P.NodeListTypes.Node['id']> = (
  payload,
  sender,
  tracker
) => {
  // only gossip join requests if we are still using the old join protocol
  if (!config.p2p.useJoinProtocolV2) {
    profilerInstance.scopedProfileSectionStart('gossip-join')
    try {
      // Do not forward gossip after quarter 2
      if (CycleCreator.currentQuarter >= 3) return

      //  Validate of payload is done in addJoinRequest
      if (addJoinRequest(payload).success)
        Comms.sendGossip('gossip-join', payload, tracker, sender, NodeList.byIdOrder, false)
    } finally {
      profilerInstance.scopedProfileSectionEnd('gossip-join')
    }
  } else warn('gossip-join received but ignored for join protocol v2')
}

/**
  * Part of Join Protocol v2. Gossips all valid join requests.
  */
const gossipValidJoinRequests: P2P.P2PTypes.GossipHandler<P2P.JoinTypes.JoinRequest, P2P.NodeListTypes.Node['id']> = (
  payload: P2P.JoinTypes.JoinRequest,
  sender: P2P.NodeListTypes.Node['id'],
  tracker: string,
) => {
  // ensure this join request doesn't already exist in standby nodes
  if (getStandbyNodesInfoMap().has(payload.nodeInfo.publicKey)) {
    console.error(`join request for pubkey ${payload.nodeInfo.publicKey} already exists as a standby node`)
    return
  }

  // validate the join request first
  const validationError = validateJoinRequest(payload)
  if (validationError) {
    console.error(`failed to validate join request when gossiping: ${validationError}`)
    return
  }

  // then, calculate the selection number for this join request
  const selectionNumResult = computeSelectionNum(payload)
  if (selectionNumResult.isErr()) {
    console.error(`failed to compute selection number for node ${payload.nodeInfo.publicKey}:`, JSON.stringify(selectionNumResult.error))
    return
  }
  payload.selectionNum = selectionNumResult.value

  // add the join request to the global list of join requests. this will also
  // add it to the list of new join requests that will be processed as part of
  // cycle creation to create a standy node list.
  saveJoinRequest(payload)

  // do not forward gossip after quarter 2
  if (CycleCreator.currentQuarter > 2) return
  else Comms.sendGossip('gossip-valid-join-requests', payload, tracker, sender, NodeList.byIdOrder, false)
}

const gossipUnjoinRequests: P2P.P2PTypes.GossipHandler<UnjoinRequest, P2P.NodeListTypes.Node['id']> = (
  payload: UnjoinRequest,
  sender: P2P.NodeListTypes.Node['id'],
  tracker: string,
) => {
  const processResult = processNewUnjoinRequest(payload)
  if (processResult.isErr()) {
    warn(`gossip-unjoin failed to process unjoin request: ${processResult.error}`)
    return
  }

  Comms.sendGossip('gossip-unjoin', payload, tracker, sender, NodeList.byIdOrder, false)
}

export const routes = {
  external: [cycleMarkerRoute, joinRoute, joinedRoute, acceptedRoute, unjoinRoute],
  gossip: {
    'gossip-join': gossipJoinRoute,
    'gossip-valid-join-requests': gossipValidJoinRequests,
    'gossip-unjoin': gossipUnjoinRequests,
  },
}

