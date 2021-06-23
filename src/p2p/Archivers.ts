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
import { crypto, logger, network, io } from './Context'
import { getCycleChain, computeCycleMarker, getNewest } from './CycleChain'
import * as CycleCreator from './CycleCreator'
import { CycleRecord as Cycle, CycleRecord } from "../shared-types/p2p/CycleCreatorTypes"
import * as CycleParser from './CycleParser'
import { logFlags } from '../logger'
import { StateMetaData, TypeNames, NamesToTypes } from '../shared-types/p2p/SnapshotTypes'
import { JoinedArchiver, DataRecipient, Request, Txs, Record, RequestTypes, DataResponse, DataRequest } from '../shared-types/p2p/ArchiversTypes'
import { Change } from '../shared-types/p2p/CycleParserTypes'

/** STATE */

let p2pLogger

export let archivers: Map<JoinedArchiver['publicKey'], JoinedArchiver>
let recipients: Map<JoinedArchiver['publicKey'], DataRecipient>

let joinRequests: Request[]
let leaveRequests: Request[]

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
}

export function reset() {
  resetJoinRequests()
}

export function getTxs(): Txs {
  // [IMPORTANT] Must return a copy to avoid mutation
  const requestsCopy = deepmerge({}, [...joinRequests, ...leaveRequests])
  if(logFlags.console) console.log(
    `getTxs: Cycle ${CycleCreator.currentQuarter}, Quarter: ${CycleCreator.currentQuarter}`,
    {
      archivers: requestsCopy,
    }
  )

  return {
    archivers: requestsCopy,
  }
}

export function validateRecordTypes(rec: Record): string {
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

export function updateRecord(txs: Txs, record: CycleRecord) {
  // Add joining archivers to the cycle record
  const joinedArchivers = txs.archivers
    .filter((request) => request.requestType === RequestTypes.JOIN)
    .map((joinRequest) => joinRequest.nodeInfo)

  // Add leaving archivers to the cycle record
  const leavingArchivers = txs.archivers
    .filter((request) => request.requestType === RequestTypes.LEAVE)
    .map((leaveRequest) => leaveRequest.nodeInfo)

    if(logFlags.console) console.log(
    `Archiver before updating record: Cycle ${CycleCreator.currentQuarter}, Quarter: ${CycleCreator.currentQuarter}`,
    joinedArchivers,
    leavingArchivers
  )

  record.joinedArchivers = joinedArchivers.sort(
    (a: JoinedArchiver, b: JoinedArchiver) =>
      a.publicKey > b.publicKey ? 1 : -1
  )
  record.leavingArchivers = JSON.parse(
    JSON.stringify(
      leavingArchivers.sort((a: JoinedArchiver, b: JoinedArchiver) =>
        a.publicKey > b.publicKey ? 1 : -1
      )
    )
  )
  if(logFlags.console) console.log(
    `Archiver after updating record: Cycle ${CycleCreator.currentQuarter}, Quarter: ${CycleCreator.currentQuarter}`,
    record
  )

  resetLeaveRequests()
}

export function parseRecord(
  record: CycleRecord
): Change {
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
    Comms.sendGossip('joinarchiver', joinRequest, tracker)
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
    Comms.sendGossip('leavingarchiver', request, tracker)
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
  nodeInfo: JoinedArchiver,
  dataRequests: DataRequest<Cycle | StateMetaData>[]
) {
  if(logFlags.console) console.log('Adding data recipient..')
  const recipient = {
    nodeInfo,
    // TODO: dataRequest should be an array
    dataRequests: dataRequests,
    curvePk: crypto.convertPublicKeyToCurve(nodeInfo.publicKey),
  }
  if(logFlags.console) console.log('dataRequests: ', recipient.dataRequests)
  recipients.set(nodeInfo.publicKey, recipient)
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

    const responses: DataResponse['responses'] = {}

    for (const request of recipient.dataRequests) {
      switch (request.type) {
        case TypeNames.CYCLE: {
          // Identify request type
          const typedRequest = request as DataRequest<NamesToTypes['CYCLE']>
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
        case TypeNames.STATE_METADATA: {
          // Identify request type
          const typedRequest = request as DataRequest<
            NamesToTypes['STATE_METADATA']
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

          const metadata: StateMetaData = {
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

    const dataResponse: DataResponse = {
      publicKey: crypto.getPublicKey(),
      responses,
      recipient: publicKey,
    }

    // Tag dataResponse
    const taggedDataResponse = crypto.tag(dataResponse, recipient.curvePk)
    const isAuthenticated = crypto.authenticate(
      taggedDataResponse,
      crypto.getPublicKey()
    )

    if(logFlags.console) {
      console.log(
        `Sending data for cycle ${
          getNewest().counter
        } to archiver ${recipientUrl}`,
        recipient.curvePk
      )
      console.log(taggedDataResponse)
      console.log(taggedDataResponse.responses)
      console.log('Is authenticated', isAuthenticated)
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
        Comms.sendGossip('joinarchiver', payload, tracker)
      } else {
        if(logFlags.console) console.log('Already received archiver join gossip for this node')
      }
    }
  )

  Comms.registerGossipHandler(
    'leavingarchiver',
    async (payload, sender, tracker) => {
      if(logFlags.console) console.log('Leave request gossip received:', payload)
      const existingLeaveRequest = leaveRequests.find(
        (j) => j.nodeInfo.publicKey === payload.nodeInfo.publicKey
      )
      if (!existingLeaveRequest) {
        const accepted = await addLeaveRequest(payload, tracker, false)
        if (!accepted) return warn('Archiver leave request not accepted.')
        if(logFlags.p2pNonFatal) info('Archiver leave request accepted!')
        Comms.sendGossip('leavingarchiver', payload, tracker)
      } else {
        if(logFlags.console) console.log('Already received archiver leave gossip for this node')
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
      publicKey: 's',
      tag: 's',
      nodeInfo: 'o',
    })
    if (err) {
      warn(`requestdata: bad req.body ${err}`)
      return res.json({ success: false, error: err })
    }
    // [TODO] Authenticate tag

    const dataRequest = req.body
    if(logFlags.p2pNonFatal) info('dataRequest received', JSON.stringify(dataRequest))
    /*
    const invalidTagErr = 'Tag is invalid'
    if (!crypto.authenticate(dataRequest, crypto.getCurvePublicKey(dataRequest.publicKey))) {
      warn(invalidTagErr)
      return res.json({ success: false, error: invalidTagErr })
    }
    */

    const nodeInfo = archivers.get(dataRequest.publicKey)

    // if (!nodeInfo) {
    //   const archiverNotFoundErr = 'Archiver not found in list'
    //   warn(archiverNotFoundErr)
    //   return res.json({ success: false, error: archiverNotFoundErr })
    // }

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

    const nodeInfo = archivers.get(queryRequest.publicKey)
    // if (!nodeInfo) {
    //   const archiverNotFoundErr = 'Archiver not found in list'
    //   warn(archiverNotFoundErr)
    //   return res.json({ success: false, error: archiverNotFoundErr })
    // }
    delete queryRequest.publicKey
    delete queryRequest.tag
    let data
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
    res.json({ dataRecipients: recipients })
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
