import { AppHeader } from '@shardus/net/build/src/types'
import { P2P } from '@shardus/types'
import { Logger } from 'log4js'
import { logFlags } from '../logger'
import { ipInfo, shardusGetTime } from '../network'
import { isNodeDown, isNodeLost, isNodeUpRecent, setIsUpTs } from '../p2p/Lost'
import { ShardusTypes } from '../shardus'
import { Sign } from '../shardus/shardus-types'
import { InternalBinaryHandler } from '../types/Handler'
import { requestSerializer, responseDeserializer, responseSerializer } from '../types/Helpers'
import { deserializeWrappedReq } from '../types/WrappedReq'
import * as utils from '../utils'
import { nestedCountersInstance } from '../utils/nestedCounters'
import { cNoSizeTrack, cUninitializedSize, profilerInstance } from '../utils/profiler'
import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { config, crypto, logger, network } from './Context'
import * as NodeList from './NodeList'
import * as Self from './Self'
import * as CycleChain from './CycleChain'
import * as Shardus from '../shardus/shardus-types'
import { isNodeInRotationBounds } from './Utils'
import { deserializeGossipReq, GossipReqBinary, serializeGossipReq } from '../types/GossipReq'
import { InternalRouteEnum, isAskRoute } from '../types/enum/InternalRouteEnum'
import { RequestErrorEnum } from '../types/enum/RequestErrorEnum'
import { getStreamWithTypeCheck, requestErrorHandler } from '../types/Helpers'
import { TypeIdentifierEnum } from '../types/enum/TypeIdentifierEnum'
import { InternalError, ResponseError, serializeResponseError } from '../types/ResponseError'
import { Utils } from '@shardus/types'

/** ROUTES */

type GossipReq = P2P.P2PTypes.LooseObject

const gossipInternalRoute: P2P.P2PTypes.InternalHandler<GossipReq> = async (
  payload,
  _respond,
  sender,
  tracker,
  msgSize
) => {
  await handleGossip(payload, sender, tracker, msgSize)
}

const gossipInternalBinaryRoute: P2P.P2PTypes.Route<InternalBinaryHandler<Buffer>> = {
  name: InternalRouteEnum.binary_gossip,
  handler: async (payload, response, header, sign) => {
    const route = InternalRouteEnum.binary_gossip
    nestedCountersInstance.countEvent('internal', route)
    profilerInstance.scopedProfileSectionStart(route)
    const errorHandler = (
      errorType: RequestErrorEnum,
      opts?: { customErrorLog?: string; customCounterSuffix?: string }
    ): void => requestErrorHandler(route, errorType, header, opts)
    try {
      const requestStream = getStreamWithTypeCheck(payload, TypeIdentifierEnum.cGossipReq)
      if (!requestStream) {
        return errorHandler(RequestErrorEnum.InvalidRequest)
      }
      const req: GossipReqBinary = deserializeGossipReq(requestStream)
      await handleGossip(req, header.sender_id, header.tracker_id, payload.length)
    } catch (e) {
      nestedCountersInstance.countEvent('internal', `${route}-exception`)
      logger
        .getLogger('comms-route')
        .error(`${route}: Exception executing request: ${utils.errorToStringFull(e)}`)
    } finally {
      profilerInstance.scopedProfileSectionEnd(route)
    }
  },
}

const routes = {
  internal: {
    gossip: gossipInternalRoute,
  },
  internalBinary: {
    gossip: gossipInternalBinaryRoute,
  },
}
/** STATE */

let p2pLogger: Logger
let seqLogger: Logger

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

let commsCounters = true

/** FUNCTIONS */
export function setAcceptInternal(enabled: boolean) {
  acceptInternal = enabled
}

export function init() {
  p2pLogger = logger.getLogger('p2p')
  seqLogger = logger.getLogger('seq')

  // Register routes
  for (const [name, handler] of Object.entries(routes.internal)) {
    registerInternal(name, handler)
  }

  // Register binary routes
  for (const route of Object.values(routes.internalBinary)) {
    registerInternalBinary(route.name, route.handler)
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
      error('Node object did not contain curve public key for authenticateByNode()!')
      return false
    }
    result = config.p2p.useSignaturesForAuth
      ? crypto.verify(message, node.publicKey)
      : crypto.authenticate(message, node.curvePublicKey)
  } catch (e) {
    /* prettier-ignore */ if (logFlags.verbose) error(`Invalid or missing authentication/signature tag on message: ${Utils.safeStringify(message)}`)
    return false
  }
  return result
}

// Extracts the payload from binary serialized wrapped messages.
// This method could have done a complete deserialization into the specific type but,
// that is avoided as we want to delay parsing of payload until header checks succeed.
function _extractPayloadBinary(wrappedPayload): Buffer {
  /* prettier-ignore */ if (logFlags.verbose) console.log('_extractPayloadBinary: wrappedPayload', Utils.safeStringify(wrappedPayload))
  let buffer = null
  if (wrappedPayload instanceof Buffer) {
    /* prettier-ignore */ if (logFlags.verbose) info(`_extractPayloadBinary: wrappedPayload is a buffer: ${wrappedPayload}`)
    buffer = wrappedPayload
  } else if (wrappedPayload.type === 'Buffer' && Array.isArray(wrappedPayload.data)) {
    /* prettier-ignore */ if (logFlags.verbose) info(`_extractPayloadBinary: wrappedPayload is a buffer struct: ${wrappedPayload}`)
    buffer = Buffer.from(wrappedPayload.data)
  } else {
    nestedCountersInstance.countEvent('comms-route', `_extractPayloadBinary: bad wrappedPayload`)
    throw new Error(`Unsupported wrappedPayload type: ${wrappedPayload.type}`)
  }

  const stream = VectorBufferStream.fromBuffer(buffer)
  const payloadType = stream.readUInt16()
  switch (payloadType) {
    case 3:
      const wrappedReq = deserializeWrappedReq(stream)
      return wrappedReq.payload
    default:
      throw new Error(`Unsupported payload type: ${payloadType}`)
  }
}

function _extractPayload(wrappedPayload, nodeGroup) {
  let err = utils.validateTypes(wrappedPayload, { error: 's?' })
  if (err) {
    warn('extractPayload: bad wrappedPayload: ' + err + ' ' + Utils.safeStringify(wrappedPayload))
    return [null]
  }
  if (wrappedPayload.error) {
    const error = wrappedPayload.error
    warn(`_extractPayload Failed to extract payload. Error: ${error}`)
    return [null]
  }
  err = utils.validateTypes(
    wrappedPayload,
    config.p2p.useSignaturesForAuth
      ? {
          sender: 's',
          payload: 'o',
          sign: 'o',
          tracker: 's?',
        }
      : {
          sender: 's',
          payload: 'o',
          tag: 's',
          tracker: 's?',
        }
  )
  if (err) {
    warn('extractPayload: bad wrappedPayload: ' + err + ' ' + Utils.safeStringify(wrappedPayload))
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
    warn('_extractPayload Internal payload not authenticated by an expected node.')
    return [null]
  }
  const payload = wrappedPayload.payload
  const sender = wrappedPayload.sender
  const tracker = wrappedPayload.tracker
  const msgSize = wrappedPayload.msgSize
  return [payload, sender, tracker, msgSize]
}

function _wrapMessage(msg, tracker = '') {
  if (!msg) throw new Error('No message given to wrap and tag!')
  if (logFlags.verbose) {
    warn(`Attaching sender ${Self.id} to the message: ${utils.stringifyReduceLimit(msg)}`)
  }
  return {
    payload: msg,
    sender: Self.id,
    tracker,
    msgSize: 0,
  }
}

function _wrapAndTagMessage(msg, tracker = '', recipientNode) {
  const wrapped = _wrapMessage(msg, tracker)
  return crypto.tagWithSize(wrapped, recipientNode.curvePublicKey)
}

function _wrapAndSignMessage(msg, tracker = '') {
  const wrapped = _wrapMessage(msg, tracker)
  return crypto.signWithSize(wrapped)
}

function createMsgTracker(route = '') {
  return 'key_' + route + '_' + utils.makeShortHash(Self.id) + '_' + shardusGetTime() + '_' + keyCounter++
}
function createGossipTracker() {
  return 'gkey_' + utils.makeShortHash(Self.id) + '_' + shardusGetTime() + '_' + keyCounter++
}

// Our own P2P version of the network tell, with a sign added
export async function tell(
  nodes: ShardusTypes.Node[],
  route,
  message,
  logged = false,
  tracker = '',
  subRoute = '' // used by gossip to differentiate between different gossip types
) {
  profilerInstance.profileSectionStart('p2p-tell')
  profilerInstance.profileSectionStart(`p2p-tell-${route}`)
  let msgSize = cUninitializedSize
  if (tracker === '') {
    tracker = createMsgTracker(route)
  }

  if (commsCounters) {
    nestedCountersInstance.countEvent('comms-route', `tell ${route}`, nodes.length)
    /* prettier-ignore */ nestedCountersInstance.countEvent('comms-route x recipients', `tell ${route} recipients:${nodes.length}`, nodes.length)
    nestedCountersInstance.countEvent('comms-recipients', `tell recipients: ${nodes.length}`, nodes.length)
    /* prettier-ignore */ nestedCountersInstance.countEvent('comms-route x recipients (logical count)', `tell ${route} recipients:${nodes.length}`)
  }

  msgSize = config.p2p.useSignaturesForAuth
    ? await signedMultiTell(nodes, message, tracker, msgSize, route, logged, subRoute)
    : await taggedMultiTell(nodes, message, tracker, msgSize, route, logged, subRoute)
  profilerInstance.profileSectionEnd('p2p-tell')
  profilerInstance.profileSectionEnd(`p2p-tell-${route}`)
  return msgSize
}

export async function tellBinary<TReq>(
  nodes: ShardusTypes.Node[],
  route: string,
  message: TReq,
  serializerFunc: (stream: VectorBufferStream, obj: TReq, root?: boolean) => void,
  appHeader: AppHeader,
  logged = false,
  tracker = ''
) {
  profilerInstance.profileSectionStart('p2p-tellBinary')
  profilerInstance.profileSectionStart(`p2p-tellBinary-${route}`)
  let msgSize = cUninitializedSize
  if (tracker === '' || !appHeader.tracker_id) {
    tracker = createMsgTracker(route)
    appHeader.tracker_id = tracker
  }
  appHeader.sender_id = Self.id

  if (commsCounters) {
    nestedCountersInstance.countEvent('comms-route', `tellBinary ${route}`, nodes.length)
    /* prettier-ignore */ nestedCountersInstance.countEvent('comms-route x recipients', `tellBinary ${route} recipients:${nodes.length}`, nodes.length)
    nestedCountersInstance.countEvent(
      'comms-recipients',
      `tellBinary recipients: ${nodes.length}`,
      nodes.length
    )
    /* prettier-ignore */ nestedCountersInstance.countEvent('comms-route x recipients (logical count)', `tellBinary ${route} recipients:${nodes.length}`)
  }

  const nonSelfNodes = nodes.filter((node) => node.id !== Self.id)
  try {
    const wrappedReq = requestSerializer(message, serializerFunc)
    await network.tellBinary(nonSelfNodes, route, wrappedReq.getBuffer(), appHeader, tracker, logged)
  } catch (err) {
    warn(`tellBinary: network.tellBinary: P2P TELL_BINARY: failed. route: ${route}, error: ${err}`)
  }
  profilerInstance.profileSectionEnd('p2p-tellBinary')
  profilerInstance.profileSectionEnd(`p2p-tellBinary-${route}`)
  return msgSize
}

async function taggedMultiTell(
  nodes: any[],
  message: any,
  tracker: string,
  msgSize: number,
  route: any,
  logged: boolean,
  subRoute = ''
) {
  const promises = []
  for (const node of nodes) {
    if (node.id === Self.id) {
      if (logFlags.p2pNonFatal) info('p2p/Comms:tell: Not telling self')
      continue
    }
    const signedMessage = _wrapAndTagMessage(message, tracker, node)
    msgSize = signedMessage.msgSize
    /* prettier-ignore */ if (logFlags.p2pNonFatal) info(`taggedMultiTell: signed and tagged gossip`, utils.stringifyReduceLimit(signedMessage))
    promises.push(network.tell([node], route, signedMessage, logged, subRoute))
  }
  try {
    await Promise.all(promises)
  } catch (err) {
    warn('taggedMultiTell: P2P TELL: failed', err)
  }
  return msgSize
}

async function signedMultiTell(
  nodes: any[],
  message: any,
  tracker: string,
  msgSize: number,
  route: any,
  logged: boolean,
  subRoute = ''
) {
  const signedMessage = _wrapAndSignMessage(message, tracker)
  msgSize = signedMessage.msgSize
  const nonSelfNodes = nodes.filter((node) => node.id !== Self.id)
  /* prettier-ignore */ if (logFlags.p2pNonFatal) info(`signedMultiTell: signed and tagged gossip`, utils.stringifyReduceLimit(signedMessage))
  try {
    await network.tell(nonSelfNodes, route, signedMessage, logged, subRoute)
  } catch (err) {
    warn('signedMultiTell: P2P TELL: failed', err)
  }
  return msgSize
}

// Our own P2P version of the network ask, with a sign added, and sign verified on other side
export async function ask(
  node: ShardusTypes.Node,
  route: string,
  message = {},
  logged = false,
  tracker = '',
  extraTime = 0
) {
  if (tracker === '') {
    tracker = createMsgTracker(route)
  }
  if (node.id === Self.id) {
    if (logFlags.p2pNonFatal) info('p2p/Comms:ask: Not asking self')
    return false
  }

  if (commsCounters) {
    nestedCountersInstance.countEvent('comms-route', `ask ${route}`)
    nestedCountersInstance.countEvent('comms-route x recipients', `ask ${route} recipients: 1`)
    nestedCountersInstance.countEvent('comms-recipients', `ask recipients: 1`)
    /* prettier-ignore */ nestedCountersInstance.countEvent('comms-route x recipients (logical count)', `ask ${route} recipients: 1`)
  }

  const msgWithAuth = config.p2p.useSignaturesForAuth
    ? await _wrapAndSignMessage(message, tracker)
    : await _wrapAndTagMessage(message, tracker, node)
  let respWithAuth
  try {
    respWithAuth = await network.ask(node, route, msgWithAuth, logged, extraTime)
  } catch (err) {
    error('P2P: ask: network.ask: ' + err)
    return false
  }
  try {
    const [response] = _extractPayload(respWithAuth, [node])
    if (!response) {
      throw new Error(
        `Unable to verify response to ask request: ${route} -- ${Utils.safeStringify(message)} from node: ${
          node.id
        }`
      )
    }
    return response
  } catch (err) {
    error('P2P: ask: _extractPayload: ' + err)
    return false
  }
}

export async function askBinary<TReq, TResp>(
  node: ShardusTypes.Node,
  route: string,
  message: TReq,
  reqSerializerFunc: (stream: VectorBufferStream, obj: TReq, root?: boolean) => void,
  respDeserializerFunc: (stream: VectorBufferStream, root?: boolean) => TResp,
  appHeader: AppHeader,
  tracker = '',
  logged = false,
  extraTime = 0
): Promise<TResp> {
  if (tracker === '') {
    tracker = createMsgTracker(route)
    appHeader.tracker_id = tracker
  }
  if (!appHeader.sender_id) appHeader.sender_id = Self.id

  if (node.id === Self.id) {
    if (logFlags.p2pNonFatal) info('p2p/Comms: askBinary: Not asking self')
    throw new Error('Not asking self')
  }

  if (commsCounters) {
    nestedCountersInstance.countEvent('comms-route', `askBinary ${route}`)
    nestedCountersInstance.countEvent('comms-route x recipients', `askBinary ${route} recipients: 1`)
    nestedCountersInstance.countEvent('comms-recipients', `askBinary recipients: 1`)
    /* prettier-ignore */ nestedCountersInstance.countEvent('comms-route x recipients (logical count)', `askBinary ${route} recipients: 1`)
  }

  let res, header: AppHeader, sign: Sign
  try {
    const wrappedReq = requestSerializer(message, reqSerializerFunc)
    ;({ res, header, sign } = await network.askBinary(
      node,
      route,
      wrappedReq.getBuffer(),
      appHeader,
      tracker,
      logged,
      extraTime
    ))
  } catch (err) {
    nestedCountersInstance.countEvent('comms-route', `askBinary ${route} request error`)
    /* prettier-ignore */ console.log(`P2P: askBinary: network.askBinary: route: ${route} request: ${Utils.safeStringify(message)} error: ${err}`)
    /* prettier-ignore */ error(`P2P: askBinary: network.askBinary: route: ${route} request: ${Utils.safeStringify(message)} error: ${err}`)
    throw err
  }
  try {
    if (!res)
      /* prettier-ignore */ throw new Error(`Empty response to askBinary request: ${route} -- ${Utils.safeStringify(message)} from node: ${node.id}`)

    if (header && sign)
      if (header.sender_id !== node.id || sign.owner !== node.publicKey) {
        warn('askBinary: response did not come from the expected node.')
        throw new Error('askBinary: response did not come from the expected node.')
      }

    const respStream = VectorBufferStream.fromBuffer(res)
    const deserializedResp = responseDeserializer(respStream, respDeserializerFunc)
    return deserializedResp
  } catch (err) {
    if (err instanceof ResponseError) {
      nestedCountersInstance.countEvent('comms-route', `askBinary ${route} error ${err.Code}`)
    } else {
      nestedCountersInstance.countEvent('comms-route', `askBinary ${route} response error`)
      /* prettier-ignore */ error(`P2P: askBinary: response extraction route: ${route} res: ${Utils.safeStringify(res)} error: ${err}`)
      /* prettier-ignore */ console.log(`P2P: askBinary: response extraction route: ${route} res: ${Utils.safeStringify(res)} error: ${err}`)
    }
    throw err
  }
}

export function evictCachedSockets(nodes: ShardusTypes.Node[]) {
  profilerInstance.scopedProfileSectionStart('p2p-evictCachedSockets')
  network.evictCachedSockets(nodes)
  profilerInstance.scopedProfileSectionEnd('p2p-evictCachedSockets')
}

export function registerInternal(route, handler) {
  // Create function that wraps handler function
  const wrappedHandler = async (wrappedPayload, respond) => {
    /* prettier-ignore */ if(logFlags.p2pNonFatal) info("registerInternal wrappedPayload", utils.stringifyReduceLimit(wrappedPayload))
    internalRecvCounter++
    // We have internal requests turned off until we have a node id
    if (!acceptInternal) {
      if (logFlags.p2pNonFatal) info(`${route} We are not currently accepting internal requests...`)
      await respond({ error: `${route} error: Not accepting internal requests` })
      return
    }

    let msgSize = 0

    let tracker = ''
    let hasHandlerResponded = false
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
      const message = { ...response, isResponse: true }
      const respWithAuth = config.p2p.useSignaturesForAuth
        ? await _wrapAndSignMessage(message, tracker)
        : await _wrapAndTagMessage(message, tracker, node)

      if (logFlags.verbose && logFlags.p2pNonFatal) {
        /* prettier-ignore */ info( `The signed wrapped response to send back: ${utils.stringifyReduceLimit(respWithAuth)} size:${ respWithAuth.msgSize }` )
      }
      if (route !== 'gossip') {
        /* prettier-ignore */ if (logFlags.playback) logger.playbackLog(sender, 'self', 'InternalRecvResp', route, tracker, response)
      }
      await respond(respWithAuth)
      hasHandlerResponded = true

      //return the message size in bytes
      return respWithAuth.msgSize
    }
    // Checks to see if we can extract the actual payload from the wrapped message
    const payloadArray = _extractPayload(
      wrappedPayload,
      NodeList.byIdOrder // [TODO] Maybe this should be othersByIdOrder
    )
    const [payload, sender] = payloadArray
    tracker = payloadArray[2] || ''
    msgSize = payloadArray[3] || cNoSizeTrack
    if (!payload) {
      warn(`${route} Payload unable to be extracted, possible missing signature...`)
      await respond({ error: `${route} error: Payload unable to be extracted` })
      return
    }
    if (!NodeList.nodes.has(sender)) {
      warn(`${route} Internal routes can only be used by nodes in the network...`)
      await respond({ error: `${route} error: Sender not in node list` })
      return
    }
    if (route !== 'gossip') {
      /* prettier-ignore */ if (logFlags.playback) logger.playbackLog(sender, 'self', 'InternalRecv', route, tracker, payload)
    }

    //mark that we got a message from this node (for isNodeUpRecent)
    setIsUpTs(sender)

    await handler(payload, respondWrapped, sender, tracker, msgSize)

    // If the handler didn't call respondWrapped, we need to send an empty response
    if (!hasHandlerResponded && route !== 'gossip') {
      nestedCountersInstance.countEvent('comms-route', `no-response`)
      nestedCountersInstance.countEvent('comms-route', `no-response ${route}`)
      await respond({ error: `${route} error: No response from handler` })
    }
  }
  // Include that in the handler function that is passed
  network.registerInternal(route, wrappedHandler)
}

export function registerInternalBinary(route: string, handler: InternalBinaryHandler) {
  const wrappedHandler = async (wrappedPayload, respond, header: AppHeader, sign: Sign) => {
    /* prettier-ignore */ if(logFlags.p2pNonFatal) info('registerInternalBinary: wrappedPayload', utils.stringifyReduceLimit(wrappedPayload))
    internalRecvCounter++
    // We have internal requests turned off until we have a node id
    if (!acceptInternal) {
      if (logFlags.p2pNonFatal)
        info('registerInternalBinary: we are not currently accepting internal requests...')
      return
    }

    let hasHandlerResponded = false
    // Create wrapped respond function for sending back data
    const respondWrapped = async (
      response,
      serializerFunc: (stream: VectorBufferStream, obj, root?: boolean) => void,
      responseHeaders: AppHeader = {}
    ) => {
      try {
        const wrappedRespStream = responseSerializer(response, serializerFunc)
        responseHeaders.sender_id = Self.id
        responseHeaders.tracker_id = header.tracker_id
        /* prettier-ignore */ if (logFlags.verbose && logFlags.p2pNonFatal) info(`registerInternalBinary: wrapped response to send back: ${wrappedRespStream.getBuffer()} size: ${wrappedRespStream.getBufferLength()}`)
        if (route !== 'gossip') {
          /* prettier-ignore */ if (logFlags.playback) logger.playbackLog(header.sender_id, 'self', 'InternalRecvResp', route, header.tracker_id, response)
        }
        hasHandlerResponded = true
        await respond(wrappedRespStream.getBuffer(), responseHeaders)
        return wrappedRespStream.getBufferLength()
      } catch (err: unknown) {
        /* prettier-ignore */ error(`registerInternalBinary: route: ${route} responseHeaders: ${Utils.safeStringify(responseHeaders)}, Response: ${Utils.safeStringify(response)}, Error: ${utils.formatErrorMessage(err)}`)
        /* prettier-ignore */ nestedCountersInstance.countEvent('registerInternalBinary', `respondWrapped ${route} error`)
        return 0
      }
    }
    /* prettier-ignore */ if (logFlags.verbose && logFlags.p2pNonFatal) console.log('header:', header)
    /* prettier-ignore */ if (logFlags.verbose && logFlags.p2pNonFatal) info(`registerInternalBinary: request info: route: ${route} header: ${Utils.safeStringify(header)} sign: ${Utils.safeStringify(sign)}`)
    if (
      !NodeList.byPubKey.has(sign.owner) &&
      !NodeList.nodes.has(header.sender_id) &&
      !config.debug.enableTestMode
    ) {
      warn('registerInternalBinary: internal routes can only be used by nodes in the network...')
      return
    }

    // Checks to see if we can extract the actual payload from the wrapped message
    const requestPayload = _extractPayloadBinary(wrappedPayload)
    if (!requestPayload) {
      warn('registerInternalBinary: payload unable to be extracted, possible missing signature...')
      return
    }
    if (route !== 'gossip') {
      /* prettier-ignore */ if (logFlags.playback) logger.playbackLog(header.sender_id, 'self', 'InternalRecv', route, header.tracker_id, requestPayload)
    }

    //mark that we got a message from this node (for isNodeUpRecent)
    setIsUpTs(header.sender_id) //is this correct?

    await handler(requestPayload, respondWrapped, header, sign)

    if (!hasHandlerResponded && isAskRoute(route)) {
      nestedCountersInstance.countEvent('comms-route', `no-response`)
      nestedCountersInstance.countEvent('comms-route', `no-response ${route}`)
      const wrappedError = responseSerializer(
        InternalError('Handler failed to respond'),
        serializeResponseError
      )
      const responseHeaders: AppHeader = {}
      responseHeaders.sender_id = Self.id
      responseHeaders.tracker_id = header.tracker_id
      await respond(wrappedError.getBuffer(), responseHeaders)
    }
  }
  network.registerInternal(route, wrappedHandler)
}

export function unregisterInternal(route) {
  network.unregisterInternal(route)
}

function sortByID(first, second) {
  return utils.sortAscProp(first, second, 'id')
}

export function isNodeValidForInternalMessage(
  node: P2P.NodeListTypes.Node,
  debugMsg: string,
  checkForNodeDown = true,
  checkForNodeLost = true,
  checkIsUpRecent = true,
  checkNodesRotationBounds = false,
  txId: string = 'N/A'
): boolean {
  const logErrors = logFlags.debug
  if (node == null) {
    /* prettier-ignore */ if (logFlags.seqdiagram) seqLogger.info(`0x53455103 ${shardusGetTime()} tx:${txId} Note over ${NodeList.activeIdToPartition.get(Self.id)}: validnode ${NodeList.activeIdToPartition.get(node.id)} null`)
    if (logErrors)
      if (logFlags.error)
        /* prettier-ignore */ error(`isNodeValidForInternalMessage node == null ${utils.stringifyReduce(node.id)} ${debugMsg}`)
    return false
  }

  // Some modes are not compatible with doing a valid node check for outgoing messages
  // if that is the case just return true and allow the message
  if (modeAllowsValidNodeChecks() === false) {
    /* prettier-ignore */ if (logFlags.seqdiagram) seqLogger.info(`0x53455103 ${shardusGetTime()} tx:${txId} Note over ${NodeList.activeIdToPartition.get(Self.id)}: validnode ${NodeList.activeIdToPartition.get(node.id)} nochecks`)
    return true
  }

  const nodeStatus = node.status

  // need to consider if these statuses should be allowed for internal messages by this function!
  // maybe we are doing ourselves a favor by filtering these out.
  // SELECTED = "selected",
  // SYNCING = "syncing",
  // READY = "ready",

  // this could cause different cycle records based on potentiallyRemoved
  // we should create a new if check called checkPotentiallyRemoved and review
  // each calling site (or site that calls the gossip, yay more parameters)

  // Also may add a flag to change if we also allow other statuses
  if (nodeStatus != 'active') {
    /* prettier-ignore */ if (logFlags.seqdiagram) seqLogger.info(`0x53455103 ${shardusGetTime()} tx:${txId} Note over ${NodeList.activeIdToPartition.get(Self.id)}: validnode ${NodeList.activeIdToPartition.get(node.id)} notactive`)
  }
  if (NodeList.potentiallyRemoved.has(node.id)) {
    /* prettier-ignore */ if (logFlags.seqdiagram) seqLogger.info(`0x53455103 ${shardusGetTime()} tx:${txId} Note over ${NodeList.activeIdToPartition.get(Self.id)}: validnode ${NodeList.activeIdToPartition.get(node.id)} remove`)
  }

  // This is turned off and likely to be deleted.
  // This is because filtering gossip nodes after sending the list is causing holes to appear in gossip and some nodes do not get the gossip at all which causes stuck txn.
  // Do not turn this back on without talking to Andrew.
  //
  //if (nodeStatus != 'active' || NodeList.potentiallyRemoved.has(node.id)) {
  //  if (logErrors)
  //    if (logFlags.error)
  //      /* prettier-ignore */ error(`isNodeValidForInternalMessage node not active. ${nodeStatus} ${utils.stringifyReduce(node.id)} ${debugMsg}`)
  //  return false
  //}
  //
  //const isInRotationBounds = checkNodesRotationBounds && isNodeInRotationBounds(node.id)
  //if (isInRotationBounds) {
  //  /* prettier-ignore */ if (logFlags.seqdiagram) seqLogger.info(`0x53455103 ${shardusGetTime()} tx:${txId} Note over ${NodeList.activeIdToPartition.get(Self.id)}: validnode ${NodeList.activeIdToPartition.get(node.id)} rotation`)
  //  return false
  //}

  // check up recent first which will tell us if we have gossip from this node in the last 5 seconds
  // consider a larger amount of time
  if (checkIsUpRecent) {
    const { upRecent, age } = isNodeUpRecent(node.id, 5000)
    if (upRecent === true) {
      if (checkForNodeDown) {
        const { down, state } = isNodeDown(node.id)
        if (down === true) {
          if (logErrors)
            info(
              `isNodeUpRecentOverride: ${age} isNodeValidForInternalMessage isNodeDown == true state:${state} ${utils.stringifyReduce(
                node.id
              )} ${debugMsg}`
            )
        }
      }
      if (checkForNodeLost) {
        if (isNodeLost(node.id) === true) {
          if (logErrors)
            info(
              `isNodeUpRecentOverride: ${age} isNodeValidForInternalMessage isNodeLost == true ${utils.stringifyReduce(
                node.id
              )} ${debugMsg}`
            )
        }
      }
      return true
    } else {
      if (logErrors)
        warn(
          `isNodeUpRecentOverride: ${age} upRecent = false. no recent TX, but this is not a fail conditions`
        )
    }
  }

  if (config.p2p.downNodeFilteringEnabled && checkForNodeDown) {
    const { down, state } = isNodeDown(node.id)
    if (down === true) {
      if (logErrors)
        if (logFlags.error)
          /* prettier-ignore */ error(`isNodeValidForInternalMessage isNodeDown == true state:${state} ${utils.stringifyReduce(node.id)} ${debugMsg}`)
      /* prettier-ignore */ if (logFlags.seqdiagram) seqLogger.info(`0x53455103 ${shardusGetTime()} tx:${txId} Note over ${NodeList.activeIdToPartition.get(Self.id)}: validnode ${NodeList.activeIdToPartition.get(node.id)} down`)
      return false
    }
  }
  if (checkForNodeLost) {
    if (isNodeLost(node.id) === true) {
      if (logErrors)
        if (logFlags.error)
          /* prettier-ignore */ error(`isNodeValidForInternalMessage isNodeLost == true ${utils.stringifyReduce(node.id)} ${debugMsg}`)
      /* prettier-ignore */ if (logFlags.seqdiagram) seqLogger.info(`0x53455103 ${shardusGetTime()} tx:${txId} Note over ${NodeList.activeIdToPartition.get(Self.id)}: validnode ${NodeList.activeIdToPartition.get(node.id)} lost`)
      return false
    }
  }

  return true
}

/**
 * Are we in a mode that should be doing additional "validNode" checks
 * before sending an outgoing message
 * @returns
 */
export function modeAllowsValidNodeChecks() {
  const newestCycle = CycleChain.newest
  if (newestCycle) {
    if (newestCycle.mode === 'processing') {
      return true
    }
    if (newestCycle.mode === 'forming') {
      return true
    }
    // really important to not run these extra checks in the following modes as they can break if they ignore
    // sending gossipe.  the valid node tests may also not have the correct logic to work with these modes
    if (
      Self.isRestartNetwork ||
      newestCycle.mode === 'recovery' ||
      newestCycle.mode === 'restart' ||
      newestCycle.mode === 'restore'
    ) {
      return false
    }
  }
  return true
}

function calculateGossipFactor(numberOfNodes: number): number {
  if (numberOfNodes === 0) return config.p2p.gossipFactor
  function getBaseLog(x: number, y: number) {
    return Math.log(y) / Math.log(x)
  }
  const gossipFactor = Math.ceil(getBaseLog(3, numberOfNodes))
  return gossipFactor
}

/**
 * Send Gossip to all nodes, using gossip in
 */
// [TODO] This function should not sort nodes; they should be pre-sorted
export async function sendGossip(
  type: string,
  payload,
  tracker = '',
  sender = null,
  inpNodes: Shardus.Node[] | Shardus.NodeWithRank[] = NodeList.byIdOrder, // Joining nodes need gossip too; we don't
  // send to ourself
  isOrigin = false,
  factor = -1,
  txId = '',
  context = ''
) {
  //console.log('entered sendGossip gossiping ', type)
  let msgSize = cUninitializedSize
  // [TODO] Don't copy the node list once sorted lists are passed in
  const nodes = [...inpNodes]

  if (nodes.length === 0) {
    /* prettier-ignore */ nestedCountersInstance.countEvent( 'gossip-filter', `no recipients for ${type}` )
    return
  }

  if (tracker === '') {
    tracker = createGossipTracker()
  }

  if (logFlags.verbose && logFlags.p2pNonFatal) {
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
  //console.log('nodeIdxs ', nodeIdxs)
  // Find out your own index in the nodes array
  const myIdx = nodes.findIndex((node) => node.id === Self.id)
  //console.log('myIdx ', myIdx)
  if (myIdx < 0) {
    //console.log(`Failed to sendGossip. Could not find self in nodes array ${type}`)
    // throw new Error('Could not find self in nodes array')
    error(`Failed to sendGossip. Could not find self in nodes array ${type}`)
    return msgSize
  }

  let gossipFactor = config.p2p.gossipFactor
  if (config.p2p.dynamicGossipFactor) {
    gossipFactor = calculateGossipFactor(nodes.length)
  }
  if (factor > 0) {
    gossipFactor = factor
  }
  let recipientIdxs
  let originNode
  let originIdx

  if (payload.sign) {
    originNode = NodeList.byPubKey.get(payload.sign.owner)
    if (originNode) originIdx = nodes.findIndex((node) => node.id === originNode.id)
  }

  //console.log('originIdx ', originIdx)

  if (context != '')
    if (logFlags.seqdiagram)
      /* prettier-ignore */ seqLogger.info(`0x53455103 ${shardusGetTime()} tx:${txId} Note over ${NodeList.activeIdToPartition.get(Self.id)}: gossipContext:${context}`)
  if (originIdx !== undefined && originIdx >= 0) {
    // If it is protocol tx signed by a node in the network
    recipientIdxs = utils.getLinearGossipBurstList(nodeIdxs.length, gossipFactor, myIdx, originIdx)
    if (logFlags.seqdiagram && txId != '') {
      /* prettier-ignore */ if (logFlags.seqdiagram) seqLogger.info(`0x53455103 ${shardusGetTime()} tx:${txId} Note over ${NodeList.activeIdToPartition.get(Self.id)}: gossipBin:${nodeIdxs.length},${gossipFactor},${myIdx},${originIdx}`)
      /* prettier-ignore */ if (logFlags.seqdiagram) seqLogger.info(`0x53455103 ${shardusGetTime()} tx:${txId} Note over ${NodeList.activeIdToPartition.get(Self.id)}: gossipBout:${recipientIdxs}`)
    }
  } else {
    // If it is app tx which is not signed by a node in the network
    recipientIdxs = utils.getLinearGossipList(nodeIdxs.length, gossipFactor, myIdx, isOrigin)
    if (logFlags.seqdiagram && txId != '') {
      /* prettier-ignore */ if (logFlags.seqdiagram) seqLogger.info(`0x53455103 ${shardusGetTime()} tx:${txId} Note over ${NodeList.activeIdToPartition.get(Self.id)}: gossipLin:${nodeIdxs.length},${gossipFactor},${myIdx},${isOrigin}`)
      /* prettier-ignore */ if (logFlags.seqdiagram) seqLogger.info(`0x53455103 ${shardusGetTime()} tx:${txId} Note over ${NodeList.activeIdToPartition.get(Self.id)}: gossipLout:${recipientIdxs}`)
    }
  }

  //console.log('recipientIdxs ', recipientIdxs)

  // Map back recipient idxs to node objects
  let recipients: P2P.NodeListTypes.Node[] = recipientIdxs.map((idx) => nodes[idx])
  if (sender != null) {
    recipients = utils.removeNodesByID(recipients, [sender])
  }
  try {
    //console.log('entered try')
    if (logFlags.verbose && logFlags.p2pNonFatal) {
      info(
        `GossipingIn ${type} request to these nodes: ${utils.stringifyReduce(
          recipients.map((node) => utils.makeShortHash(node.id) + ':' + node.externalPort)
        )}`
      )
    }
    for (const node of recipients) {
      /* prettier-ignore */ if (logFlags.playback) logger.playbackLog('self', node.id, 'GossipInSend', type, tracker, gossipPayload)
      gossipSent++
      gossipTypeSent[type] = gossipTypeSent[type] ? gossipTypeSent[type] + 1 : 1
    }

    if (commsCounters) {
      nestedCountersInstance.countEvent('comms-route', `sendGossip ${type}`, recipients.length)
      /* prettier-ignore */ nestedCountersInstance.countEvent('comms-route x recipients', `sendGossip ${type} recipients: ${recipients.length}`, recipients.length)
      /* prettier-ignore */ nestedCountersInstance.countEvent('comms-recipients', `sendGossip recipients: ${recipients.length}`, recipients.length)
      /* prettier-ignore */ nestedCountersInstance.countEvent('comms-route x recipients (logical count)', `sendGossip ${type} recipients: ${recipients.length}`)
    }

    //console.log('recipients before filter')
    //recipients.forEach(node => console.log(node.externalPort))

    // Filter recipients to only include those that are valid
    if (config.p2p.preGossipNodeCheck) {
      const oldCount = recipients.length
      recipients = recipients.filter((node) => {
        if (
          isNodeValidForInternalMessage(
            node,
            'sendGossip',
            config.p2p.preGossipDownCheck,
            config.p2p.preGossipLostCheck,
            config.p2p.preGossipRecentCheck,
            false,
            txId
          )
        ) {
          return true
        } else {
          /* prettier-ignore */ nestedCountersInstance.countEvent('p2p-skip-send', 'skipping gossip')
          /* prettier-ignore */ nestedCountersInstance.countEvent( 'p2p-skip-send', `skipping gossip ${node.internalIp}:${node.externalPort}` )
          /* prettier-ignore */ if (logFlags.seqdiagram) seqLogger.info(`0x53455103 ${shardusGetTime()} tx:${txId} Note over ${NodeList.activeIdToPartition.get(Self.id)}: gossipSkip:${NodeList.activeIdToPartition.get(node.id)}:${node.internalIp}:${node.externalPort}`)
        }
      })
      const newCount = recipients.length
      if (oldCount != newCount) {
        /* prettier-ignore */ nestedCountersInstance.countEvent('gossip-filter', `filter ${type} oldCount ${oldCount} newCount${newCount}`)
      }
      if (oldCount > 0 && newCount === 0) {
        /* prettier-ignore */ nestedCountersInstance.countEvent( 'gossip-filter', `all recipients removed from ${type} oldCount ${oldCount}` )
      }
    }

    //console.log('recipients after filter')
    //recipients.forEach(node => console.log(node.externalPort))
    if (logFlags.seqdiagram && txId != '') {
      let prefix = ''
      let suffix = ''
      if (isOrigin) prefix = 'orig:'
      if (context != '') suffix = `:${suffix}`
      for (const node of recipients) {
        /* prettier-ignore */ if (logFlags.seqdiagram) seqLogger.info(`0x53455103 ${shardusGetTime()} tx:${txId} ${NodeList.activeIdToPartition.get(Self.id)}-->>${NodeList.activeIdToPartition.get(node.id)}: g:${prefix}${type}${suffix}`)
      }
    }

    if (config.p2p.useBinarySerializedEndpoints === true) {
      msgSize = await tellBinary<GossipReqBinary>(
        recipients,
        InternalRouteEnum.binary_gossip,
        gossipPayload,
        serializeGossipReq,
        {
          tracker_id: tracker,
        },
        true,
        tracker
      )
    } else {
      msgSize = await tell(recipients, 'gossip', gossipPayload, true, tracker, type)
    }
  } catch (ex) {
    //console.log('entered catch ', ex)
    if (logFlags.verbose) {
      error(`Failed to sendGossip(${type}, ${utils.stringifyReduce(payload)}) Exception => ${ex}`)
    }
    fatal(`sendGossipIn: ${type}: ` + ex.name + ': ' + ex.message + ' at ' + ex.stack)
  }
  // gossipedHashesSent.set(gossipHash, currentCycle)    // No longer used
  if (logFlags.verbose && logFlags.p2pNonFatal) {
    info(`End of sendGossipIn(${utils.stringifyReduce(payload)})`)
  }
  return msgSize
}

export async function sendGossipAll(
  type: string,
  payload,
  tracker = '',
  sender = null,
  inpNodes = NodeList.byIdOrder // Joining nodes need gossip too; we don't send to ourself
) {
  let msgSize = cUninitializedSize

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
  if (myIdx < 0) {
    // throw new Error('Could not find self in nodes array')
    error(`Failed to sendGossip. Could not find self in nodes array ${type}`)
    return msgSize
  }

  let recipients = nodes
  if (sender != null) {
    recipients = utils.removeNodesByID(recipients, [sender])
  }
  try {
    if (logFlags.verbose) {
      p2pLogger.debug(
        `GossipingIn ${type} request to these nodes: ${utils.stringifyReduce(
          recipients.map((node) => utils.makeShortHash(node.id) + ':' + node.externalPort)
        )}`
      )
    }
    for (const node of recipients) {
      /* prettier-ignore */ if (logFlags.playback) logger.playbackLog('self', node.id, 'GossipInSend', type, tracker, gossipPayload)
    }

    if (commsCounters) {
      nestedCountersInstance.countEvent('comms-route', `sendGossipAll ${type}`, recipients.length)
      /* prettier-ignore */ nestedCountersInstance.countEvent('comms-route x recipients', `sendGossipAll ${type} recipients: ${recipients.length}`, recipients.length)
      /* prettier-ignore */ nestedCountersInstance.countEvent('comms-recipients', `sendGossipAll recipients: ${recipients.length}`, recipients.length)
      /* prettier-ignore */ nestedCountersInstance.countEvent('comms-route x recipients (logical count)', `sendGossipAll ${type} recipients: ${recipients.length}`)
    }

    // Filter recipients to only include those that are valid
    if (config.p2p.preGossipNodeCheck) {
      recipients = recipients.filter((node) => {
        if (
          isNodeValidForInternalMessage(
            node,
            'sendGossip',
            config.p2p.preGossipDownCheck,
            config.p2p.preGossipLostCheck,
            config.p2p.preGossipRecentCheck
          )
        ) {
          return true
        } else {
          nestedCountersInstance.countEvent('p2p-skip-send', 'skipping gossip')
          nestedCountersInstance.countEvent(
            'p2p-skip-send',
            `skipping gossip ${node.internalIp}:${node.externalPort}`
          )
        }
      })
    }

    msgSize = await tell(recipients, 'gossip', gossipPayload, true, tracker, type)
  } catch (ex) {
    if (logFlags.verbose) {
      p2pLogger.error(`Failed to sendGossip(${type} ${utils.stringifyReduce(payload)}) Exception => ${ex}`)
    }
    p2pLogger.fatal(`sendGossipIn: ${type}:` + ex.name + ': ' + ex.message + ' at ' + ex.stack)
  }
  //gossipedHashesSent.set(gossipHash, false)
  if (logFlags.verbose) {
    p2pLogger.debug(`End of sendGossipIn(${utils.stringifyReduce(payload)})`)
  }
  return msgSize
}

/**
 * Handle Goosip Transactions
 * Payload: {type: ['receipt', 'trustedTransaction'], data: {}}
 */
export async function handleGossip(payload, sender, tracker = '', msgSize = cNoSizeTrack) {
  if (logFlags.verbose && logFlags.p2pNonFatal) {
    info(`Start of handleGossip(${utils.stringifyReduce(payload)})`)
  }

  const err = utils.validateTypes(payload, { type: 's', data: 'o' })
  if (err) {
    warn('handleGossip: bad payload: ' + err)
    return
  }

  // Simulating bad network by dropping received gossip
  //   set the propability of dropping to a number between 0 to 1
  // if (Math.random() < 0.0) {
  //   warn('Dropped gossip to simulate bad network')
  //   return
  // }

  const type = payload.type
  const data = payload.data

  const gossipHandler = gossipHandlers[type]
  if (!gossipHandler) {
    warn(`Gossip Handler not found: type ${type}, data: ${Utils.safeStringify(data)}`)
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

  //mark that we got a message from this node (for isNodeUpRecent)
  setIsUpTs(sender) //may not need this since gossip is goes through the internal route, and that now flags this

  gossipRecv++
  gossipTypeRecv[type] = gossipTypeRecv[type] ? gossipTypeRecv[type] + 1 : 1
  /* prettier-ignore */ if (logFlags.playback) logger.playbackLog(sender, 'self', 'GossipRcv', type, tracker, data)
  // [TODO] - maybe we don't need to await the following line
  await gossipHandler(data, sender, tracker, msgSize)
  if (logFlags.verbose && logFlags.p2pNonFatal) {
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
  if (logFlags.p2pNonFatal) {
    info(`Total  gossipSent:${gossipSent} gossipRecv:${gossipRecv}`)
    info(`Sent gossip by type: ${Utils.safeStringify(gossipTypeSent)}`)
    info(`Recv gossip by type: ${Utils.safeStringify(gossipTypeRecv)}`)
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
