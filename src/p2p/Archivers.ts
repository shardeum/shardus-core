import { P2P, StateManager } from '@shardus/types'
import deepmerge from 'deepmerge'
import * as http from '../http'
import { logFlags } from '../logger'
import {
  getReceiptHashes,
  getReceiptMap,
  getStateHashes,
  getSummaryBlob,
  getSummaryHashes,
} from '../snapshot'
import { shuffleMapIterator, validateTypes } from '../utils'
import { nestedCountersInstance } from '../utils/nestedCounters'
import { profilerInstance } from '../utils/profiler'
import * as Comms from './Comms'
import * as Context from './Context'
import { isInvalidIP, isBogonIP } from '../utils/functions/checkIP'
import { config, crypto, io, logger, network, stateManager } from './Context'
import { computeCycleMarker, getCycleChain } from './CycleChain'
import * as CycleCreator from './CycleCreator'
import * as NodeList from './NodeList'
import Timeout = NodeJS.Timeout
import { apoptosizeSelf } from './Apoptosis'
import { randomInt } from 'crypto'
import { CycleRecord } from '@shardus/types/build/src/p2p/CycleCreatorTypes'
import { StateMetaData } from '@shardus/types/build/src/p2p/SnapshotTypes'
import { DataRequest } from '@shardus/types/build/src/p2p/ArchiversTypes'

/** STATE */

let p2pLogger

export let archivers: Map<P2P.ArchiversTypes.JoinedArchiver['publicKey'], P2P.ArchiversTypes.JoinedArchiver>
// TODO: Update any with appropriate type
export let recipients: Map<
  P2P.ArchiversTypes.JoinedArchiver['publicKey'],
  P2P.ArchiversTypes.DataRecipient | any
>

let joinRequests: P2P.ArchiversTypes.Request[]
let leaveRequests: P2P.ArchiversTypes.Request[]
let receiptForwardInterval: Timeout | null = null
let networkCheckInterval: Timeout | null = null
let networkCheckInProgress = false
export let connectedSockets = {}
let lastSentCycle = -1
let maxArchiversSupport = 2 // Make this as part of the network config

export enum DataRequestTypes {
  SUBSCRIBE = 'SUBSCRIBE',
  UNSUBSCRIBE = 'UNSUBSCRIBE',
}

// This is to check if the new archiver data subscriptions feature is activated in shardeum v1.1.3
// We can remove later after v1.1.3 upgrade
export let archiverDataSubscriptionsUpdateFeatureActivated = false

/** FUNCTIONS */

/** CycleCreator Functions */

export function init() {
  console.log('init archiver module')
  p2pLogger = logger.getLogger('p2p')

  archivers = new Map()
  recipients = new Map()

  reset()
  resetLeaveRequests()
  registerRoutes()

  if (config.p2p.experimentalSnapshot && !receiptForwardInterval) {
    receiptForwardInterval = setInterval(forwardReceipts, 10000)
  }

  if (config.p2p.checkNetworkStopped) {
    setTimeout(() => {
      networkCheckInterval = setInterval(() => {
        hasNetworkStopped().then((stopped) => {
          if (stopped) {
            const msg = 'checkNetworkStopped: Network has stopped. Initiating apoptosis'
            info(msg)
            apoptosizeSelf(msg)
          }
        })
      }, 1000 * 60 * 5) // Check every 5 min
    }, randomInt(1000 * 60, 1000 * 60 * 5)) // Stagger initial checks between 1-5 min
  }
}

export function reset() {
  resetJoinRequests()
}

export function getTxs(): P2P.ArchiversTypes.Txs {
  // [IMPORTANT] Must return a copy to avoid mutation
  const requestsCopy = deepmerge({}, [...joinRequests, ...leaveRequests])
  if (logFlags.console)
    console.log(`getTxs: Cycle ${CycleCreator.currentCycle}, Quarter: ${CycleCreator.currentQuarter}`, {
      archivers: requestsCopy,
    })

  return {
    archivers: requestsCopy,
  }
}

export function validateRecordTypes(rec: P2P.ArchiversTypes.Record): string {
  let err = validateTypes(rec, { joinedArchivers: 'a' })
  if (err) return err
  for (const item of rec.joinedArchivers) {
    err = validateTypes(item, {
      publicKey: 's',
      ip: 's',
      port: 'n',
      curvePk: 's',
    })
    if (err) return 'in joinedArchivers array ' + err
  }
  return ''
}

export function updateRecord(txs: P2P.ArchiversTypes.Txs, record: P2P.CycleCreatorTypes.CycleRecord) {
  // Add joining archivers to the cycle record
  const joinedArchivers = txs.archivers
    .filter((request) => request.requestType === P2P.ArchiversTypes.RequestTypes.JOIN)
    .map((joinRequest) => joinRequest.nodeInfo)

  // Add leaving archivers to the cycle record
  const leavingArchivers = txs.archivers
    .filter((request) => request.requestType === P2P.ArchiversTypes.RequestTypes.LEAVE)
    .map((leaveRequest) => leaveRequest.nodeInfo)

  if (logFlags.console)
    console.log(
      `Archiver before updating record: Cycle ${CycleCreator.currentCycle}, Quarter: ${CycleCreator.currentQuarter}`,
      joinedArchivers,
      leavingArchivers
    )

  record.joinedArchivers = joinedArchivers.sort(
    (a: P2P.ArchiversTypes.JoinedArchiver, b: P2P.ArchiversTypes.JoinedArchiver) =>
      a.publicKey > b.publicKey ? 1 : -1
  )
  record.leavingArchivers = leavingArchivers.sort(
    (a: P2P.ArchiversTypes.JoinedArchiver, b: P2P.ArchiversTypes.JoinedArchiver) =>
      a.publicKey > b.publicKey ? 1 : -1
  )
  if (logFlags.console)
    console.log(
      `Archiver after updating record: Cycle ${CycleCreator.currentCycle}, Quarter: ${CycleCreator.currentQuarter}`,
      record
    )

  // resetLeaveRequests()
}

export function parseRecord(record: P2P.CycleCreatorTypes.CycleRecord): P2P.CycleParserTypes.Change {
  // Update our archivers list
  updateArchivers(record)

  // Since we don't touch the NodeList, return an empty Change
  return {
    added: [],
    removed: [],
    updated: [],
  }
}

/** Not used by Archivers */
export function sendRequests() {}

/** Not used by Archivers */
export function queueRequest() {}

/** Original Functions */

export function resetJoinRequests() {
  joinRequests = []
}

export function resetLeaveRequests() {
  leaveRequests = []
}

export function addArchiverJoinRequest(joinRequest: P2P.ArchiversTypes.Request, tracker?, gossip = true) {
  // validate input
  let err = validateTypes(joinRequest, { nodeInfo: 'o', requestType: 's', sign: 'o' })
  if (err) {
    warn('addJoinRequest: bad joinRequest ' + err)
    return { success: false, reason: 'bad joinRequest ' + err }
  }
  err = validateTypes(joinRequest.nodeInfo, {
    curvePk: 's',
    ip: 's',
    port: 'n',
    publicKey: 's',
  })
  if (err) {
    warn('addJoinRequest: bad joinRequest.nodeInfo ' + err)
    return { success: false, reason: 'bad joinRequest ' + err }
  }
  if (joinRequest.requestType !== P2P.ArchiversTypes.RequestTypes.JOIN) {
    warn('addJoinRequest: invalid joinRequest.requestType')
    return { success: false, reason: 'invalid joinRequest.requestType' }
  }
  err = validateTypes(joinRequest.sign, { owner: 's', sig: 's' })
  if (err) {
    warn('addJoinRequest: bad joinRequest.sign ' + err)
    return { success: false, reason: 'bad joinRequest.sign ' + err }
  }
  if (!crypto.verify(joinRequest, joinRequest.nodeInfo.publicKey)) {
    warn('addJoinRequest: bad signature')
    return { success: false, reason: 'bad signature ' }
  }
  if (archivers.get(joinRequest.nodeInfo.publicKey)) {
    warn('addJoinRequest: This archiver is already in the active archiver list')
    return { success: false, reason: 'This archiver is already in the active archiver list' }
  }
  const existingJoinRequest = joinRequests.find(
    (j) => j.nodeInfo.publicKey === joinRequest.nodeInfo.publicKey
  )
  if (existingJoinRequest) {
    warn('addJoinRequest: This archiver join request already exists')
    return { success: false, reason: 'This archiver join request already exists' }
  }
  if (Context.config.p2p.forceBogonFilteringOn) {
    if (isBogonIP(joinRequest.nodeInfo.ip)) {
      warn('addJoinRequest: This archiver join request uses a bogon IP')
      return { success: false, reason: 'This archiver join request is a bogon IP' } 
    } 
  } 
  joinRequests.push(joinRequest)
  if (logFlags.console)
    console.log(
      `Join request added in cycle ${CycleCreator.currentCycle}, quarter ${CycleCreator.currentQuarter}`,
      joinRequest
    )
  if (gossip === true) {
    Comms.sendGossip('joinarchiver', joinRequest, tracker, null, NodeList.byIdOrder, true)
  }
  return { success: true }
}

export function addLeaveRequest(leaveRequest: P2P.ArchiversTypes.Request, tracker?, gossip = true) {
  // validate input
  let err = validateTypes(leaveRequest, { nodeInfo: 'o', requestType: 's', sign: 'o' })
  if (err) {
    warn('addLeaveRequest: bad leaveRequest ' + err)
    return { success: false, reason: 'bad leaveRequest ' + err }
  }
  err = validateTypes(leaveRequest.nodeInfo, {
    curvePk: 's',
    ip: 's',
    port: 'n',
    publicKey: 's',
  })
  if (err) {
    warn('addLeaveRequest: bad leaveRequest.nodeInfo ' + err)
    return { success: false, reason: 'bad leaveRequest.nodeInfo ' + err }
  }
  if (leaveRequest.requestType !== P2P.ArchiversTypes.RequestTypes.LEAVE) {
    warn('addLeaveRequest: invalid leaveRequest.requestType')
    return { success: false, reason: 'invalid leaveRequest.requestType' }
  }
  err = validateTypes(leaveRequest.sign, { owner: 's', sig: 's' })
  if (err) {
    warn('addLeaveRequest: bad leaveRequest.sign ' + err)
    return { success: false, reason: 'bad leaveRequest.sign ' + err }
  }
  if (!crypto.verify(leaveRequest, leaveRequest.nodeInfo.publicKey)) {
    warn('addLeaveRequest: bad signature')
    return { success: false, reason: 'bad signature' }
  }

  if (!archivers.get(leaveRequest.nodeInfo.publicKey)) {
    warn(
      'addLeaveRequest: Not a valid archiver to be sending leave request, archiver was not found in active archiver list'
    )
    return {
      success: false,
      reason:
        'Not a valid archiver to be sending leave request, archiver was not found in active archiver list',
    }
  }
  const existingLeaveRequest = leaveRequests.find(
    (j) => j.nodeInfo.publicKey === leaveRequest.nodeInfo.publicKey
  )
  if (existingLeaveRequest) {
    warn('addLeaveRequest: This archiver leave request already exists')
    return { success: false, reason: 'This archiver leave request already exists' }
  }
  leaveRequests.push(leaveRequest)
  if (logFlags.console) console.log('adding leave requests', leaveRequests)
  if (gossip === true) {
    Comms.sendGossip('leavingarchiver', leaveRequest, tracker, null, NodeList.byIdOrder, true)
  }
  return { success: true }
}

export function getArchiverUpdates() {
  return joinRequests
}

export function updateArchivers(record) {
  // Update archiversList
  for (const nodeInfo of record.leavingArchivers) {
    archivers.delete(nodeInfo.publicKey)
    removeDataRecipient(nodeInfo.publicKey)
    removeArchiverConnection(nodeInfo.publicKey)
    leaveRequests = leaveRequests.filter((request) => request.nodeInfo.publicKey !== nodeInfo.publicKey)
  }
  for (const nodeInfo of record.joinedArchivers) {
    archivers.set(nodeInfo.publicKey, nodeInfo)
  }
}

// Add data type of dataRequests used in experimentalSnapshot
export function addDataRecipient(
  nodeInfo: P2P.ArchiversTypes.JoinedArchiver,
  dataRequests: { dataRequestCycle?: number } | DataRequest<CycleRecord | StateMetaData>[]
) {
  if (logFlags.console) console.log('Adding data recipient..', arguments)
  if (config.p2p.experimentalSnapshot && config.features.archiverDataSubscriptionsUpdate) {
    // This is to flush out previous archiver connections when it first activated
    if (!archiverDataSubscriptionsUpdateFeatureActivated) {
      console.log('archiverDataSubscriptionsUpdateFeatureActivated', connectedSockets, recipients)
      for (const [key, value] of Object.entries(connectedSockets)) {
        removeArchiverConnection(key)
      }
      for (const [key, value] of recipients) {
        recipients.delete(key)
      }
      archiverDataSubscriptionsUpdateFeatureActivated = true
      console.log('archiverDataSubscriptionsUpdateFeatureActivated', connectedSockets, recipients)
    }
    const recipient = {
      nodeInfo,
      dataRequestCycle: dataRequests['dataRequestCycle'],
      curvePk: crypto.convertPublicKeyToCurve(nodeInfo.publicKey),
    }
    if (lastSentCycle > recipient.dataRequestCycle) {
      // If the dataRequestCycle is behind many cycles, Set it to 10 cycles before the current cycle
      if (lastSentCycle - recipient.dataRequestCycle > 10) lastSentCycle = lastSentCycle - 10
      else lastSentCycle = recipient.dataRequestCycle
    }
    if (logFlags.console) console.log(`dataRequests: ${nodeInfo.ip}:${nodeInfo.port}`)
    recipients.set(nodeInfo.publicKey, recipient)
    return
  }
  const recipient = {
    nodeInfo,
    // TODO: dataRequest should be an array
    dataRequests: dataRequests,
    curvePk: crypto.convertPublicKeyToCurve(nodeInfo.publicKey),
  }
  if (logFlags.console) console.log('dataRequests: ', recipient.dataRequests)
  recipients.set(nodeInfo.publicKey, recipient)
}

async function forwardReceipts() {
  if (!config.p2p.experimentalSnapshot) return

  profilerInstance.scopedProfileSectionStart('forwardReceipts')

  // TODO: add a new type for receipt
  const responses: any = {}
  responses.RECEIPT = stateManager.transactionQueue.getReceiptsToForward()
  if (recipients.size > 0) {
    for (const receipt of responses.RECEIPT) {
      // console.log('forwarded receipt', receipt.tx.txId)
      if (!stateManager.transactionQueue.forwardedReceipts.has(receipt.tx.txId)) {
        stateManager.transactionQueue.forwardedReceipts.set(receipt.tx.txId, true)
      }
    }
  }
  for (const [publicKey, recipient] of recipients) {
    const dataResponse: P2P.ArchiversTypes.DataResponse = {
      publicKey: crypto.getPublicKey(),
      responses,
      recipient: publicKey,
    }

    nestedCountersInstance.countEvent('Archiver', 'forwardReceipts', responses.RECEIPT.length)

    // Tag dataResponse
    const taggedDataResponse = crypto.tag(dataResponse, recipient.curvePk)
    if (logFlags.console) console.log('Sending receipts to archivers', taggedDataResponse)
    try {
      if (io.sockets.sockets[connectedSockets[publicKey]]) {
        if (logFlags.console)
          console.log('forwarded Archiver', recipient.nodeInfo.ip + ':' + recipient.nodeInfo.port)
        io.sockets.sockets[connectedSockets[publicKey]].emit('DATA', taggedDataResponse)
      } else warn(`Subscribed Archiver ${publicKey} is not connected over socket connection`)
    } catch (e) {
      error('Run into issue in forwarding receipts data', e)
    }
  }

  stateManager.transactionQueue.resetReceiptsToForward()

  profilerInstance.scopedProfileSectionEnd('forwardReceipts')
}

/**
 * This function is used by the checkNetworkStopped feature to check if the
 * network is down by checking if all Archivers are down. If so, it causes
 * the node to apoptosize itself.
 */
async function hasNetworkStopped() {
  // If network check still in progress, return
  if (networkCheckInProgress) return
  networkCheckInProgress = true

  // Get a randomized list of all Archivers
  const shuffledArchivers = shuffleMapIterator(archivers)

  // Loop through them and check their /nodelist endpoint for a response
  for (const archiver of shuffledArchivers) {
    try {
      const response = await http.get(`http://${archiver.ip}:${archiver.port}/nodelist`)

      // If any one of them responds, return
      if (response.data) return false
    } catch (error) {
      warn(`hasNetworkStopped: Archiver ${archiver.ip}:${archiver.port} is down`)
    }
  }

  // If all of them do not respond, initiate apoptosis
  return true
}

export interface InitialAccountsData {
  accounts: any[]
  receipts: any[]
}

export async function forwardAccounts(data: InitialAccountsData) {
  if (!config.p2p.experimentalSnapshot) return
  const responses: any = {}
  responses.ACCOUNT = data
  if (recipients.size === 0) {
    console.log('No Connected Archiver To Forward!')
  }
  for (const [publicKey, recipient] of recipients) {
    const dataResponse: P2P.ArchiversTypes.DataResponse = {
      publicKey: crypto.getPublicKey(),
      responses,
      recipient: publicKey,
    }

    // Tag dataResponse
    const taggedDataResponse = crypto.tag(dataResponse, recipient.curvePk)
    if (logFlags.console) console.log('Sending accounts to archivers', taggedDataResponse)
    try {
      if (io.sockets.sockets[connectedSockets[publicKey]]) {
        io.sockets.sockets[connectedSockets[publicKey]].emit('DATA', taggedDataResponse)
        console.log(`forward Accounts Successfully`)
      }
    } catch (e) {
      error('Run into error in forwarding accounts', e)
    }
  }
}

export function removeDataRecipient(publicKey) {
  if (recipients.has(publicKey)) {
    if (logFlags.console) console.log('Removing data recipient', publicKey)
    recipients.delete(publicKey)
  } else {
    if (logFlags.console) console.log(`Data recipient ${publicKey} is already removed`)
  }
}

export function sendData() {
  if (logFlags.console) console.log('Recient List before sending data')
  if (logFlags.console) console.log(recipients)
  const responses: P2P.ArchiversTypes.DataResponse['responses'] = {}
  if (config.p2p.experimentalSnapshot && config.features.archiverDataSubscriptionsUpdate) {
    if (recipients.size === 0) {
      lastSentCycle = CycleCreator.currentCycle
      return
    }
    // Get latest cycles since lastSentCycle
    const cycleRecords = getCycleChain(lastSentCycle + 1)
    const cyclesWithMarker = []
    for (let i = 0; i < cycleRecords.length; i++) {
      if (logFlags.console)
        console.log('cycleRecords counter to sent to the archiver', cycleRecords[i].counter)
      cyclesWithMarker.push({
        ...cycleRecords[i],
        marker: computeCycleMarker(cycleRecords[i]),
      })
    }
    // Update lastSentCycle
    if (cyclesWithMarker.length > 0) {
      lastSentCycle = cyclesWithMarker[cyclesWithMarker.length - 1].counter
    }
    // Add to responses
    responses.CYCLE = cyclesWithMarker
    for (const [publicKey, recipient] of recipients) {
      const dataResponse: P2P.ArchiversTypes.DataResponse = {
        publicKey: crypto.getPublicKey(),
        responses,
        recipient: publicKey,
      }
      // Tag dataResponse
      const taggedDataResponse = crypto.tag(dataResponse, recipient.curvePk)
      try {
        // console.log('connected socketes', publicKey, connectedSockets)
        if (io.sockets.sockets[connectedSockets[publicKey]])
          io.sockets.sockets[connectedSockets[publicKey]].emit('DATA', taggedDataResponse)
        else warn(`Subscribed Archiver ${publicKey} is not connected over socket connection`)
      } catch (e) {
        error('Run into issue in forwarding cycles data', e)
      }
    }
    return
  }
  for (const [publicKey, recipient] of recipients) {
    // const recipientUrl = `http://${recipient.nodeInfo.ip}:${recipient.nodeInfo.port}/newdata`
    const responses: P2P.ArchiversTypes.DataResponse['responses'] = {}

    for (const request of recipient.dataRequests) {
      switch (request.type) {
        case P2P.SnapshotTypes.TypeNames.CYCLE: {
          // Identify request type
          const typedRequest = request as P2P.ArchiversTypes.DataRequest<
            P2P.SnapshotTypes.NamesToTypes['CYCLE']
          >
          // Get latest cycles since lastData
          const cycleRecords = getCycleChain(typedRequest.lastData + 1)
          const cyclesWithMarker = []
          for (let i = 0; i < cycleRecords.length; i++) {
            cyclesWithMarker.push({
              ...cycleRecords[i],
              marker: computeCycleMarker(cycleRecords[i]),
            })
          }
          // Update lastData
          if (cyclesWithMarker.length > 0) {
            typedRequest.lastData = cyclesWithMarker[cyclesWithMarker.length - 1].counter
          }
          // Add to responses
          responses.CYCLE = cyclesWithMarker
          break
        }
        case P2P.SnapshotTypes.TypeNames.STATE_METADATA: {
          // Identify request type
          const typedRequest = request as P2P.ArchiversTypes.DataRequest<
            P2P.SnapshotTypes.NamesToTypes['STATE_METADATA']
          >
          if (logFlags.console) console.log('STATE_METADATA typedRequest', typedRequest)
          // Get latest state hash data since lastData
          const stateHashes = getStateHashes(typedRequest.lastData + 1)
          const receiptHashes = getReceiptHashes(typedRequest.lastData + 1)
          const summaryHashes = getSummaryHashes(typedRequest.lastData + 1)
          // Update lastData
          if (stateHashes.length > 0) {
            typedRequest.lastData = stateHashes[stateHashes.length - 1].counter
          }

          const metadata: P2P.SnapshotTypes.StateMetaData = {
            counter: typedRequest.lastData >= 0 ? typedRequest.lastData : 0,
            stateHashes,
            receiptHashes,
            summaryHashes,
          }
          // console.log('Metadata to send', metadata)
          // console.log('Metadata to send: summary hashes', summaryHashes)
          // Add to responses
          responses.STATE_METADATA = [metadata]
          break
        }
        default:
      }
    }
    const dataResponse: P2P.ArchiversTypes.DataResponse = {
      publicKey: crypto.getPublicKey(),
      responses,
      recipient: publicKey,
    }

    // Tag dataResponse
    const taggedDataResponse = crypto.tag(dataResponse, recipient.curvePk)

    // if(logFlags.console) {
    //   console.log(
    //     `Sending data for cycle ${
    //       getNewest().counter
    //     } to archiver ${recipientUrl}`,
    //     recipient.curvePk
    //   )
    // }
    try {
      // console.log('connected socketes', publicKey, connectedSockets)
      if (io.sockets.sockets[connectedSockets[publicKey]])
        io.sockets.sockets[connectedSockets[publicKey]].emit('DATA', taggedDataResponse)
      else warn(`Subscribed Archiver ${publicKey} is not connected over socket connection`)
    } catch (e) {
      error('Run into issue in forwarding cycles data', e)
    }

    // http
    //   .post(recipientUrl, taggedDataResponse)
    //   .then((dataKeepAlive) => {
    //     if (dataKeepAlive.keepAlive === false) {
    //       // Remove recipient from dataRecipients
    //       removeDataRecipient(recipient.nodeInfo.publicKey)
    //     }
    //   })
    //   .catch((err) => {
    //     // Remove recipient from dataRecipients
    //     warn('Error sending data to dataRecipient.', err)
    //     removeDataRecipient(recipient.nodeInfo.publicKey)
    //   })
  }
}

export function getRefreshedArchivers(record) {
  let refreshedArchivers = [...archivers.values()]
  // if (leaveRequests.length > 0) {
  //   for (const archiverInfo of leaveRequests) {
  //     refreshedArchivers = refreshedArchivers.filter(
  //       (archiver) => archiver.publicKey !== archiverInfo.nodeInfo.publicKey
  //     )
  //   }
  // }
  if (record.leavingArchivers) {
    for (const archiverInfo of record.leavingArchivers) {
      refreshedArchivers = refreshedArchivers.filter(
        (archiver) => archiver.publicKey !== archiverInfo.publicKey
      )
    }
  }
  return refreshedArchivers
}

export function addArchiverConnection(publicKey, socketId) {
  connectedSockets[publicKey] = socketId
}

export function removeArchiverConnection(publicKey) {
  if (io.sockets.sockets[connectedSockets[publicKey]]) {
    io.sockets.sockets[connectedSockets[publicKey]].disconnect()
  }
  delete connectedSockets[publicKey]
}

export function registerRoutes() {
  network.registerExternalPost('joinarchiver', async (req, res) => {
    const err = validateTypes(req, { body: 'o' })
    if (err) {
      warn(`joinarchiver: bad req ${err}`)
      return res.json({ success: false, error: err })
    }

    const joinRequest = req.body
    if (logFlags.p2pNonFatal) info(`Archiver join request received: ${JSON.stringify(joinRequest)}`)

    const accepted = await addArchiverJoinRequest(joinRequest)
    if (!accepted.success) {
      warn('Archiver join request not accepted.')
      return res.json({ success: false, error: `Archiver join request rejected! ${accepted.reason}` })
    }
    if (logFlags.p2pNonFatal) info('Archiver join request accepted!')
    return res.json({ success: true })
  })

  network.registerExternalPost('leavingarchivers', async (req, res) => {
    const err = validateTypes(req, { body: 'o' })
    if (err) {
      warn(`leavingarchivers: bad req ${err}`)
      return res.json({ success: false, error: err })
    }

    const leaveRequest = req.body
    if (logFlags.p2pNonFatal) info(`Archiver leave request received: ${JSON.stringify(leaveRequest)}`)

    const accepted = await addLeaveRequest(leaveRequest)
    if (!accepted.success) {
      warn('Archiver leave request not accepted.')
      return res.json({ success: false, error: `Archiver leave request rejected! ${accepted.reason}` })
    }
    if (logFlags.p2pNonFatal) info('Archiver leave request accepted!')
    return res.json({ success: true })
  })
  Comms.registerGossipHandler('joinarchiver', async (payload, sender, tracker) => {
    profilerInstance.scopedProfileSectionStart('joinarchiver')
    try {
      if (logFlags.console) console.log('Join request gossip received:', payload)
      const accepted = await addArchiverJoinRequest(payload, tracker, false)
      if (logFlags.console) {
        console.log('This join request is new. Should forward the join request')
        console.log('join request gossip accepted', accepted)
      }
      if (!accepted.success) return warn('Archiver join request not accepted.')
      if (logFlags.p2pNonFatal) info('Archiver join request accepted!')
      Comms.sendGossip('joinarchiver', payload, tracker, sender, NodeList.byIdOrder, false)
    } finally {
      profilerInstance.scopedProfileSectionEnd('joinarchiver')
    }
  })

  Comms.registerGossipHandler('leavingarchiver', async (payload, sender, tracker) => {
    if (payload === undefined || payload === null) return warn('Archiver leave payload empty.')
    if (sender === undefined || sender === null) return warn('Archiver leave sender empty.')
    if (tracker === undefined || tracker === null) return warn('Archiver leave tracker empty.')
    profilerInstance.scopedProfileSectionStart('leavingarchiver')
    try {
      if (NodeList.nodes.get(sender) == null) {
        return warn('Archiver leave gossip came from invalid consensor')
      }
      if (logFlags.console) console.log('Leave request gossip received:', payload)
      const accepted = await addLeaveRequest(payload, tracker, false)
      if (!accepted.success) return warn('Archiver leave request not accepted.')
      if (logFlags.p2pNonFatal) info('Archiver leave request accepted!')
      Comms.sendGossip('leavingarchiver', payload, tracker, sender, NodeList.byIdOrder, false)
    } finally {
      profilerInstance.scopedProfileSectionEnd('leavingarchiver')
    }
  })

  network.registerExternalPost('requestdata', (req, res) => {
    let err = validateTypes(req, { body: 'o' })
    if (err) {
      warn(`requestdata: bad req ${err}`)
      return res.json({ success: false, error: err })
    }
    err = validateTypes(req.body, {
      tag: 's',
    })
    if (err) {
      warn(`requestdata: bad req.body ${err}`)
      return res.json({ success: false, error: err })
    }

    const dataRequest = req.body
    if (logFlags.p2pNonFatal) info('dataRequest received', JSON.stringify(dataRequest))

    const foundArchiver = archivers.get(dataRequest.publicKey)

    if (!foundArchiver) {
      const archiverNotFoundErr = 'Archiver not found in list'
      warn(archiverNotFoundErr)
      return res.json({ success: false, error: archiverNotFoundErr })
    }

    const invalidTagErr = 'Tag is invalid'
    const archiverCurvePk = crypto.convertPublicKeyToCurve(foundArchiver.publicKey)
    if (!crypto.authenticate(dataRequest, archiverCurvePk)) {
      warn(invalidTagErr)
      return res.json({ success: false, error: invalidTagErr })
    }

    info('Tag in data request is valid')
    if (config.p2p.experimentalSnapshot && config.features.archiverDataSubscriptionsUpdate) {
      if (dataRequest.dataRequestType === DataRequestTypes.SUBSCRIBE) {
        // if the archiver is already in the recipients list, remove it first
        if (dataRequest.nodeInfo && recipients.has(dataRequest.nodeInfo.publicKey)) {
          removeArchiverConnection(dataRequest.nodeInfo.publicKey)
          recipients.delete(dataRequest.nodeInfo.publicKey)
        }
        if (recipients.size >= maxArchiversSupport) {
          const maxArchiversSupportErr = 'Max archivers support reached'
          warn(maxArchiversSupportErr)
          return res.json({ success: false, error: maxArchiversSupportErr })
        }
        addDataRecipient(dataRequest.nodeInfo, dataRequest)
      }
      if (dataRequest.dataRequestType === DataRequestTypes.UNSUBSCRIBE) {
        removeDataRecipient(dataRequest.publicKey)
        removeArchiverConnection(dataRequest.publicKey)
      }
      return res.json({ success: true })
    }

    delete dataRequest.publicKey
    delete dataRequest.tag

    const dataRequestCycle = dataRequest.dataRequestCycle
    const dataRequestStateMetaData = dataRequest.dataRequestStateMetaData

    const dataRequests = []
    if (dataRequestCycle) {
      dataRequests.push(dataRequestCycle)
    }
    if (dataRequestStateMetaData) {
      dataRequests.push(dataRequestStateMetaData)
    }
    if (dataRequests.length > 0) {
      addDataRecipient(dataRequest.nodeInfo, dataRequests)
    }
    res.json({ success: true })
  })

  network.registerExternalPost('querydata', (req, res) => {
    let err = validateTypes(req, { body: 'o' })
    if (err) {
      warn(`querydata: bad req ${err}`)
      return res.json({ success: false, error: err })
    }
    err = validateTypes(req.body, {
      publicKey: 's',
      tag: 's',
      nodeInfo: 'o',
    })
    if (err) {
      warn(`querydata: bad req.body ${err}`)
      return res.json({ success: false, error: err })
    }
    // [TODO] Authenticate tag

    const queryRequest = req.body
    if (logFlags.p2pNonFatal) info('queryRequest received', JSON.stringify(queryRequest))

    const foundArchiver = archivers.get(queryRequest.publicKey)
    if (!foundArchiver) {
      const archiverNotFoundErr = 'Archiver not found in list'
      warn(archiverNotFoundErr)
      return res.json({ success: false, error: archiverNotFoundErr })
    }
    delete queryRequest.publicKey
    delete queryRequest.tag
    let data: {
      [key: number]:
        | StateManager.StateManagerTypes.ReceiptMapResult[]
        | StateManager.StateManagerTypes.StatsClump
    }
    if (queryRequest.type === 'RECEIPT_MAP') {
      data = getReceiptMap(queryRequest.lastData)
    } else if (queryRequest.type === 'SUMMARY_BLOB') {
      data = getSummaryBlob(queryRequest.lastData)
      // console.log('Summary blob to send', data)
    }
    res.json({ success: true, data: data })
  })

  network.registerExternalGet('archivers', (req, res) => {
    res.json({ archivers: [...archivers.values()] })
  })

  network.registerExternalGet('datarecipients', (req, res) => {
    res.json({ dataRecipients: [...recipients.values()] })
  })
}

function info(...msg) {
  const entry = `Archiver: ${msg.join(' ')}`
  p2pLogger.info(entry)
}

function warn(...msg) {
  const entry = `Archiver: ${msg.join(' ')}`
  p2pLogger.warn(entry)
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function error(...msg) {
  const entry = `Archiver: ${msg.join(' ')}`
  p2pLogger.error(entry)
}
