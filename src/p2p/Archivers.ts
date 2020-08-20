import deepmerge from 'deepmerge'
import * as http from '../http'
import * as Comms from './Comms'
import { crypto, logger, network } from './Context'
import { getCycleChain } from './CycleChain'
import * as CycleCreator from './CycleCreator'
import { CycleRecord as Cycle } from './CycleCreator'
import * as CycleParser from './CycleParser'
import { validateTypes } from '../utils'
import { Request } from 'express'
import { StateHashes, getStateHashes } from '../snapshot'

/** TYPES */

export interface Transaction {
  id: string
}

export type ValidTypes = Cycle | Transaction | StateHashes

export enum TypeNames {
  CYCLE = 'CYCLE',
  TRANSACTION = 'TRANSACTION',
  STATE = 'STATE',
}

interface NamesToTypes {
  CYCLE: Cycle
  TRANSACTION: Transaction
  STATE: StateHashes
}

export type TypeName<T extends ValidTypes> = T extends Cycle
  ? TypeNames.CYCLE
  : T extends Transaction
  ? TypeNames.TRANSACTION
  : TypeNames.STATE

export type TypeIndex<T extends ValidTypes> = T extends Cycle
  ? Cycle['counter']
  : T extends Transaction
  ? Transaction['id']
  : StateHashes['counter']
export interface DataRequest<T extends ValidTypes> {
  type: TypeName<T>
  lastData: TypeIndex<T>
}

interface DataResponse {
  publicKey: string
  responses: {
    [T in TypeNames]?: NamesToTypes[T][]
  },
  type: TypeNames.CYCLE | TypeNames.STATE | TypeNames.TRANSACTION
}

interface DataRecipient {
  nodeInfo: JoinedArchiver
  dataRequests: DataRequest<Cycle | Transaction | StateHashes>[]
  curvePk: string
}

export interface JoinedArchiver {
  publicKey: string
  ip: string
  port: number
  curvePk: string
}

export interface JoinRequest extends SignedObject {
  nodeInfo: JoinedArchiver
}

export interface Txs {
  archivers: JoinRequest[]
}

export interface Record {
  joinedArchivers: JoinedArchiver[]
}

/** STATE */

let p2pLogger

export let archivers: Map<JoinedArchiver['publicKey'], JoinedArchiver>
let recipients: DataRecipient[]

let requests: JoinRequest[]

/** FUNCTIONS */

/** CycleCreator Functions */

export function init() {
  p2pLogger = logger.getLogger('p2p')

  archivers = new Map()
  recipients = []

  reset()

  registerRoutes()
}

export function reset() {
  resetJoinRequests()
}

export function getTxs(): Txs {
  // [IMPORTANT] Must return a copy to avoid mutation
  const requestsCopy = deepmerge({}, requests)

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

export function updateRecord(
  txs: Txs,
  record: CycleCreator.CycleRecord,
  _prev: CycleCreator.CycleRecord
) {
  // Add join requests to the cycle record
  const joinedArchivers = txs.archivers.map(
    (joinRequest) => joinRequest.nodeInfo
  )
  record.joinedArchivers = joinedArchivers.sort()
}

export function parseRecord(
  record: CycleCreator.CycleRecord
): CycleParser.Change {
  // Update our archivers list
  updateArchivers(record.joinedArchivers)

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
export function queueRequest(request) {}

/** Original Functions */

export function resetJoinRequests() {
  requests = []
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

  requests.push(joinRequest)
  if (gossip === true) {
    Comms.sendGossip('joinarchiver', joinRequest, tracker)
  }
  return true
}

export function getArchiverUpdates() {
  return requests
}

export function updateArchivers(joinedArchivers) {
  // Update archiversList
  for (const nodeInfo of joinedArchivers) {
    archivers.set(nodeInfo.publicKey, nodeInfo)
  }
}

export function addDataRecipient(
  nodeInfo: JoinedArchiver,
  dataRequests: DataRequest<Cycle | Transaction | StateHashes>[]
) {
  console.log('Adding data recipient..')
  console.log('dataReques parameter: ', dataRequests)
  const recipient = {
    nodeInfo,
    // TODO: dataRequest should be an array
    dataRequests: dataRequests,
    curvePk: crypto.convertPublicKeyToCurve(nodeInfo.publicKey),
  }
  console.log('dataRequests: ', recipient.dataRequests)
  recipients.push(recipient)
}

function removeDataRecipient(publicKey) {
  let recipient
  for (let i = recipients.length - 1; i >= 0; i--) {
    recipient = recipients[i]
    if (recipient.nodeInfo.publicKey === publicKey) {
      recipients.splice(i, 1)
    }
  }
}

export function sendData(typeToSend: TypeNames.CYCLE | TypeNames.STATE | TypeNames.TRANSACTION) {
  console.log('Sending data to recipient: ', typeToSend)
  for (const recipient of recipients) {
    const recipientUrl = `http://${recipient.nodeInfo.ip}:${recipient.nodeInfo.port}/newdata`

    const responses: DataResponse['responses'] = {}

    for (const request of recipient.dataRequests) {
      if (request.type !== typeToSend) continue
      switch (request.type) {
        case TypeNames.CYCLE: {
          // Identify request type
          const typedRequest = request as DataRequest<NamesToTypes['CYCLE']>
          // Get latest cycles since lastData
          const data = getCycleChain(typedRequest.lastData + 1)
          // Update lastData
          if (data.length > 0) {
            typedRequest.lastData = data[data.length - 1].counter
          }
          // Add to responses
          responses.CYCLE = data
          break
        }
        case TypeNames.TRANSACTION: {
          // [TODO] Send latest txs
          break
        }
        case TypeNames.STATE: {
          // Identify request type
          const typedRequest = request as DataRequest<NamesToTypes['STATE']>
          // [TODO] Get latest state hash data since lastData
          const data = getStateHashes(typedRequest.lastData + 1)
          // [TODO] Update lastData
          console.log('data to send', data)
          if (data.length > 0) {
            typedRequest.lastData = data[data.length - 1].counter
          }
          // Add to responses
          responses.STATE = data
          break
        }
        default:
      }
    }

    const dataResponse: DataResponse = {
      publicKey: crypto.getPublicKey(),
      responses,
      type: typeToSend
    }

    // Tag dataResponse
    const taggedDataResponse = crypto.tag(dataResponse, recipient.curvePk)

    http
      .post(recipientUrl, taggedDataResponse)
      .then((dataKeepAlive) => {
        if (dataKeepAlive.keepAlive === false) {
          // Remove recipient from dataRecipients
          removeDataRecipient(recipient.nodeInfo.publicKey)
        }
      })
      .catch((err) => {
        // Remove recipient from dataRecipients
        warn('Error sending data to dataRecipient.', err)
        removeDataRecipient(recipient.nodeInfo.publicKey)
      })
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
    info(`Archiver join request received: ${JSON.stringify(joinRequest)}`)
    res.json({ success: true })

    const accepted = await addJoinRequest(joinRequest)
    if (!accepted) return warn('Archiver join request not accepted.')
    info('Archiver join request accepted!')
  })

  Comms.registerGossipHandler(
    'joinarchiver',
    async (payload, sender, tracker) => {
      const accepted = await addJoinRequest(payload, tracker, false)
      if (!accepted) return warn('Archiver join request not accepted.')
      info('Archiver join request accepted!')
    }
  )

  network.registerExternalPost('requestdata', (req, res) => {
    let err = validateTypes(req, { body: 'o' })
    if (err) {
      warn(`requestdata: bad req ${err}`)
      return res.json({ success: false, error: err })
    }
    err = validateTypes(req.body, {
      lastData: 'n',
      type: 's',
      publicKey: 's',
      tag: 's',
    })
    if (err) {
      warn(`requestdata: bad req.body ${err}`)
      return res.json({ success: false, error: err })
    }
    // [TODO] Authenticate tag

    const dataRequest = req.body

    /*
    const invalidTagErr = 'Tag is invalid'
    if (!crypto.authenticate(dataRequest, crypto.getCurvePublicKey(dataRequest.publicKey))) {
      warn(invalidTagErr)
      return res.json({ success: false, error: invalidTagErr })
    }
    */

    const nodeInfo = archivers.get(dataRequest.publicKey)

    if (!nodeInfo) {
      const archiverNotFoundErr = 'Archiver not found in list'
      warn(archiverNotFoundErr)
      return res.json({ success: false, error: archiverNotFoundErr })
    }

    delete dataRequest.publicKey
    delete dataRequest.tag

    addDataRecipient(nodeInfo, dataRequest)
    res.json({ success: true })
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

function error(...msg) {
  const entry = `Archiver: ${msg.join(' ')}`
  p2pLogger.error(entry)
}
