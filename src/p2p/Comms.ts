import { Logger } from 'log4js'
import { setIsUpTs } from '../p2p/Lost'
import * as utils from '../utils'
import { config, crypto, logger, network } from './Context'
import * as NodeList from './NodeList'
import * as Self from './Self'
import { InternalHandler, LooseObject } from './Types'
import {logFlags} from '../logger'

/** TYPES */

/** ROUTES */

type GossipReq = LooseObject

const gossipInternalRoute: InternalHandler<GossipReq> = async (
  payload,
  _respond,
  sender,
  tracker
) => {
  await handleGossip(payload, sender, tracker)
}

const routes = {
  internal: {
    gossip: gossipInternalRoute,
  },
}
/** STATE */

let p2pLogger: Logger

let acceptInternal = false

let keyCounter = 0
let internalRecvCounter = 0
// const gossipedHashesSent = new Map()     // No longer used
// const gossipedHashesRecv = new Map()    // No longer used
const gossipHandlers = {}

let gossipSent = 0
let gossipRecv = 0
const gossipTypeSent = {}
const gossipTypeRecv = {}

/** FUNCTIONS */
export function setAcceptInternal(enabled: boolean) {
  acceptInternal = enabled
}

export function init() {
  p2pLogger = logger.getLogger('p2p')

  // Register routes
  for (const [name, handler] of Object.entries(routes.internal)) {
    registerInternal(name, handler)
  }

  // Catch Q1 start events and log size of hashes
  Self.emitter.on('cycle_q1_start', pruneGossipHashes)
}

// Finds a node either in nodelist or in seedNodes list
function _findNodeInGroup(nodeId, group) {
  if (!group) {
    const errMsg = 'No group given for _findNodeInGroup()'
    warn(errMsg)
    throw new Error(errMsg)
  }
  for (const node of group) {
    if (node.id === nodeId) return node
  }
  warn(`Node ID not found in group: ${nodeId}`)
  return false
}

// Verifies that the received internal message was signed by the stated node
function _authenticateByNode(message, node) {
  let result
  try {
    if (!node.curvePublicKey) {
      error(
        'Node object did not contain curve public key for authenticateByNode()!'
      )
      return false
    }
    result = crypto.authenticate(message, node.curvePublicKey)
  } catch (e) {
    error(
      `Invalid or missing authentication tag on message: ${JSON.stringify(
        message
      )}`
    )
    return false
  }
  return result
}

function _extractPayload(wrappedPayload, nodeGroup) {
  let err = utils.validateTypes(wrappedPayload, { error: 's?' })
  if (err) {
    warn(
      'extractPayload: bad wrappedPayload: ' +
        err +
        ' ' +
        JSON.stringify(wrappedPayload)
    )
    return [null]
  }
  if (wrappedPayload.error) {
    const error = wrappedPayload.error
    warn(`_extractPayload Failed to extract payload. Error: ${error}`)
    return [null]
  }
  err = utils.validateTypes(wrappedPayload, {
    sender: 's',
    payload: 'o',
    tag: 's',
    tracker: 's?',
  })
  if (err) {
    warn(
      'extractPayload: bad wrappedPayload: ' +
        err +
        ' ' +
        JSON.stringify(wrappedPayload)
    )
    return [null]
  }
  // Check to see if node is in expected node group
  const node = _findNodeInGroup(wrappedPayload.sender, nodeGroup)
  if (!node) {
    warn(
      `_extractPayload Invalid sender on internal payload. sender: ${
        wrappedPayload.sender
      } payload: ${utils.stringifyReduceLimit(wrappedPayload)}`
    )
    return [null]
  }
  const authenticatedByNode = _authenticateByNode(wrappedPayload, node)
  // Check if actually signed by that node
  if (!authenticatedByNode) {
    warn(
      '_extractPayload Internal payload not authenticated by an expected node.'
    )
    return [null]
  }
  const payload = wrappedPayload.payload
  const sender = wrappedPayload.sender
  const tracker = wrappedPayload.tracker
  return [payload, sender, tracker]
}

function _wrapAndTagMessage(msg, tracker = '', recipientNode) {
  if (!msg) throw new Error('No message given to wrap and tag!')
  if (logFlags.verbose) {
    warn(
      `Attaching sender ${Self.id} to the message: ${utils.stringifyReduceLimit(
        msg
      )}`
    )
  }
  const wrapped = {
    payload: msg,
    sender: Self.id,
    tracker,
  }
  const tagged = crypto.tag(wrapped, recipientNode.curvePublicKey)
  return tagged
}

function createMsgTracker() {
  return (
    'key_' +
    utils.makeShortHash(Self.id) +
    '_' +
    Date.now() +
    '_' +
    keyCounter++
  )
}
function createGossipTracker() {
  return (
    'gkey_' +
    utils.makeShortHash(Self.id) +
    '_' +
    Date.now() +
    '_' +
    keyCounter++
  )
}

// Our own P2P version of the network tell, with a sign added
export async function tell(
  nodes,
  route,
  message,
  logged = false,
  tracker = ''
) {
  if (tracker === '') {
    tracker = createMsgTracker()
  }
  const promises = []
  for (const node of nodes) {
    if (node.id === Self.id) {
      if(logFlags.p2pNonFatal) info('p2p/Comms:tell: Not telling self')
      continue
    }
    const signedMessage = _wrapAndTagMessage(message, tracker, node)
    promises.push(network.tell([node], route, signedMessage, logged))
  }
  try {
    await Promise.all(promises)
  } catch (err) {
    warn('P2P TELL: failed', err)
  }
}

// Our own P2P version of the network ask, with a sign added, and sign verified on other side
export async function ask(
  node,
  route: string,
  message = {},
  logged = false,
  tracker = ''
) {
  if (tracker === '') {
    tracker = createMsgTracker()
  }
  if (node.id === Self.id) {
    if(logFlags.p2pNonFatal) info('p2p/Comms:ask: Not asking self')
    return false
  }
  const signedMessage = _wrapAndTagMessage(message, tracker, node)
  let signedResponse
  try {
    signedResponse = await network.ask(node, route, signedMessage, logged)
  } catch (err) {
    error('P2P: ask: network.ask: ' + err)
    return false
  }
  try {
    const [response] = _extractPayload(signedResponse, [node])
    if (!response) {
      throw new Error(
        `Unable to verify response to ask request: ${route} -- ${JSON.stringify(
          message
        )} from node: ${node.id}`
      )
    }
    return response
  } catch (err) {
    error('P2P: ask: _extractPayload: ' + err)
    return false
  }
}

export function registerInternal(route, handler) {
  // Create function that wraps handler function
  const wrappedHandler = async (wrappedPayload, respond) => {
    internalRecvCounter++
    // We have internal requests turned off until we have a node id
    if (!acceptInternal) {
      if(logFlags.p2pNonFatal) info('We are not currently accepting internal requests...')
      return
    }
    let tracker = ''
    // Create wrapped respond function for sending back signed data
    const respondWrapped = async (response) => {
      /**
       * [TODO] [AS]
       * If sender is not found in nodelist, _wrapAndTagMessage will try to access
       * a property of undefined and error out. This might cause some trouble for 
       * registerInternal handlers that use the respond fn handed to their callbacks
       * to reply to requests. They might have to be try/catched to avoid crashing
       * shardus
       */
      const node = NodeList.nodes.get(sender)
      const signedResponse = _wrapAndTagMessage(
        { ...response, isResponse: true },
        tracker,
        node
      )
      if (logFlags.verbose) {
        info(
          `The signed wrapped response to send back: ${utils.stringifyReduceLimit(
            signedResponse
          )}`
        )
      }
      if (route !== 'gossip') {
        logger.playbackLog(
          sender,
          'self',
          'InternalRecvResp',
          route,
          tracker,
          response
        )
      }
      await respond(signedResponse)
    }
    // Checks to see if we can extract the actual payload from the wrapped message
    const payloadArray = _extractPayload(
      wrappedPayload,
      NodeList.byIdOrder // [TODO] Maybe this should be othersByIdOrder
    )
    const [payload, sender] = payloadArray
    tracker = payloadArray[2] || ''
    if (!payload) {
      warn('Payload unable to be extracted, possible missing signature...')
      return
    }
    if (route !== 'gossip') {
      logger.playbackLog(
        sender,
        'self',
        'InternalRecv',
        route,
        tracker,
        payload
      )
    }
    await handler(payload, respondWrapped, sender, tracker)
  }
  // Include that in the handler function that is passed
  network.registerInternal(route, wrappedHandler)
}

export function unregisterInternal(route) {
  network.unregisterInternal(route)
}

function sortByID(first, second) {
  return utils.sortAscProp(first, second, 'id')
}

/**
 * Send Gossip to all nodes, using gossip in
 */
// [TODO] This function should not sort nodes; they should be pre-sorted
export async function sendGossip(
  type,
  payload,
  tracker = '',
  sender = null,
  inpNodes = NodeList.byIdOrder // Joining nodes need gossip too; we don't send to ourself
) {
  // [TODO] Don't copy the node list once sorted lists are passed in
  const nodes = [...inpNodes]

  if (nodes.length === 0) return

  if (tracker === '') {
    tracker = createGossipTracker()
  }

  if (logFlags.verbose) {
    info(`Start of sendGossipIn(${utils.stringifyReduce(payload)})`)
  }
  const gossipPayload = { type, data: payload }

  /*
  const gossipHash = crypto.hash(gossipPayload)
  if (gossipedHashesSent.has(gossipHash)) {
    if (logFlags.verbose) {
      warn(`Gossip already sent: ${gossipHash.substring(0, 5)}`)
    }
    return
  }
  */

  // nodes.sort((first, second) => first.id.localeCompare(second.id, 'en', { sensitivity: 'variant' }))
  nodes.sort(sortByID)
  const nodeIdxs = new Array(nodes.length).fill(0).map((curr, idx) => idx) // [TODO]  - we need to make sure that we never iterate, or copy the full nodes list. Assume it could be a million nodes.
  // Find out your own index in the nodes array
  const myIdx = nodes.findIndex((node) => node.id === Self.id)
  if (myIdx < 0) {
    // throw new Error('Could not find self in nodes array')
    error(`Failed to sendGossip. Could not find self in nodes array`)
    return
  }
  // Map back recipient idxs to node objects
  const recipientIdxs = utils.getRandomGossipIn(
    nodeIdxs,
    config.p2p.gossipRecipients,
    myIdx
  )
  let recipients = recipientIdxs.map((idx) => nodes[idx])
  if (sender != null) {
    recipients = utils.removeNodesByID(recipients, [sender])
  }
  try {
    if (logFlags.verbose) {
      info(
        `GossipingIn ${type} request to these nodes: ${utils.stringifyReduce(
          recipients.map(
            (node) => utils.makeShortHash(node.id) + ':' + node.externalPort
          )
        )}`
      )
    }
    for (const node of recipients) {
      logger.playbackLog(
        'self',
        node.id,
        'GossipInSend',
        type,
        tracker,
        gossipPayload
      )
      gossipSent++
      gossipTypeSent[type] = gossipTypeSent[type] ? gossipTypeSent[type] + 1 : 1
    }
    await tell(recipients, 'gossip', gossipPayload, true, tracker)
  } catch (ex) {
    if (logFlags.verbose) {
      error(
        `Failed to sendGossip(${utils.stringifyReduce(
          payload
        )}) Exception => ${ex}`
      )
    }
    fatal('sendGossipIn: ' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
  }
  // gossipedHashesSent.set(gossipHash, currentCycle)    // No longer used
  if (logFlags.verbose) {
    info(`End of sendGossipIn(${utils.stringifyReduce(payload)})`)
  }
}

export async function sendGossipAll(
  type,
  payload,
  tracker = '',
  sender = null,
  inpNodes = NodeList.byIdOrder // Joining nodes need gossip too; we don't send to ourself
) {
  // [TODO] Don't copy the node list once sorted lists are passed in
  const nodes = [...inpNodes]

  if (nodes.length === 0) return

  if (tracker === '') {
    tracker = createGossipTracker()
  }

  if (logFlags.verbose) {
    p2pLogger.debug(`Start of sendGossipIn(${utils.stringifyReduce(payload)})`)
  }
  const gossipPayload = { type, data: payload }

  const gossipHash = crypto.hash(gossipPayload)
  // if (gossipedHashesSent.has(gossipHash)) {
  //   if (logFlags.verbose) {
  //     p2pLogger.debug(`Gossip already sent: ${gossipHash.substring(0, 5)}`)
  //   }
  //   return
  // }
  // nodes.sort((first, second) => first.id.localeCompare(second.id, 'en', { sensitivity: 'variant' }))
  nodes.sort(sortByID)
  const nodeIdxs = new Array(nodes.length).fill(0).map((curr, idx) => idx)
  // Find out your own index in the nodes array
  const myIdx = nodes.findIndex((node) => node.id === Self.id)
  if (myIdx < 0) throw new Error('Could not find self in nodes array')

  let recipients = nodes
  if (sender != null) {
    recipients = utils.removeNodesByID(recipients, [sender])
  }
  try {
    if (logFlags.verbose) {
      p2pLogger.debug(
        `GossipingIn ${type} request to these nodes: ${utils.stringifyReduce(
          recipients.map(
            (node) => utils.makeShortHash(node.id) + ':' + node.externalPort
          )
        )}`
      )
    }
    for (const node of recipients) {
      logger.playbackLog(
        'self',
        node.id,
        'GossipInSend',
        type,
        tracker,
        gossipPayload
      )
    }
    await tell(recipients, 'gossip', gossipPayload, true, tracker)
  } catch (ex) {
    if (logFlags.verbose) {
      p2pLogger.error(
        `Failed to sendGossip(${utils.stringifyReduce(
          payload
        )}) Exception => ${ex}`
      )
    }
    p2pLogger.fatal(
      'sendGossipIn: ' + ex.name + ': ' + ex.message + ' at ' + ex.stack
    )
  }
  //gossipedHashesSent.set(gossipHash, false)
  if (logFlags.verbose) {
    p2pLogger.debug(`End of sendGossipIn(${utils.stringifyReduce(payload)})`)
  }
}

/**
 * Handle Goosip Transactions
 * Payload: {type: ['receipt', 'trustedTransaction'], data: {}}
 */
export async function handleGossip(payload, sender, tracker = '') {
  if (logFlags.verbose) {
    info(`Start of handleGossip(${utils.stringifyReduce(payload)})`)
  }

  const err = utils.validateTypes(payload, { type: 's', data: 'o' })
  if (err) {
    warn('handleGossip: bad payload: ' + err)
    return
  }

  // Simulating bad network by dropping received gossip
  //   set the propability of dropping to a number between 0 to 1
  if (Math.random() < 0.0) {
    warn('Dropped gossip to simulate bad network')
    return
  }

  const type = payload.type
  const data = payload.data

  const gossipHandler = gossipHandlers[type]
  if (!gossipHandler) {
    warn(
      `Gossip Handler not found: type ${type}, data: ${JSON.stringify(data)}`
    )
    return
  }

  /*
  const gossipHash = crypto.hash(payload)
  if (gossipedHashesSent.has(gossipHash)) {
    return
  }
  */

  /*
  2020.05.12 Omar decided that we should not try to block received gossip from reaching the gossip handlers.
.                         It is possible that the handler ignored a gossip message when it was first seen, but could apply
.                         it later if the quarter changed or an internal message received from another node changes the context.
.                         Or who the gossip is received from could make a difference. For example in Q2 the handler ignores
.                          gossip from the originator, but accepts it from others.
.                     *  Also we should not block gossip for messages we have sent. We may need the message to come
.                          in through the handler so that we apply it.
.                    *   Also we should not set a timeout for every gossip hash to delete it later. We should delete old
.                         hashes once per cycle.
.                    *   Also there is cost of doing a hash on every message received. But at the handler we could easily
.                          check a field in the message to decide if we processed this before.
.                    *   For all of the above reasones we should not try to block gossip that we have seen before at this
.                         layer and let the handlers deal with it.
.                    *   We should  block sending the same gossip message we have already sent before. However, some
.                          logging found that we don't typically send the same gossip message again. So the effort to compute,
.                          save and delete the hashes is wasted.
  */
  /*
  if (gossipedHashesRecv.has(gossipHash)) {
    if (logFlags.verbose) {
      warn(`Got old gossip: ${gossipHash.substring(0, 5)}`)
    }
    if (!gossipedHashesRecv.get(gossipHash)) {  // [TODO] - double check logic; gossipHash should be gettable here since has() is true; so we never setTimeout()
      setTimeout(
        () => gossipedHashesRecv.delete(gossipHash),    // [TODO] - we should not be using setTimeout to delete old gossipHashes; it can be deleted before Q1 starts;
        config.p2p.gossipTimeout
      )
      gossipedHashesRecv.set(gossipHash, true)
      if (logFlags.verbose) {
        warn(
          `Marked old gossip for deletion: ${gossipHash.substring(0, 5)} in ${
            config.p2p.gossipTimeout
          } ms`
        )
      }
    }
    return
  }
  gossipedHashesRecv.set(gossipHash, false)    // [TODO] - double check logic; we setTimeout to delete gossipHash if we get it a second time, but not first time ???
  */

  setIsUpTs(sender)

  gossipRecv++
  gossipTypeRecv[type] = gossipTypeRecv[type] ? gossipTypeRecv[type] + 1 : 1
  logger.playbackLog(sender, 'self', 'GossipRcv', type, tracker, data)
  // [TODO] - maybe we don't need to await the following line
  await gossipHandler(data, sender, tracker)
  if (logFlags.verbose) {
    info(`End of handleGossip(${utils.stringifyReduce(payload)})`)
  }
}

/**
 * Callback for handling gossip.
 *
 * @callback handleGossipCallback
 * @param {any} data the data response of the callback
 * @param {Node} sender
 * @param {string} tracker the tracking string
 */

/**
 * @param {string} type
 * @param {handleGossipCallback} handler
 */
export function registerGossipHandler(type, handler) {
  gossipHandlers[type] = handler
}

export function unregisterGossipHandler(type) {
  if (gossipHandlers[type]) {
    delete gossipHandlers[type]
  }
}

// We don't need to prune gossip hashes since we are not creating them anymore.
function pruneGossipHashes() {
  //  warn(`gossipedHashesRecv:${gossipedHashesRecv.size} gossipedHashesSent:${gossipedHashesSent.size}`)
  if(logFlags.p2pNonFatal) {
    info(`Total  gossipSent:${gossipSent} gossipRecv:${gossipRecv}`)
    info(`Sent gossip by type: ${JSON.stringify(gossipTypeSent)}`)
    info(`Recv gossip by type: ${JSON.stringify(gossipTypeRecv)}`)
  }
}

function info(...msg) {
  const entry = `Comms: ${msg.join(' ')}`
  p2pLogger.info(entry)
}

function warn(...msg) {
  const entry = `Comms: ${msg.join(' ')}`
  p2pLogger.warn(entry)
}

function error(...msg) {
  const entry = `Comms: ${msg.join(' ')}`
  p2pLogger.error(entry)
}

function fatal(...msg) {
  const entry = `Comms: ${msg.join(' ')}`
  p2pLogger.fatal(entry)
}
