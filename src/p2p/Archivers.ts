import deepmerge from 'deepmerge'
import {
  getStateHashes,
  getReceiptHashes,
  getSummaryHashes,
  getReceiptMap,
  getSummaryBlob,
} from '../snapshot'
import { validateTypes } from '../utils'
import * as Comms from './Comms'
import * as NodeList from './NodeList'
import { crypto, logger, network, io, stateManager, config } from './Context'
import { getCycleChain, computeCycleMarker, getNewest } from './CycleChain'
import * as CycleCreator from './CycleCreator'
import * as CycleParser from './CycleParser'
import { logFlags } from '../logger'
import { P2P, StateManager } from '@shardus/types'
import { profilerInstance } from '../utils/profiler'
import Timeout = NodeJS.Timeout
import { nestedCountersInstance } from '../utils/nestedCounters'

/** STATE */

let p2pLogger

export let archivers: Map<P2P.ArchiversTypes.JoinedArchiver['publicKey'], P2P.ArchiversTypes.JoinedArchiver>
let recipients: Map<P2P.ArchiversTypes.JoinedArchiver['publicKey'], P2P.ArchiversTypes.DataRecipient>

let joinRequests: P2P.ArchiversTypes.Request[]
let leaveRequests: P2P.ArchiversTypes.Request[]
let receiptForwardInterval: Timeout | null = null

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
}

export function reset() {
  resetJoinRequests()
}

export function getTxs(): P2P.ArchiversTypes.Txs {
  // [IMPORTANT] Must return a copy to avoid mutation
  const requestsCopy = deepmerge({}, [...joinRequests, ...leaveRequests])
  if(logFlags.console) console.log(
    `getTxs: Cycle ${CycleCreator.currentCycle}, Quarter: ${CycleCreator.currentQuarter}`,
    {
      archivers: requestsCopy,
    }
  )

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

    if(logFlags.console) console.log(
    `Archiver before updating record: Cycle ${CycleCreator.currentCycle}, Quarter: ${CycleCreator.currentQuarter}`,
    joinedArchivers,
    leavingArchivers
  )

  record.joinedArchivers = joinedArchivers.sort(
    (a: P2P.ArchiversTypes.JoinedArchiver, b: P2P.ArchiversTypes.JoinedArchiver) =>
      a.publicKey > b.publicKey ? 1 : -1
  )
  record.leavingArchivers = JSON.parse(
    JSON.stringify(
      leavingArchivers.sort((a: P2P.ArchiversTypes.JoinedArchiver, b: P2P.ArchiversTypes.JoinedArchiver) =>
        a.publicKey > b.publicKey ? 1 : -1
      )
    )
  )
  if(logFlags.console) console.log(
    `Archiver after updating record: Cycle ${CycleCreator.currentCycle}, Quarter: ${CycleCreator.currentQuarter}`,
    record
  )

  resetLeaveRequests()
}

export function parseRecord(
  record: P2P.CycleCreatorTypes.CycleRecord
): P2P.CycleParserTypes.Change {
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

export function addJoinRequest(joinRequest, tracker?, gossip = true) {
  // validate input
  let err = validateTypes(joinRequest, { nodeInfo: 'o', sign: 'o' })
  if (err) {
    warn('addJoinRequest: bad joinRequest ' + err)
    return false
  }
  err = validateTypes(joinRequest.nodeInfo, {
    curvePk: 's',
    ip: 's',
    port: 'n',
    publicKey: 's',
  })
  if (err) {
    warn('addJoinRequest: bad joinRequest.nodeInfo ' + err)
    return false
  }
  err = validateTypes(joinRequest.sign, { owner: 's', sig: 's' })
  if (err) {
    warn('addJoinRequest: bad joinRequest.sign ' + err)
    return false
  }
  if (!crypto.verify(joinRequest)) {
    warn('addJoinRequest: bad signature')
    return false
  }
  joinRequests.push(joinRequest)
  if(logFlags.console) console.log(
    `Join request added in cycle ${CycleCreator.currentCycle}, quarter ${CycleCreator.currentQuarter}`,
    joinRequest
  )
  if (gossip === true) {
    Comms.sendGossip('joinarchiver', joinRequest, tracker, null, NodeList.byIdOrder, true)
  }
  return true
}

export function addLeaveRequest(request, tracker?, gossip = true) {
  // validate input
  let err = validateTypes(request, { nodeInfo: 'o', sign: 'o' })
  if (err) {
    warn('addLeaveRequest: bad leaveRequest ' + err)
    return false
  }
  err = validateTypes(request.nodeInfo, {
    curvePk: 's',
    ip: 's',
    port: 'n',
    publicKey: 's',
  })
  if (err) {
    warn('addLeaveRequest: bad leaveRequest.nodeInfo ' + err)
    return false
  }
  err = validateTypes(request.sign, { owner: 's', sig: 's' })
  if (err) {
    warn('addLeaveRequest: bad leaveRequest.sign ' + err)
    return false
  }
  if (!crypto.verify(request)) {
    warn('addLeaveRequest: bad signature')
    return false
  }

  leaveRequests.push(request)
  if(logFlags.console) console.log('adding leave requests', leaveRequests)
  if (gossip === true) {
    Comms.sendGossip('leavingarchiver', request, tracker, null, NodeList.byIdOrder, true)
  }
  return true
}

export function getArchiverUpdates() {
  return joinRequests
}

export function updateArchivers(record) {
  // Update archiversList
  for (const nodeInfo of record.joinedArchivers) {
    archivers.set(nodeInfo.publicKey, nodeInfo)
  }
  for (const nodeInfo of record.leavingArchivers) {
    archivers.delete(nodeInfo.publicKey)
    removeDataRecipient(nodeInfo.publicKey)
  }
}

export function addDataRecipient(
  nodeInfo: P2P.ArchiversTypes.JoinedArchiver,
  dataRequests: P2P.ArchiversTypes.DataRequest<P2P.CycleCreatorTypes.CycleRecord | P2P.SnapshotTypes.StateMetaData>[]
) {
  if(logFlags.console) console.log('Adding data recipient..', arguments)
  const recipient = {
    nodeInfo,
    // TODO: dataRequest should be an array
    dataRequests: dataRequests,
    curvePk: crypto.convertPublicKeyToCurve(nodeInfo.publicKey),
  }
  if(logFlags.console) console.log('dataRequests: ', recipient.dataRequests)
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

    nestedCountersInstance.countEvent('Archiver','forwardReceipts', responses.RECEIPT.length ) 

    // Tag dataResponse
    const taggedDataResponse = crypto.tag(dataResponse, recipient.curvePk)
    if(logFlags.console) console.log('Sending receipts to archivers', taggedDataResponse)
    io.emit('DATA', taggedDataResponse)
  }

  stateManager.transactionQueue.resetReceiptsToForward()

  profilerInstance.scopedProfileSectionEnd('forwardReceipts')
}


export async function forwardAccounts(accounts: any[]) {
  if (!config.p2p.experimentalSnapshot) return
  const responses: any = {}
  responses.ACCOUNT = accounts
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
    io.emit('DATA', taggedDataResponse)
    console.log('forward Accounts Successfully!')
  }
}

export function removeDataRecipient(publicKey) {
  if (recipients.has(publicKey)) {
    if(logFlags.console) console.log('Removing data recipient', publicKey)
    recipients.delete(publicKey)
  } else {
    if(logFlags.console) console.log(`Data recipient ${publicKey} is already removed`)
  }
}

export function sendData() {
  if(logFlags.console) console.log('Recient List before sending data')
  if(logFlags.console) console.log(recipients)
  for (const [publicKey, recipient] of recipients) {
    const recipientUrl = `http://${recipient.nodeInfo.ip}:${recipient.nodeInfo.port}/newdata`
    const responses: P2P.ArchiversTypes.DataResponse['responses'] = {}

    for (const request of recipient.dataRequests) {
      switch (request.type) {
        case P2P.SnapshotTypes.TypeNames.CYCLE: {
          // Identify request type
          const typedRequest = request as P2P.ArchiversTypes.DataRequest<P2P.SnapshotTypes.NamesToTypes['CYCLE']>
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
            typedRequest.lastData =
              cyclesWithMarker[cyclesWithMarker.length - 1].counter
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
          if(logFlags.console) console.log('STATE_METADATA typedRequest', typedRequest)
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

    if(logFlags.console) {
      console.log(
        `Sending data for cycle ${
          getNewest().counter
        } to archiver ${recipientUrl}`,
        recipient.curvePk
      )
    }

    io.emit('DATA', taggedDataResponse)

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

export function registerRoutes() {
  network.registerExternalPost('joinarchiver', async (req, res) => {
    const err = validateTypes(req, { body: 'o' })
    if (err) {
      warn(`joinarchiver: bad req ${err}`)
      return res.json({ success: false, error: err })
    }

    const joinRequest = req.body
    if(logFlags.p2pNonFatal) info(`Archiver join request received: ${JSON.stringify(joinRequest)}`)
    res.json({ success: true })

    const accepted = await addJoinRequest(joinRequest)
    if (!accepted) return warn('Archiver join request not accepted.')
    if(logFlags.p2pNonFatal) info('Archiver join request accepted!')
  })

  network.registerExternalPost('leavingarchivers', async (req, res) => {
    const err = validateTypes(req, { body: 'o' })
    if (err) {
      warn(`leavingarchivers: bad req ${err}`)
      return res.json({ success: false, error: err })
    }

    const leaveRequest = req.body
    if(logFlags.p2pNonFatal) info(`Archiver leave request received: ${JSON.stringify(leaveRequest)}`)
    res.json({ success: true })

    const accepted = await addLeaveRequest(leaveRequest)
    if (!accepted) return warn('Archiver leave request not accepted.')
    if(logFlags.p2pNonFatal) info('Archiver leave request accepted!')
  })
  Comms.registerGossipHandler(
    'joinarchiver',
    async (payload, sender, tracker) => {
      profilerInstance.scopedProfileSectionStart('joinarchiver')
      try {
        if(logFlags.console) console.log('Join request gossip received:', payload)
        const existingJoinRequest = joinRequests.find(
          (j) => j.nodeInfo.publicKey === payload.nodeInfo.publicKey
        )
        if (!existingJoinRequest) {
          const accepted = await addJoinRequest(payload, tracker, false)
          if(logFlags.console) {
            console.log('This join request is new. Should forward the join request')
            console.log('join request gossip accepted', accepted)
          }
          if (!accepted) return warn('Archiver join request not accepted.')
          if(logFlags.p2pNonFatal) info('Archiver join request accepted!')
          Comms.sendGossip('joinarchiver', payload, tracker, sender, NodeList.byIdOrder, false)
        } else {
          if(logFlags.console) console.log('Already received archiver join gossip for this node')
        }
      } finally {
        profilerInstance.scopedProfileSectionEnd('joinarchiver')
      }
    }
  )

  Comms.registerGossipHandler(
    'leavingarchiver',
    async (payload, sender, tracker) => {
      profilerInstance.scopedProfileSectionStart('leavingarchiver')
      try {
        if(logFlags.console) console.log('Leave request gossip received:', payload)
        const existingLeaveRequest = leaveRequests.find(
          (j) => j.nodeInfo.publicKey === payload.nodeInfo.publicKey
        )
        if (!existingLeaveRequest) {
          const accepted = await addLeaveRequest(payload, tracker, false)
          if (!accepted) return warn('Archiver leave request not accepted.')
          if(logFlags.p2pNonFatal) info('Archiver leave request accepted!')
          Comms.sendGossip('leavingarchiver', payload, tracker, sender, NodeList.byIdOrder, false)
        } else {
          if(logFlags.console) console.log('Already received archiver leave gossip for this node')
        }
      } finally {
        profilerInstance.scopedProfileSectionEnd('leavingarchiver')
      }
    }
  )

  network.registerExternalPost('requestdata', (req, res) => {
    let err = validateTypes(req, { body: 'o' })
    if (err) {
      warn(`requestdata: bad req ${err}`)
      return res.json({ success: false, error: err })
    }
    err = validateTypes(req.body, {
      tag: 's'
    })
    if (err) {
      warn(`requestdata: bad req.body ${err}`)
      return res.json({ success: false, error: err })
    }

    const dataRequest = req.body
    if(logFlags.p2pNonFatal) info('dataRequest received', JSON.stringify(dataRequest))

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
    if(logFlags.p2pNonFatal) info('queryRequest received', JSON.stringify(queryRequest))

    const foundArchiver = archivers.get(queryRequest.publicKey)
    if (!foundArchiver) {
      const archiverNotFoundErr = 'Archiver not found in list'
      warn(archiverNotFoundErr)
      return res.json({ success: false, error: archiverNotFoundErr })
    }
    delete queryRequest.publicKey
    delete queryRequest.tag
    let data : { [key: number]: StateManager.StateManagerTypes.ReceiptMapResult[] | StateManager.StateManagerTypes.StatsClump }
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
