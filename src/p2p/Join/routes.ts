/** ROUTES */

import * as Comms from '../Comms'
import * as CycleChain from '../CycleChain'
import * as CycleCreator from '../CycleCreator'
import * as NodeList from '../NodeList'
import * as Self from '../Self'
import * as utils from '../../utils'
import { Handler } from 'express'
import { P2P } from '@shardus/types'
import {
  addJoinRequest,
  computeSelectionNum,
  getAllowBogon,
  setAllowBogon,
  validateJoinRequest,
  verifyJoinRequestSignature,
  warn,
  queueStandbyRefreshRequest
} from '.'
import { config } from '../Context'
import { isBogonIP } from '../../utils/functions/checkIP'
import { isPortReachable } from '../../utils/isPortReachable'
import { nestedCountersInstance } from '../../utils/nestedCounters'
import { profilerInstance } from '../../utils/profiler'
import * as acceptance from './v2/acceptance'
import { attempt } from '../Utils'
import { getStandbyNodesInfoMap, saveJoinRequest, isOnStandbyList } from './v2'
import { addFinishedSyncing } from './v2/syncFinished'
import { processNewUnjoinRequest, UnjoinRequest } from './v2/unjoin'
import { isActive } from '../Self'
import { logFlags } from '../../logger'
import { StartedSyncingRequest } from '@shardus/types/build/src/p2p/JoinTypes'
import { addSyncStarted } from './v2/syncStarted'
import { addStandbyRefresh } from './v2/standbyRefresh'
import { safeStringify } from '../../utils'
import { testFailChance } from '../../utils'

const cycleMarkerRoute: P2P.P2PTypes.Route<Handler> = {
  method: 'GET',
  name: 'cyclemarker',
  handler: (_req, res) => {
    const marker = CycleChain.newest ? CycleChain.newest.previous : '0'.repeat(64)
    res.send(safeStringify(marker))
  },
}

/*
Currently not used

const cycleNumberRoute: P2P.P2PTypes.Route<Handler> = {
  method: 'GET',
  name: 'cyclenumber',
  handler: (_req, res) => {
    const number = CycleChain.newest ? CycleChain.newest.counter : 0
    res.json(number)
  },
}
*/

const joinRoute: P2P.P2PTypes.Route<Handler> = {
  method: 'POST',
  name: 'join',
  handler: async (req, res) => {
    const joinRequest = req.body

    if (!isActive && !Self.isRestartNetwork) {
      /* prettier-ignore */ nestedCountersInstance.countEvent('p2p', `join-reject: not-active`)
      /* prettier-ignore */ if (logFlags.p2pNonFatal) console.error( `join-reject: not-active`)
      // if we are not active yet, we cannot accept join requests
      return res.status(400).json({
        success: false,
        fatal: false,
        reason: `this node is not active yet`,
      })
    }

    if (CycleCreator.currentQuarter < 1) {
      /* prettier-ignore */ nestedCountersInstance.countEvent('p2p', `join-reject: CycleCreator.currentQuarter < 1 ${CycleCreator.currentQuarter}`)
      /* prettier-ignore */ if (logFlags.p2pNonFatal) console.error( `join-reject: CycleCreator.currentQuarter < 1 ${CycleCreator.currentQuarter} ${joinRequest.nodeInfo.publicKey}`)
      // if currentQuarter <= 0 then we are not ready
      return res.status(400).json({
        success: false,
        fatal: false,
        reason: `Can't join before quarter 1`,
      })
    }

    if (
      (NodeList.activeByIdOrder.length === 1 || Self.isRestartNetwork) &&
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
      /* prettier-ignore */ nestedCountersInstance.countEvent( 'p2p', `join-reject: !externalPortReachable || !internalPortReachable` )
      /* prettier-ignore */ if (logFlags.p2pNonFatal) console.error( `join-reject: !externalPortReachable || !internalPortReachable ${joinRequest.nodeInfo.publicKey} ${JSON.stringify({ host: externalIp, port: externalPort })}`)
      return res.send(safeStringify({
        success: false,
        fatal: true,
        //the following message string is used by submitJoinV2.  if you change the string please update submitJoinV2
        reason: `IP or Port is not reachable. ext:${externalIp}:${externalPort} int:${internalIp}:${internalPort}}`,
      }))
    }

    // if the port of the join request was reachable, this join request is free to be
    // gossiped to all nodes according to Join Protocol v2.
    if (config.p2p.useJoinProtocolV2) {
      // ensure this join request doesn't already exist in standby nodes
      if (getStandbyNodesInfoMap().has(joinRequest.nodeInfo.publicKey)) {
        /* prettier-ignore */ nestedCountersInstance.countEvent('p2p', `join-reject: already standby`)
        /* prettier-ignore */ if (logFlags.p2pNonFatal) console.error( `join-reject: already standby ${joinRequest.nodeInfo.publicKey}:`)
        return res.status(400).json({
          success: false,
          fatal: false, //this was true before which seems wrong.  Do we want to kill a node that already got in?
          reason: `Join request for pubkey ${joinRequest.nodeInfo.publicKey} already exists as a standby node`,
        })
      }

      // then validate the join request. if it's invalid for any reason, return
      // that reason.
      const validationError = validateJoinRequest(joinRequest)
      if (validationError) {
        /* prettier-ignore */ nestedCountersInstance.countEvent('p2p', `join-reject: validateJoinRequest ${validationError.reason}`)
        /* prettier-ignore */ if (logFlags.p2pNonFatal) console.error( `join-reject: validateJoinRequest ${validationError.reason} ${joinRequest.nodeInfo.publicKey}:`)
        return res.status(400).json(validationError)
      }
      // then, verify the signature of the join request. this has to be done
      // before selectionNum is calculated because we will mutate the original
      // join request.
      const signatureError = verifyJoinRequestSignature(joinRequest)
      if (signatureError) {
        /* prettier-ignore */ nestedCountersInstance.countEvent('p2p', `join-reject: signature error`)
        /* prettier-ignore */ if (logFlags.p2pNonFatal) console.error( `join-reject: signature error ${joinRequest.nodeInfo.publicKey}:`)
        return res.status(400).json(signatureError)
      }

      // then, calculate the selection number for this join request.
      const selectionNumResult = computeSelectionNum(joinRequest)
      if (selectionNumResult.isErr()) {
        /* prettier-ignore */ nestedCountersInstance.countEvent('p2p', `join-reject: failed selection number ${selectionNumResult.error.reason}`)
        /* prettier-ignore */ if (logFlags.p2pNonFatal) console.error( `failed to compute selection number for node ${joinRequest.nodeInfo.publicKey}:`, JSON.stringify(selectionNumResult.error) )
        return res.status(500).json(selectionNumResult.error)
      }
      joinRequest.selectionNum = selectionNumResult.value

      if (CycleCreator.currentQuarter > 1) {
        /* prettier-ignore */ nestedCountersInstance.countEvent('p2p', `rejected-late-join-request ${CycleCreator.currentQuarter}`)
        return res.status(400).json({
          success: false,
          fatal: false,
          reason: `Can't join after quarter 1`,
        })
      }

      // add the join request to the global list of join requests. this will also
      // add it to the list of new join requests that will be processed as part of
      // cycle creation to create a standy node list.
      saveJoinRequest(joinRequest)

      // finally, gossip it to other nodes.
      Comms.sendGossip('gossip-valid-join-requests', joinRequest, '', null, NodeList.byIdOrder, true)

      /* prettier-ignore */ nestedCountersInstance.countEvent( 'p2p', `join success` )
      // respond with the number of standby nodes for the user's information
      return res.status(200).send({ success: true, numStandbyNodes: getStandbyNodesInfoMap().size })
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
      return res.send(safeStringify(joinRequestResponse))
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
  },
}

/*
Currently not used

const syncStartedRoute: P2P.P2PTypes.Route<Handler> = {
  method: 'POST',
  name: 'sync-started',
  handler: (req, res) => {
    const syncStarted = req.body
    const processResult = addSyncStarted(syncStarted)
    if (processResult.success === false) {
      return res.status(500).send(processResult.reason)
    }
    Comms.sendGossip('gossip-sync-started', syncStarted, '', null, NodeList.byIdOrder, true)
    return res.status(200).send()
  },
}
*/
const standbyRefreshRoute: P2P.P2PTypes.Route<Handler> = {
  method: 'POST',
  name: 'standby-refresh',
  handler: async (req, res) => {

    // check if the config.debug.ignoreStandbyRefreshChance is a probability
    if (config.debug.ignoreStandbyRefreshChance < 0 || config.debug.ignoreStandbyRefreshChance > 1) {
      warn('invalid config.debug.ignoreStandbyRefreshChance value: ' + config.debug.ignoreStandbyRefreshChance)
      res.status(500).send('invalid config.debug.ignoreStandbyRefreshChance value')
    // check if we should ignore this request for testing purposes
    } else if (config.debug.ignoreStandbyRefreshChance > 0) {
      // if we should ignore this request, sleep for 1.1 seconds since timeout is 1 second
      if (testFailChance(config.debug.ignoreStandbyRefreshChance, 'standby-refresh', '', '', false)) {
        await utils.sleep(3000)
        res.status(500).send('simulated timeout')
      }
    }

    const standbyRefreshPubKey = req.body.publicKey

    let err = utils.validateTypes(req, { body: 'o' })
    if (err) {
      warn('/standby-refresh bad req ' + err)
      res.status(400).send()
    }
    err = typeof standbyRefreshPubKey === 'string' ? '' : 'standbyRefreshPubKey is not a string'
    if (err) {
      warn('/standby-refresh bad standby refresh public key ' + err)
      res.status(400).send()
    }

    queueStandbyRefreshRequest(standbyRefreshPubKey)
    return res.status(200).send()
  },
}

const joinedV2Route: P2P.P2PTypes.Route<Handler> = {
  method: 'GET',
  name: 'joinedV2/:publicKey',
  handler: (req, res) => {
    // Respond with id if node's join request was accepted, otherwise undefined
    let err = utils.validateTypes(req, { params: 'o' })
    if (err) {
      warn('joined/:publicKey bad req ' + err)
      // use res.send(safeStringify({ })) if returning an object
      res.json()
    }
    err = utils.validateTypes(req.params, { publicKey: 's' })
    if (err) {
      warn('joined/:publicKey bad req.params ' + err)
      // use res.send(safeStringify({ })) if returning an object
      res.json()
    }
    const publicKey = req.params.publicKey
    const id = NodeList.byPubKey.get(publicKey)?.id || null
    res.send(safeStringify({ id, isOnStandbyList: isOnStandbyList(publicKey) }))
  },
}

const joinedRoute: P2P.P2PTypes.Route<Handler> = {
  method: 'GET',
  name: 'joined/:publicKey',
  handler: (req, res) => {
    // Respond with id if node's join request was accepted, otherwise undefined
    let err = utils.validateTypes(req, { params: 'o' })
    if (err) {
      warn('joined/:publicKey bad req ' + err)
      // use res.send(safeStringify({ })) if returning an object
      res.json()
    }
    err = utils.validateTypes(req.params, { publicKey: 's' })
    if (err) {
      warn('joined/:publicKey bad req.params ' + err)
      // use res.send(safeStringify({ })) if returning an object
      res.json()
    }
    const publicKey = req.params.publicKey
    const node = NodeList.byPubKey.get(publicKey)
    res.send(safeStringify({ node }))
  },
}

/**
 * todo deprecate this or, finish it
 * for now deprecating the accepted path.  does not seem to have any value
 */
const acceptedRoute: P2P.P2PTypes.Route<Handler> = {
  method: 'POST',
  name: 'accepted',
  handler: async (req, res) => {
    // Turns out the cycle check is unnecessary because the joining node will robust query for its node ID
    // The joinNetwork fn in startupV2 will handle acceptance
    acceptance.getEventEmitter().emit('accepted')

    /*
    const counter = CycleChain.getNewest().counter
    nestedCountersInstance.countEvent('joinV2', `C${counter}: acceptedRoute: start`)

    // check if we even need to check acceptance
    if (acceptance.getHasConfirmedAcceptance() || Self.isActive) {
      return res.status(400).send('no need to check acceptance; this node has already confirmed acceptance')
    } else if (acceptance.isAlreadyCheckingAcceptance()) {
      return res.status(400).send('node is already checking acceptance')
    }

    // then try to confirm acceptance if needed
    try {
      await attempt(
        async () => {
          const result = await acceptance.confirmAcceptance(req.body)

          if (result.isErr()) {
            // transform Err into a thrown Error if needed
            nestedCountersInstance.countEvent('joinV2', `C${counter}: acceptedRoute: confirmAcceptance error`)
            throw result.error
          } else if (!result.value) {
            // if the result is false, acceptance is not confirmed
            nestedCountersInstance.countEvent('joinV2', `C${counter}: acceptedRoute: node not in cycle`)
            throw new Error(`this node was not found in cycle ${req.body.cycleMarker}; assuming not accepted`)
          } else {
            // otherwise, at this point, the node has been confirmed to be accepted
            nestedCountersInstance.countEvent('joinV2', `C${counter}: acceptedRoute: node accepted`)
            acceptance.getEventEmitter().emit('accepted')
          }
        },
        {
          maxRetries: 5,
          delay: 2000,
        }
      )
    } catch (err) {
      nestedCountersInstance.countEvent('joinV2', `C${counter}: acceptedRoute: attempt error`)
      res.status(400).send(err)
    }
    */
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
      // Ignore gossip outside of Q1 and Q2
      if (![1, 2].includes(CycleCreator.currentQuarter)) {
        /* prettier-ignore */ if (logFlags.error) warn('gossip-join-reject: not in Q1 or Q2')
        return
      }
      if (!payload) {
        /* prettier-ignore */ if (logFlags.error) warn('gossip-join-reject: missing payload')
        return
      }

      // Assuming validateTypes is a utility function that checks the structure and types of an object
      let err = utils.validateTypes(payload, {
        nodeInfo: 'o',
        selectionNum: 's',
        cycleMarker: 's',
        proofOfWork: 's',
        version: 's',
        sign: 'o',
        appJoinData: '?',
      })

      if (err) {
        /* prettier-ignore */ if (logFlags.error) warn(`gossip-join-reject: bad input ${err}`)
        return
      }

      // Further validation for the 'sign' object structure if needed
      err = utils.validateTypes(payload.sign, {
        owner: 's',
        sig: 's',
      })

      if (err) {
        /* prettier-ignore */ if (logFlags.error) warn(`gossip-join-reject: bad input sign ${err}`)
        return
      }
      const signer = NodeList.byPubKey.get(payload.sign.owner)
      if (!signer) {
        /* prettier-ignore */ if (logFlags.error) warn('gossip-join: Got join request from unknown node')
      }

      const isOrig = signer.id === sender

      // Only accept original txs in quarter 1
      if (isOrig && CycleCreator.currentQuarter > 1) {
        /* prettier-ignore */ nestedCountersInstance.countEvent('p2p', `gossip-join-reject: CycleCreator.currentQuarter > 1 ${CycleCreator.currentQuarter}`)
        return
      }

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
const gossipValidJoinRequests: P2P.P2PTypes.GossipHandler<
  P2P.JoinTypes.JoinRequest,
  P2P.NodeListTypes.Node['id']
> = (payload: P2P.JoinTypes.JoinRequest, sender: P2P.NodeListTypes.Node['id'], tracker: string) => {
  // Ignore gossip outside of Q1 and Q2
  if (![1, 2].includes(CycleCreator.currentQuarter)) {
    /* prettier-ignore */ if (logFlags.error) warn('join-gossip-reject: not in Q1 or Q2')
    return
  }
  if (!payload) {
    /* prettier-ignore */ if (logFlags.error) warn('join-gossip-reject: missing payload')
    return
  }

  // Validate payload structure and types
  let err = utils.validateTypes(payload, {
    nodeInfo: 'o',
    selectionNum: 's',
    cycleMarker: 's',
    proofOfWork: 's',
    version: 's',
    sign: 'o',
    appJoinData: '?',
  })

  if (err) {
    /* prettier-ignore */ if (logFlags.error) warn(`join-gossip-reject: bad input ${err}`)
    return
  }

  // Further validation for the 'sign' object structure
  err = utils.validateTypes(payload.sign, {
    owner: 's',
    sig: 's',
  })

  if (err) {
    /* prettier-ignore */ if (logFlags.error) warn(`join-gossip-reject: bad input sign ${err}`)
    return
  }

  const signer = NodeList.byPubKey.get(payload.sign.owner)
  if (!signer) {
    /* prettier-ignore */ if (logFlags.error) warn('join-gossip: Got join request from unknown node')
  }

  const isOrig = signer.id === sender

  // Only accept original txs in quarter 1
  if (isOrig && CycleCreator.currentQuarter > 1) {
    /* prettier-ignore */ nestedCountersInstance.countEvent('p2p', `join-gossip-reject: CycleCreator.currentQuarter > 1 ${CycleCreator.currentQuarter}`)
    return
  }

  // Do not forward gossip after quarter 2
  if (!isOrig && CycleCreator.currentQuarter > 2) {
    /* prettier-ignore */ nestedCountersInstance.countEvent('p2p', `join-gossip-reject: CycleCreator.currentQuarter > 2 ${CycleCreator.currentQuarter}`)
    return
  }

  // ensure this join request doesn't already exist in standby nodes
  if (getStandbyNodesInfoMap().has(payload.nodeInfo.publicKey)) {
    /* prettier-ignore */ nestedCountersInstance.countEvent( 'p2p', `join-gossip-reject: node already standby` )
    /* prettier-ignore */ if (logFlags.p2pNonFatal) console.error(`join request for pubkey ${payload.nodeInfo.publicKey} already exists as a standby node`)
    return
  }

  // validate the join request first
  const validationError = validateJoinRequest(payload)
  if (validationError) {
    /* prettier-ignore */ nestedCountersInstance.countEvent( 'p2p', `join-gossip-reject: failed to validate join request` )
    /* prettier-ignore */ if (logFlags.p2pNonFatal)console.error(`failed to validate join request when gossiping: ${validationError}`)
    return
  }

  // then, calculate the selection number for this join request
  const selectionNumResult = computeSelectionNum(payload)
  if (selectionNumResult.isErr()) {
    /* prettier-ignore */ nestedCountersInstance.countEvent( 'p2p', `join-gossip-reject:  node already standby` )
    /* prettier-ignore */ if (logFlags.p2pNonFatal)console.error( `failed to compute selection number for node ${payload.nodeInfo.publicKey}:`, JSON.stringify(selectionNumResult.error) )
    return
  }
  payload.selectionNum = selectionNumResult.value

  // add the join request to the global list of join requests. this will also
  // add it to the list of new join requests that will be processed as part of
  // cycle creation to create a standy node list.
  saveJoinRequest(payload)

  /* prettier-ignore */ nestedCountersInstance.countEvent( 'p2p', `join-gossip: request saved and gossiped` )
  Comms.sendGossip('gossip-valid-join-requests', payload, tracker, sender, NodeList.byIdOrder, false)
}
const gossipUnjoinRequests: P2P.P2PTypes.GossipHandler<UnjoinRequest, P2P.NodeListTypes.Node['id']> = (
  payload: UnjoinRequest,
  sender: P2P.NodeListTypes.Node['id'],
  tracker: string
) => {
  // Ignore gossip outside of Q1 and Q2
  if (![1, 2].includes(CycleCreator.currentQuarter)) {
    /* prettier-ignore */ if (logFlags.error) warn('gossip-unjoin-reject: not in Q1 or Q2')
    return
  }
  if (!payload) {
    warn('No payload provided for the `UnjoinRequest` request.')
    return
  }

  // Validate payload structure and types
  let err = utils.validateTypes(payload, {
    publicKey: 's',
    sign: 'o',
  })

  if (err) {
    /* prettier-ignore */ if (logFlags.error) warn(`gossipUnjoinRequests: bad input ${err}`)
    return
  }

  // Further validation for the 'sign' object structure
  err = utils.validateTypes(payload.sign, {
    owner: 's',
    sig: 's',
  })

  if (err) {
    /* prettier-ignore */ if (logFlags.error) warn(`gossipUnjoinRequests: bad input sign ${err}`)
    return
  }

  const signer = NodeList.byPubKey.get(payload.sign.owner)
  if (!signer) {
    /* prettier-ignore */ if (logFlags.error) warn('gossip-unjoin: Got unjoin-request from unknown node')
  }

  const isOrig = signer.id === sender

  // Only accept original txs in quarter 1
  if (isOrig && CycleCreator.currentQuarter > 1) {
    /* prettier-ignore */ nestedCountersInstance.countEvent('p2p', `gossip-unjoin-reject: CycleCreator.currentQuarter > 1 ${CycleCreator.currentQuarter}`)
    return
  }

  const processResult = processNewUnjoinRequest(payload)
  if (processResult.isErr()) {
    warn(`gossip-unjoin failed to process unjoin request: ${processResult.error}`)
    return
  }

  Comms.sendGossip('gossip-unjoin', payload, tracker, sender, NodeList.byIdOrder, false)
}

const gossipSyncStartedRoute: P2P.P2PTypes.GossipHandler<StartedSyncingRequest, P2P.NodeListTypes.Node['id']> = (
  payload,
  sender,
  tracker
) => {
  profilerInstance.scopedProfileSectionStart('gossip-sync-started')
  nestedCountersInstance.countEvent('p2p', `received gossip-sync-started`)
  /* prettier-ignore */ if (logFlags.verbose) console.log(`received gossip-sync-started`)
  try {
    if (!payload) {
      warn('No payload provided for the `SyncStarted` request.')
      return
    }

    const signer = NodeList.byPubKey.get(payload.sign.owner)
    if (!signer) {
      /* prettier-ignore */ if (logFlags.error) warn('sync-started: Got sync-started from unknown node')
    }

    const isOrig = signer.id === sender

    // Only accept original txs in quarter 1
    if (isOrig && CycleCreator.currentQuarter > 1) {
      /* prettier-ignore */ nestedCountersInstance.countEvent('p2p', `sync-started-reject: CycleCreator.currentQuarter > 1 ${CycleCreator.currentQuarter}`)
      return
    }

    // Do not forward gossip after quarter 2
    if (!isOrig && CycleCreator.currentQuarter > 2) {
      /* prettier-ignore */ nestedCountersInstance.countEvent('p2p', `sync-started-reject: CycleCreator.currentQuarter > 2 ${CycleCreator.currentQuarter}`)
      return
    }

    //  Validate of payload is done in addSyncStarted
    const addSyncStartedResult = addSyncStarted(payload)
    /* prettier-ignore */ nestedCountersInstance.countEvent('p2p', `sync-started validation success: ${addSyncStartedResult.success}`)
    /* prettier-ignore */ if (logFlags.verbose) console.log(`sync-started validation success: ${addSyncStartedResult.success}`)
    /* prettier-ignore */ if (!addSyncStartedResult.success)
nestedCountersInstance.countEvent('p2p', `sync-started failure reason: ${addSyncStartedResult.reason}`)
    /* prettier-ignore */ if (logFlags.verbose && !addSyncStartedResult.success) console.log(`sync-started validation reason: ${addSyncStartedResult.reason}`)
    if (addSyncStartedResult.success)
      Comms.sendGossip('gossip-sync-started', payload, tracker, sender, NodeList.byIdOrder, false)
  } finally {
    profilerInstance.scopedProfileSectionEnd('gossip-sync-started')
  }
}

/**
 * Handler for syncing finished gossip. Gossip coming from Join Protocol v2 in `enterSyncingState()` of startupV2 in Self.ts and the function below. 
 */
const gossipSyncFinishedRoute: P2P.P2PTypes.GossipHandler<P2P.JoinTypes.FinishedSyncingRequest, P2P.NodeListTypes.Node['id']> = (
  payload: P2P.JoinTypes.FinishedSyncingRequest,
  sender: P2P.NodeListTypes.Node['id'],
  tracker: string
) => {
  profilerInstance.scopedProfileSectionStart('gossip-sync-finished')

  if (config.debug.cycleRecordOOSDebugLogs) {
    if (receivedSyncFinished.has(payload.nodeId) === false) {
      receivedSyncFinished.set(payload.nodeId, true)
      console.log('DEBUG CR-OOS: payload id: ', payload.nodeId, ' payload cycle: ', payload.cycleNumber, 'cC: ', CycleCreator.currentCycle, ' cQ: ', CycleCreator.currentQuarter)
    }
  }
  
  try {
    // Ignore gossip outside of Q1 and Q2
    if (![1, 2].includes(CycleCreator.currentQuarter)) {
      /* prettier-ignore */ if (logFlags.error) warn('sync-finished-reject: not in Q1 or Q2')
      return
    }
    if (!payload) {
      /* prettier-ignore */ if (logFlags.error) warn('No payload provided for the `SyncFinished` request.')
      return
    }

    // Validate payload structure and types
    let err = utils.validateTypes(payload, {
      nodeId: 's',
      cycleNumber: 'n',
      sign: 'o',
    })

    if (err) {
      /* prettier-ignore */ if (logFlags.error) warn(`gossipSyncFinishedRoute: bad input ${err}`)
      return
    }

    err = utils.validateTypes(payload.sign, {
      owner: 's',
      sig: 's',
    })

    if (err) {
      /* prettier-ignore */ if (logFlags.error) warn(`gossipSyncFinishedRoute: bad input sign ${err}`)
      return
    }


    const signer = NodeList.byPubKey.get(payload.sign.owner)
    if (!signer) {
      /* prettier-ignore */ if (logFlags.error) warn('sync-finished: Got sync-finished from unknown node')
    }

    const isOrig = signer.id === sender

    // Only accept original txs in quarter 1
    if (isOrig && CycleCreator.currentQuarter > 1) {
      if (config.debug.cycleRecordOOSDebugLogs) console.log('DEBUG CR-OOS: gossipSyncFinished rejected: cC: ', CycleCreator.currentCycle, ' cQ: ', CycleCreator.currentQuarter, ' payload id: ', payload.nodeId, ' payload cycle: ', payload.cycleNumber)
      nestedCountersInstance.countEvent('p2p', `gossipSyncFinished rejected: cC: ${CycleCreator.currentCycle} cQ: ${CycleCreator.currentQuarter} payload id: ${payload.nodeId} payload cycle: ${payload.cycleNumber}`)
      /* prettier-ignore */ nestedCountersInstance.countEvent('p2p', `sync-finished-reject: CycleCreator.currentQuarter > 1 ${CycleCreator.currentQuarter}`)
      return
    }

    /* prettier-ignore */ if (logFlags.p2pNonFatal && logFlags.console) console.log('gossipSyncFinishedRoute: after quarter check')

    // Validate payload in addFinishedSyncing
    const addFinishedSyncingResult = addFinishedSyncing(payload)
    /* prettier-ignore */ nestedCountersInstance.countEvent('p2p', `sync-finished validation success: ${addFinishedSyncingResult.success}`)
    /* prettier-ignore */ if (!addFinishedSyncingResult.success) nestedCountersInstance.countEvent('p2p', `sync-finished failure reason: ${addFinishedSyncingResult.reason}`)
    if (addFinishedSyncingResult.success) {
      Comms.sendGossip('gossip-sync-finished', payload, tracker, sender, NodeList.byIdOrder, false)
    } else {
      /* prettier-ignore */ if (logFlags.p2pNonFatal && logFlags.console) console.log(`gossipSyncFinishedRoute: addFinishedSyncing failed: ${addFinishedSyncingResult.reason} fatal:${addFinishedSyncingResult.fatal} node:${payload.nodeId} cycle:${payload.cycleNumber}`)
    }
  } finally {
    profilerInstance.scopedProfileSectionEnd('gossip-sync-finished')
  }
}

const gossipStandbyRefresh: P2P.P2PTypes.GossipHandler<P2P.JoinTypes.StandbyRefreshRequest, P2P.NodeListTypes.Node['id']> = async (
  payload,
  sender,
  tracker
) => {
  profilerInstance.scopedProfileSectionStart('gossip-standby-refresh')
  nestedCountersInstance.countEvent('p2p', `received gossip-standby-refresh`)
  /* prettier-ignore */ if (logFlags.verbose) console.log(`received gossip-standby-refresh`)
  try {
    // Ignore gossip outside of Q1 and Q2
    if (![1, 2].includes(CycleCreator.currentQuarter)) {
      /* prettier-ignore */ if (logFlags.error) warn('standby-refresh-reject: not in Q1 or Q2')
      return
    }
    //if (logFlags.p2pNonFatal) info(`Got scale request: ${JSON.stringify(payload)}`)
    if (!payload) {
      warn('No payload provided for the `StandbyRefreshRequest` request.')
      return
    }

    // Validate payload structure and types
    let err = utils.validateTypes(payload, {
      publicKey: 's',
      cycleNumber: 'n',
      sign: 'o',
    })

    if (err) {
      /* prettier-ignore */ if (logFlags.error) warn(`gossipStandbyRefresh: bad input ${err}`)
      return
    }

    err = utils.validateTypes(payload.sign, {
      owner: 's',
      sig: 's',
    })

    if (err) {
      /* prettier-ignore */ if (logFlags.error) warn(`gossipStandbyRefresh: bad input sign ${err}`)
      return
    }
    

    // TODO: [] BUI - commented out since the signer isn't part of network and wouldn't be found on the NodeList and wouldn't be gossiping to standby nodes, correct?
    // also sig validation is done in addStandbyRefresh
    // const signer = NodeList.byPubKey.get(payload.sign.owner)
    // if (!signer) {
    //   /* prettier-ignore */ if (logFlags.error) warn('standby-refresh-reject: Got standby-refresh from unknown node')
    // }

    // const isOrig = signer.id === sender

    // // Only accept original txs in quarter 1
    // if (isOrig && CycleCreator.currentQuarter > 1) {
    //   /* prettier-ignore */ nestedCountersInstance.countEvent('p2p', `standby-refresh-reject: CycleCreator.currentQuarter > 1 ${CycleCreator.currentQuarter}`)
    //   return
    // }

    const added = addStandbyRefresh(payload)
    /* prettier-ignore */ nestedCountersInstance.countEvent('p2p', `standby-refresh validation success: ${added.success}`)
    /* prettier-ignore */ if (logFlags.verbose) console.log(`standby-refresh validation success: ${added.success}`)
    /* prettier-ignore */ if (!added.success) nestedCountersInstance.countEvent('p2p', `standby-refresh failure reason: ${added.reason}`)
    /* prettier-ignore */ if (logFlags.verbose && !added.success) console.log(`standby-refresh validation reason: ${added.reason}`)
    if (added.success)
      Comms.sendGossip('gossip-standby-refresh', payload, tracker, sender, NodeList.byIdOrder, false)
  } finally {
    profilerInstance.scopedProfileSectionEnd('gossip-standby-refresh')
  }
}


export const routes = {
  external: [cycleMarkerRoute, joinRoute, joinedRoute, joinedV2Route, acceptedRoute, unjoinRoute, standbyRefreshRoute],
  gossip: {
    'gossip-join': gossipJoinRoute,
    'gossip-valid-join-requests': gossipValidJoinRequests,
    'gossip-unjoin': gossipUnjoinRequests,
    'gossip-sync-started': gossipSyncStartedRoute,
    'gossip-sync-finished': gossipSyncFinishedRoute,
    'gossip-standby-refresh' : gossipStandbyRefresh,
  },
}

const receivedSyncFinished = new Map<string, boolean>()
