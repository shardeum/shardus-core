import * as http from '../http'
import * as Comms from './Comms'
import { crypto, logger, network } from './Context'
import * as CycleChain from './CycleChain'

/** TYPES */

interface DataResponse {
  publicKey: string
  type: string
  data: unknown[]
}

/** STATE */

let mainLogger 
let joinRequests
let archiversList
let dataRecipients
let recipientTypes

/** FUNCTIONS */

export function init() {
  mainLogger = logger.getLogger('main')
  reset()
}

function logDebug (...msgs) {
  mainLogger.debug('P2PArchivers: ' + msgs.map(msg => JSON.stringify(msg)).join(', '))
}

function logError (...msgs) {
  mainLogger.error('P2PArchivers: ' + msgs.map(msg => JSON.stringify(msg)).join(', '))
}

export function reset () {
  joinRequests = []
  archiversList = []
  dataRecipients = []
  recipientTypes = {}
}

export function resetJoinRequests () {
  joinRequests = []
}

export function addJoinRequest (joinRequest, tracker?, gossip = true) {
  // [TODO] Verify signature

  joinRequests.push(joinRequest)
  if (gossip === true) {
    Comms.sendGossipIn('joinarchiver', joinRequest, tracker)
  }
  return true
}

export function getArchiverUpdates () {
  return joinRequests
}

export function updateArchivers (joinedArchivers) {
  // Update archiversList
  for (const nodeInfo of joinedArchivers) {
    archiversList.push(nodeInfo)
  }
}

export function addDataRecipient (nodeInfo, dataRequest) {
  const recipient = {
    nodeInfo,
    type: dataRequest.type,
    curvePk: crypto.convertPublicKeyToCurve(nodeInfo.publicKey)
  }
  dataRecipients.push(recipient)

  const dataResponse: DataResponse = {
    publicKey: crypto.getPublicKey(),
    type: recipient.type,
    data: []
  }
  
  
  

  switch (recipient.type) {
    case 'CYCLE' : {
      // Get an array of cycles since counter = dataRequest.lastData
      const start = dataRequest.lastData
      dataResponse.data = CycleChain.getCycleChain(start)
      logDebug(`Responding to cycle dataRequest [${start}-latest] with ${JSON.stringify(dataResponse)}`)
      break
    }
    case 'TRANSACTION' : {
      // [TODO] Get an array of txs since tx id = dataRequest.lastData
      break
    }
    case 'PARTITION' : {
      // [TODO] Get an array of txs since partition hash = dataRequest.lastData
      break
    }
    default:
  }

  // Tag dataResponse
  const taggedDataResponse = crypto.tag(dataResponse, recipient.curvePk)

  const recipientUrl = `http://${recipient.nodeInfo.ip}:${recipient.nodeInfo.port}/newdata`
  http.post(recipientUrl, taggedDataResponse)
    .catch(err => {
      logError(`addDataRecipient: Failed to post to ${recipientUrl} ` + err)
    })
}

function removeDataRecipient (publicKey) {
  let recipient
  for (let i = dataRecipients.length - 1; i >= 0; i--) {
    recipient = dataRecipients[i]
    if (recipient.nodeInfo.publicKey === publicKey) {
      dataRecipients.splice(i, 1)
    }
  }
}

export function sendData (cycle) {
  for (const recipient of dataRecipients) {
    const recipientUrl = `http://${recipient.nodeInfo.ip}:${recipient.nodeInfo.port}/newdata`

    const dataResponse: DataResponse = {
      publicKey:crypto.getPublicKey(),
      type:recipient.type,
      data:[]
    }

    switch (recipient.type) {
      case 'CYCLE' : {
        // Send latest cycle
        dataResponse.data.push(cycle)
        break
      }
      case 'TRANSACTION' : {
        // [TODO] Send latest txs
        break
      }
      case 'PARTITION' : {
        // [TODO] Send latest partitions
        break
      }
      default:
    }

    // Tag dataResponse
    const taggedDataResponse = crypto.tag(dataResponse, recipient.curvePk)

    http.post(recipientUrl, taggedDataResponse)
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

export function sendPartitionData (partitionReceipt, paritionObject) {
  // for (const nodeInfo of cycleRecipients) {
  //   const nodeUrl = `http://${nodeInfo.ip}:${nodeInfo.port}/post_partition`
  //   http.post(nodeUrl, { partitionReceipt, paritionObject })
  //     .catch(err => {
  //       logError(`sendPartitionData: Failed to post to ${nodeUrl} ` + err)
  //     })
  // }
}

export function sendTransactionData (partitionNumber, cycleNumber, transactions) {
  // for (const nodeInfo of cycleRecipients) {
  //   const nodeUrl = `http://${nodeInfo.ip}:${nodeInfo.port}/post_transactions`
  //   http.post(nodeUrl, { partitionNumber, cycleNumber, transactions })
  //     .catch(err => {
  //       logError(`sendTransactionData: Failed to post to ${nodeUrl} ` + err)
  //     })
  // }
}

export function registerRoutes () {
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


  Comms.registerGossipHandler('joinarchiver', async (payload, sender, tracker) => {
    const accepted = await addJoinRequest(payload, tracker, false)
    if (!accepted) return logDebug('Archiver join request not accepted.')
    logDebug('Archiver join request accepted!')
  })

  network.registerExternalPost('requestdata', (req, res) => {
    const invalidDataReqErr = 'Invalid data request'
    if (!req.body) {
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

    const nodeInfo = archiversList.find(archiver => archiver.publicKey === dataRequest.publicKey)

    const archiverNotFoundErr = 'Archiver not found in list'
    if (!nodeInfo) {
      logError(archiverNotFoundErr)
      return res.json({ success: false, error: archiverNotFoundErr })
    }

    delete dataRequest.publicKey
    delete dataRequest.tag

    addDataRecipient(nodeInfo, dataRequest)
  })

  network.registerExternalGet('archivers', (req, res) => {
    res.json({ archivers: archiversList })
  })

  network.registerExternalGet('datarecipients', (req, res) => {
    res.json({ dataRecipients })
  })
}