import * as http from '../http'
import * as Comms from './Comms'
import { crypto, logger, network } from './Context'
import { getCycleChain } from './CycleChain'
import * as CycleCreator from './CycleCreator'
import { CycleRecord as Cycle } from './CycleCreator'
import * as CycleParser from './CycleParser'

/** TYPES */

export interface Transaction {
  id: string
}

export interface Partition {
  hash: string
}

export type ValidTypes = Cycle | Transaction | Partition

export enum TypeNames {
  CYCLE = 'CYCLE',
  TRANSACTION = 'TRANSACTION',
  PARTITION = 'PARTITION',
}

export type TypeName<T extends ValidTypes> = T extends Cycle
  ? TypeNames.CYCLE
  : T extends Transaction
  ? TypeNames.TRANSACTION
  : TypeNames.PARTITION

export type TypeIndex<T extends ValidTypes> = T extends Cycle
  ? Cycle['counter']
  : T extends Transaction
  ? Transaction['id']
  : Partition['hash']
export interface DataRequest<T extends ValidTypes> {
  type: TypeName<T>
  lastData: TypeIndex<T>
}

interface DataResponse<T extends ValidTypes> {
  publicKey: string
  type: string
  data: T[]
}

interface DataRecipient<T extends ValidTypes> {
  nodeInfo: JoinedArchiver
  type: DataRequest<T>['type']
  lastData: DataRequest<T>['lastData']
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

let mainLogger

export let archivers: Map<JoinedArchiver['publicKey'], JoinedArchiver>
let recipients: Array<DataRecipient<Cycle | Transaction | Partition>>

let requests: JoinRequest[]

/** FUNCTIONS */

/** CycleCreator Functions */

export function init() {
  mainLogger = logger.getLogger('main')

  archivers = new Map()
  recipients = []

  reset()

  registerRoutes()
}

export function reset() {
  resetJoinRequests()
}

export function getTxs(): Txs {
  return {
    archivers: requests,
  }
}

export function updateRecord(
  txs: Txs,
  record: CycleCreator.CycleRecord,
  _prev: CycleCreator.CycleRecord
) {
  // Add join requests to the cycle record
  const joinedArchivers = txs.archivers.map(joinRequest => joinRequest.nodeInfo)
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

function logDebug(...msgs) {
  mainLogger.debug(
    'P2PArchivers: ' + msgs.map(msg => JSON.stringify(msg)).join(', ')
  )
}

function logError(...msgs) {
  mainLogger.error(
    'P2PArchivers: ' + msgs.map(msg => JSON.stringify(msg)).join(', ')
  )
}

export function resetJoinRequests() {
  requests = []
}

export function addJoinRequest(joinRequest, tracker?, gossip = true) {
  // [TODO] Verify signature

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
  dataRequest: DataRequest<Cycle | Transaction | Partition>
) {
  const recipient = {
    nodeInfo,
    type: dataRequest.type,
    lastData: dataRequest.lastData,
    curvePk: crypto.convertPublicKeyToCurve(nodeInfo.publicKey),
  }
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

export function sendData() {
  for (const recipient of recipients) {
    const recipientUrl = `http://${recipient.nodeInfo.ip}:${recipient.nodeInfo.port}/newdata`

    const baseDataResponse = {
      publicKey: crypto.getPublicKey(),
      type: recipient.type,
    }

    let dataResponse

    switch (recipient.type) {
      case 'CYCLE': {
        // Identify recipients type
        const typedRecipient = recipient as DataRecipient<Cycle>
        // Get latest cycles since recipients lastData
        const data = getCycleChain(typedRecipient.lastData + 1)
        // Update lastData
        if (data.length > 0) {
          typedRecipient.lastData = data[data.length - 1].counter
        }
        // Make dataResponse
        dataResponse = Object.assign(baseDataResponse, {
          data,
        })
        break
      }
      case 'TRANSACTION': {
        // [TODO] Send latest txs
        break
      }
      case 'PARTITION': {
        // [TODO] Send latest partitions
        break
      }
      default:
    }

    // Tag dataResponse
    const taggedDataResponse = crypto.tag(dataResponse, recipient.curvePk)

    http
      .post(recipientUrl, taggedDataResponse)
      .then(dataKeepAlive => {
        if (dataKeepAlive.keepAlive === false) {
          // Remove recipient from dataRecipients
          removeDataRecipient(recipient.nodeInfo.publicKey)
        }
      })
      .catch(err => {
        // Remove recipient from dataRecipients
        logError('Error sending data to dataRecipient.', err)
        removeDataRecipient(recipient.nodeInfo.publicKey)
      })
  }
}

export function sendPartitionData(partitionReceipt, paritionObject) {
  // for (const nodeInfo of cycleRecipients) {
  //   const nodeUrl = `http://${nodeInfo.ip}:${nodeInfo.port}/post_partition`
  //   http.post(nodeUrl, { partitionReceipt, paritionObject })
  //     .catch(err => {
  //       logError(`sendPartitionData: Failed to post to ${nodeUrl} ` + err)
  //     })
  // }
}

export function sendTransactionData(
  partitionNumber,
  cycleNumber,
  transactions
) {
  // for (const nodeInfo of cycleRecipients) {
  //   const nodeUrl = `http://${nodeInfo.ip}:${nodeInfo.port}/post_transactions`
  //   http.post(nodeUrl, { partitionNumber, cycleNumber, transactions })
  //     .catch(err => {
  //       logError(`sendTransactionData: Failed to post to ${nodeUrl} ` + err)
  //     })
  // }
}

export function registerRoutes() {
  network.registerExternalPost('joinarchiver', async (req, res) => {
    const invalidJoinReqErr = 'Invalid archiver join request'
    if (!req.body) {
      logError(invalidJoinReqErr)
      return res.json({ success: false, error: invalidJoinReqErr })
    }

    const joinRequest = req.body
    logDebug(`Archiver join request received: ${JSON.stringify(joinRequest)}`)
    res.json({ success: true })

    const accepted = await addJoinRequest(joinRequest)
    if (!accepted) return logDebug('Archiver join request not accepted.')
    logDebug('Archiver join request accepted!')
  })

  Comms.registerGossipHandler(
    'joinarchiver',
    async (payload, sender, tracker) => {
      const accepted = await addJoinRequest(payload, tracker, false)
      if (!accepted) return logDebug('Archiver join request not accepted.')
      logDebug('Archiver join request accepted!')
    }
  )

  network.registerExternalPost('requestdata', (req, res) => {
    console.log(
      'DBG',
      `Archivers: requestdata: Got Request ${JSON.stringify(req.body)}`
    )

    if (!req.body) {
      const invalidDataReqErr = 'Invalid data request'
      logError(invalidDataReqErr)
      return res.json({ success: false, error: invalidDataReqErr })
    }

    const dataRequest = req.body

    // [TODO] Authenticate tag
    /*
    const invalidTagErr = 'Tag is invalid'
    if (!crypto.authenticate(dataRequest, crypto.getCurvePublicKey(dataRequest.publicKey))) {
      logError(invalidTagErr)
      return res.json({ success: false, error: invalidTagErr })
    }
    */

    const nodeInfo = archivers.get(dataRequest.publicKey)

    if (!nodeInfo) {
      const archiverNotFoundErr = 'Archiver not found in list'
      logError(archiverNotFoundErr)
      return res.json({ success: false, error: archiverNotFoundErr })
    }

    delete dataRequest.publicKey
    delete dataRequest.tag

    addDataRecipient(nodeInfo, dataRequest)
    res.json({ success: true})
  })

  network.registerExternalGet('archivers', (req, res) => {
    res.json({ archivers: [...archivers.values()] })
  })

  network.registerExternalGet('datarecipients', (req, res) => {
    res.json({ dataRecipients: recipients })
  })
}
