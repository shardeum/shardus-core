import deepmerge from 'deepmerge'
import * as http from '../http'
import * as Comms from './Comms'
import { crypto, logger, network } from './Context'
import { getCycleChain } from './CycleChain'
import * as CycleCreator from './CycleCreator'
import { CycleRecord as Cycle } from './CycleCreator'
import * as CycleParser from './CycleParser'
import { validateTypes } from '../utils'

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

let p2pLogger

export let archivers: Map<JoinedArchiver['publicKey'], JoinedArchiver>
let recipients: Array<DataRecipient<Cycle | Transaction | Partition>>

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

export function validateRecordTypes(rec: Record): string{
  let err = validateTypes(rec,{joinedArchivers:'a'})
  if (err) return err
  for(const item of rec.joinedArchivers){
    err = validateTypes(item,{publicKey:'s',ip:'s',port:'n',curvePk:'s'})
    if (err) return 'in joinedArchivers array '+err
  }
  return ''
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

export function resetJoinRequests() {
  requests = []
}

export function addJoinRequest(joinRequest, tracker?, gossip = true) {

  // validate input
  let err = validateTypes(joinRequest,{nodeInfo:'o',sign:'o'})
  if (err){
    warn('addJoinRequest: bad joinRequest '+err)
    return false
  }
  err = validateTypes(joinRequest.nodeInfo, {curvePk:'s',ip:'s',port:'n',publicKey:'s'})
  if (err){
    warn('addJoinRequest: bad joinRequest.nodeInfo '+err)
    return false
  }
  err = validateTypes(joinRequest.sign, {owner:'s',sig:'s'})
  if (err){
    warn('addJoinRequest: bad joinRequest.sign '+err)
    return false
  }
  if (! crypto.verify(joinRequest)){
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
        warn('Error sending data to dataRecipient.', err)
        removeDataRecipient(recipient.nodeInfo.publicKey)
      })
  }
}

export function sendPartitionData(partitionReceipt, paritionObject) {
  // for (const nodeInfo of cycleRecipients) {
  //   const nodeUrl = `http://${nodeInfo.ip}:${nodeInfo.port}/post_partition`
  //   http.post(nodeUrl, { partitionReceipt, paritionObject })
  //     .catch(err => {
  //       warn(`sendPartitionData: Failed to post to ${nodeUrl} ` + err)
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
  //       warn(`sendTransactionData: Failed to post to ${nodeUrl} ` + err)
  //     })
  // }
}

export function registerRoutes() {
  network.registerExternalPost('joinarchiver', async (req, res) => {
    let err = validateTypes(req, {body:'o'})
    if (err) {
      warn(`joinarchiver: bad req ${err}`)
      return res.json({ success: false, error: err})
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
    let err = validateTypes(req, {body:'o'})
    if (err) {
      warn(`requestdata: bad req ${err}`)
      return res.json({ success: false, error: err})
    }
    err = validateTypes(req.body, {lastData:'n',type:'s',publicKey:'s',tag:'s'})
    if (err) {
      warn(`requestdata: bad req.body ${err}`)
      return res.json({ success: false, error: err})
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
