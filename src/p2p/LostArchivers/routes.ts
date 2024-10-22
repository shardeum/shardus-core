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
import { config, crypto, network } from '../Context'
import { getRandomAvailableArchiver } from '../Utils'
import * as funcs from './functions'
import * as logging from './logging'
import { lostArchiversMap } from './state'
import { currentQuarter } from '../CycleCreator'
import { id } from '../Self'
import { inspect } from 'util'
import { isDebugModeMiddleware } from '../../network/debugMiddleware'
import { getArchiverWithPublicKey } from '../Archivers'
import { InternalRouteEnum } from '../../types/enum/InternalRouteEnum'
import { InternalBinaryHandler } from '../../types/Handler'
import { nestedCountersInstance } from '../../utils/nestedCounters'
import { profilerInstance } from '../../utils/profiler'
import { deserializeLostArchiverInvestigateReq } from '../../types/LostArchiverInvestigateReq'
import { getStreamWithTypeCheck } from '../../types/Helpers'
import { TypeIdentifierEnum } from '../../types/enum/TypeIdentifierEnum'
import { checkGossipPayload } from '../../utils/GossipValidation'
import { Utils } from '@shardus/types'
import { nodelistFromStates } from '../Join'

/** Gossip */

const lostArchiverUpGossip: GossipHandler<SignedObject<ArchiverUpMsg>, Node['id']> = (
  payload,
  sender,
  tracker
) => {
  // the original gossip source is a node or nodes that the archiver notified as to the fact
  // that rumors of its death were highly exaggerated

  // If Lost Archiver Detection is disabled, return
  if (config.p2p.enableLostArchiversCycles === false) {
    return
  }
  if (
    !checkGossipPayload(
      payload,
      { type: 's', downMsg: 'o', refuteMsg: 'o', cycle: 's', sign: 'o' },
      'lostArchiverUpGossip',
      sender
    )
  ) {
    return
  }

  // to-do: need a guard on logging logging.info() and others?
  logging.info(`lostArchiverUpGossip: payload: ${inspect(payload)}, sender: ${sender}, tracker: ${tracker}`)

  // check args
  /* prettier-ignore */ if (!sender) { logging.warn(`lostArchiverUpGossip: missing sender`); return }
  /* prettier-ignore */ if (!tracker) { logging.warn(`lostArchiverUpGossip: missing tracker`); return }

  const error = funcs.errorForArchiverUpMsg(payload)
  if (error) {
    nestedCountersInstance.countEvent('lostArchivers', `lostArchiverUpGossip invalid payload ${error}`)      
    logging.warn(`lostArchiverUpGossip: invalid payload error: ${error}, payload: ${inspect(payload)}`)
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
  Comms.sendGossip(
    'lost-archiver-up',
    payload,
    tracker,
    id,
    nodelistFromStates([
      P2P.P2PTypes.NodeStatus.ACTIVE,
      P2P.P2PTypes.NodeStatus.READY,
      P2P.P2PTypes.NodeStatus.SYNCING,
    ]),
    false
  ) // isOrigin: false
  record.gossippedUpMsg = true
}

const lostArchiverDownGossip: GossipHandler<SignedObject<ArchiverDownMsg>, Node['id']> = (
  payload,
  sender,
  tracker
) => {
  // the original gossip source is the investigator node that confirmed the archiver is down

  // If Lost Archiver Detection is disabled, return
  if (config.p2p.enableLostArchiversCycles === false) {
    return
  }

  if (
    !checkGossipPayload(
      payload,
      { type: 's', investigateMsg: 'o', cycle: 's', sign: 'o' },
      'lostArchiverDownGossip',
      sender
    )
  ) {
    return
  }

  logging.info(`lostArchiverDownGossip: payload: ${inspect(payload)}, sender: ${sender}, tracker: ${tracker}`)

  // check args
  if (!sender) { logging.warn(`lostArchiverDownGossip: missing sender`); return }
  if (!tracker) { logging.warn(`lostArchiverDownGossip: missing tracker`); return }
  const error = funcs.errorForArchiverDownMsg(payload)
  if (error) {
    nestedCountersInstance.countEvent('lostArchivers', `lostArchiverDownGossip invalid payload ${error}`)      
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
      archiverDownMsg: downMsg,
    })
    lostArchiversMap.set(target, record)
  }
  // Otherwise, set status to 'down' and save the downMsg
  else {
    record.status = 'down'
    record.archiverDownMsg = downMsg
  }
  Comms.sendGossip(
    'lost-archiver-down',
    payload,
    tracker,
    id,
    nodelistFromStates([
      P2P.P2PTypes.NodeStatus.ACTIVE,
      P2P.P2PTypes.NodeStatus.READY,
      P2P.P2PTypes.NodeStatus.SYNCING,
    ]),
    false
  ) // isOrigin: false
  record.gossippedDownMsg = true
  // to-do: idea: record the update
}

/** Internal */

// const investigateLostArchiverRoute: Route<InternalHandler<SignedObject<InvestigateArchiverMsg>>> = {
//   method: 'GET',
//   name: 'lost-archiver-investigate',
//   handler: (payload, response, sender) => {
//     // we're being told to investigate a seemingly lost archiver

//     // If Lost Archiver Detection is disabled, return
//     if (config.p2p.enableLostArchiversCycles === false) {
//       return
//     }

//     logging.info(`investigateLostArchiverRoute: payload: ${inspect(payload)}, sender: ${sender}`)

//     // check args
//     if (!payload) { logging.warn(`investigateLostArchiverRoute: missing payload`); return }
//     if (!response) { logging.warn(`investigateLostArchiverRoute: missing response`); return }
//     if (!sender) { logging.warn(`investigateLostArchiverRoute: missing sender`); return }
//     const error = funcs.errorForInvestigateArchiverMsg(payload)
//     if (error) {
//       nestedCountersInstance.countEvent('lostArchivers', `investigateLostArchiverRoute invalid payload ${error}`)       
//       logging.warn(
//         `investigateLostArchiverRoute: invalid payload error: ${error}, payload: ${inspect(payload)}`
//       )
//       return
//     }

//     if (id !== payload.investigator) {
//       logging.info(`investigateLostArchiverRoute: not the investigator. returning`)
//       return
//       // to-do: check cycle too?
//       // original comment:
//       // Ignore hits here if we're not the designated Investigator for the given Archiver and cycle
//     }

//     logging.info(`investigateLostArchiverRoute: calling investigateArchiver()`)
//     funcs.investigateArchiver(payload)
//   },
// }

const investigateLostArchiverRouteBinary: Route<InternalBinaryHandler<Buffer>> = {
  name: InternalRouteEnum.binary_lost_archiver_investigate,
  handler: (payload, respond, header) => {
    // If Lost Archiver Detection is disabled, return
    if (config.p2p.enableLostArchiversCycles === false) {
      return
    }

    const route = InternalRouteEnum.binary_lost_archiver_investigate
    nestedCountersInstance.countEvent('internal', route)
    profilerInstance.scopedProfileSectionStart(route, false, payload.length)

    try {
      const reqStream = getStreamWithTypeCheck(payload, TypeIdentifierEnum.cGetAccountDataReq)
      if (!reqStream) {
        nestedCountersInstance.countEvent('internal', `${route}-invalid_request`)
        logging.warn(`${route}: Invalid request stream`)
        return
      }

      // Deserialize the payload
      const deserializedPayload = deserializeLostArchiverInvestigateReq(reqStream)
      logging.info(
        `investigateLostArchiverRoute: payload: ${inspect(deserializedPayload)}, sender: ${header.sender_id}`
      )

      // Basic argument checks
      if (!deserializedPayload) { logging.warn(`${route}: Missing payload`); return }
      if (!respond) { logging.warn(`${route}: Missing response method`); return }
      if (!header.sender_id) { logging.warn(`${route}: Missing sender ID`); return }

      const error = funcs.errorForInvestigateArchiverMsg(deserializedPayload)
      if (error) {
        nestedCountersInstance.countEvent('lostArchivers', `investigateLostArchiverRouteBinary invalid payload ${error}`)
        logging.warn(`${route}: Invalid payload error: ${error}, payload: ${inspect(payload)}`)
        return
      }

      // Investigator ID check
      if (id !== deserializedPayload.investigator) {
        logging.info(`${route}: Not the investigator, ignoring the request.`)
        // Potential TODO: Check cycle as well?
        return
      }

      // Proceed with the investigation logic
      logging.info(`${route}: Calling investigateArchiver()`)
      funcs.investigateArchiver(deserializedPayload)
    } catch (error) {
      // Log and handle any errors that occurred during the process
      nestedCountersInstance.countEvent('internal', `${route}-exception`)
      logging.error(`${route}: Error processing request - ${error.message}`)
    } finally {
      // Ensure profiling ends correctly in all cases
      profilerInstance.scopedProfileSectionEnd(route)
    }
  },
}

/** External */

const refuteLostArchiverRoute: P2P.P2PTypes.Route<Handler> = {
  method: 'POST',
  name: 'lost-archiver-refute',
  handler: (req, res) => {
    // If Lost Archiver Detection is disabled, return
    if (config.p2p.enableLostArchiversCycles === false) {
      return
    }

    // to-do: verify that validateArchiverUpMsg checks the signature or that whatever machinery invokes this route does; or do it ourselves
    // called by a refuting archiver
    const error = funcs.errorForArchiverRefutesLostMsg(req.body)
    if (error) {
      nestedCountersInstance.countEvent('lostArchivers', `refuteLostArchiverRoute invalid payload ${error}`)
      logging.warn(
        `refuteLostArchiverRoute: invalid archiver up message error: ${error}, payload: ${inspect(req.body)}`
      )
      res.json({ status: 'failure', message: error })
      return
    }
    const refuteMsg = req.body as SignedObject<ArchiverRefutesLostMsg>
    const target = refuteMsg.archiver
    // to-do: check target is a string or hexstring and min length
    let record = lostArchiversMap.get(target)
    if (!record) {
      record = funcs.createLostArchiverRecord({ target, status: 'up', archiverRefuteMsg: refuteMsg })
      lostArchiversMap.set(target, record)
    }
    if (record.status !== 'up') record.status = 'up'
    if (!record.archiverRefuteMsg) record.archiverRefuteMsg = refuteMsg
    res.json({ status: 'success' })
  },
}

const reportFakeLostArchiverRoute: P2P.P2PTypes.Route<Handler> = {
  method: 'GET',
  name: 'report-fake-lost-archiver',
  handler: (req, res) => {
    // If Lost Archiver Detection is disabled, return
    if (config.p2p.enableLostArchiversCycles === false) {
      return
    }

    logging.warn('/report-fake-lost-archiver: reporting fake lost archiver')
    // the archiver can be specified with an optional 'publicKey' or 'publickey' query param
    // otherwise a random one is chosen
    let publicKey: string | null = typeof req.query.publicKey === 'string' ? req.query.publicKey : null
    if (publicKey == null) publicKey = req.body.publickey // lowercase k
    const pick = publicKey ? 'specified' : 'random'
    const archiver = publicKey ? getArchiverWithPublicKey(publicKey) : getRandomAvailableArchiver()
    if (archiver) {
      funcs.reportLostArchiver(archiver.publicKey, 'fake lost archiver report')
      res.json(
        crypto.sign({
          status: 'accepted',
          pick,
          archiver,
          message: 'will report fake lost archiver',
        })
      )
    } else {
      res.json(
        crypto.sign({
          status: 'failed',
          pick,
          archiver,
          message: 'archiver not found',
        })
      )
    }
  },
}

const routes = {
  debugExternal: [reportFakeLostArchiverRoute],
  external: [refuteLostArchiverRoute],
  internal: [], //[investigateLostArchiverRoute],
  internalBinary: [investigateLostArchiverRouteBinary],
  gossip: {
    'lost-archiver-up': lostArchiverUpGossip,
    'lost-archiver-down': lostArchiverDownGossip,
  },
}

export function registerRoutes(): void {
  for (const route of routes.debugExternal) {
    network._registerExternal(route.method, route.name, isDebugModeMiddleware, route.handler)
  }
  for (const route of routes.external) {
    network._registerExternal(route.method, route.name, route.handler)
  }
  for (const route of routes.internal) {
    Comms.registerInternal(route.name, route.handler)
  }
  for (const route of routes.internalBinary) {
    Comms.registerInternalBinary(route.name, route.handler)
  }
  for (const [name, handler] of Object.entries(routes.gossip)) {
    Comms.registerGossipHandler(name, handler)
  }
}
