const http = require('../http')

class P2PArchivers {
  constructor (logger, p2p, state, crypto) {
    this.mainLogger = logger.getLogger('main')
    this.p2p = p2p
    this.state = state
    this.crypto = crypto
    this.joinRequests = []
    this.archiversList = []
    this.dataRecipients = []
    this.recipientTypes = {}
  }

  logDebug (msg) {
    this.mainLogger.debug('P2PArchivers: ' + msg)
  }

  logError (msg) {
    this.mainLogger.error('P2PArchivers: ', msg)
  }

  reset () {
    this.joinRequests = []
    this.archiversList = []
    this.dataRecipients = []
    this.recipientTypes = {}
  }

  resetJoinRequests () {
    this.joinRequests = []
  }

  async addJoinRequest (joinRequest, tracker, gossip = true) {
    // [TODO] Verify signature

    if (this.state.acceptJoinRequests === false) {
      return false
    }
    this.joinRequests.push(joinRequest)
    if (gossip === true) {
      this.p2p.sendGossipIn('joinarchiver', joinRequest, tracker)
    }
    return true
  }

  getArchiverUpdates () {
    return this.joinRequests
  }

  updateArchivers (joinedArchivers) {
    // Update archiversList
    for (const nodeInfo of joinedArchivers) {
      this.archiversList.push(nodeInfo)
    }
  }

  addDataRecipient (nodeInfo, dataRequest) {
    const recipient = {
      nodeInfo,
      type: dataRequest.type,
      curvePk: this.crypto.convertPublicKeyToCurve(nodeInfo.publicKey)
    }
    this.dataRecipients.push(recipient)

    let dataResponse = {}
    dataResponse.publicKey = this.crypto.getPublicKey()
    dataResponse.type = recipient.type
    dataResponse.data = []

    switch (recipient.type) {
      case 'CYCLE' : {
        // Get an array of cycles since counter = dataRequest.lastData
        const start = dataRequest.lastData
        const end = this.state.getLastCycleCounter()
        dataResponse.data = this.p2p.getCycleChain(start, end) || []
        this.logDebug(`Responding to cycle dataRequest [${start}-${end}] with ${JSON.stringify(dataResponse)}`)
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
    }

    // Tag dataResponse
    const taggedDataResponse = this.crypto.tag(dataResponse, recipient.curvePk)

    const recipientUrl = `http://${recipient.nodeInfo.ip}:${recipient.nodeInfo.port}/newdata`
    http.post(recipientUrl, taggedDataResponse)
      .catch(err => {
        this.logError(`addDataRecipient: Failed to post to ${recipientUrl} ` + err)
      })
  }

  removeDataRecipient (publicKey) {
    let recipient
    for (let i = this.dataRecipients.length - 1; i >= 0; i--) {
      recipient = this.dataRecipients[i]
      if (recipient.nodeInfo.publicKey === publicKey) {
        this.dataRecipients.splice(i, 1)
      }
    }
  }

  sendData (cycle) {
    for (const recipient of this.dataRecipients) {
      const recipientUrl = `http://${recipient.nodeInfo.ip}:${recipient.nodeInfo.port}/newdata`

      let dataResponse = {}
      dataResponse.publicKey = this.crypto.getPublicKey()
      dataResponse.type = recipient.type
      dataResponse.data = []

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
      }

      // Tag dataResponse
      const taggedDataResponse = this.crypto.tag(dataResponse, recipient.curvePk)

      http.post(recipientUrl, taggedDataResponse)
        .then(dataKeepAlive => {
          if (dataKeepAlive.keepAlive === false) {
            // Remove recipient from dataRecipients
            this.removeDataRecipient(recipient.nodeInfo.publicKey)
          }
        })
        .catch(err => {
          // Remove recipient from dataRecipients
          this.logError('Error sending data to dataRecipient.', err)
          this.removeDataRecipient(recipient.nodeInfo.publicKey)
        })
    }
  }

  sendPartitionData (partitionReceipt, paritionObject) {
    for (const nodeInfo of this.cycleRecipients) {
      const nodeUrl = `http://${nodeInfo.ip}:${nodeInfo.port}/post_partition`
      http.post(nodeUrl, { partitionReceipt, paritionObject })
        .catch(err => {
          this.logError(`sendPartitionData: Failed to post to ${nodeUrl} ` + err)
        })
    }
  }

  sendTransactionData (partitionNumber, cycleNumber, transactions) {
    for (const nodeInfo of this.cycleRecipients) {
      const nodeUrl = `http://${nodeInfo.ip}:${nodeInfo.port}/post_transactions`
      http.post(nodeUrl, { partitionNumber, cycleNumber, transactions })
        .catch(err => {
          this.logError(`sendTransactionData: Failed to post to ${nodeUrl} ` + err)
        })
    }
  }

  registerRoutes () {
    this.p2p.network.registerExternalPost('joinarchiver', async (req, res) => {
      if (!this.state.acceptJoinRequests) {
        return res.json({ success: false, error: 'not accepting archiver join requests' })
      }

      const invalidJoinReqErr = 'Invalid archiver join request'
      if (!req.body) {
        this.logError(invalidJoinReqErr)
        return res.json({ success: false, error: invalidJoinReqErr })
      }

      const joinRequest = req.body
      this.logDebug(`Archiver join request received: ${JSON.stringify(joinRequest)}`)
      res.json({ success: true })

      const accepted = await this.addJoinRequest(joinRequest)
      if (!accepted) return this.logDebug('Archiver join request not accepted.')
      this.logDebug('Archiver join request accepted!')
    })

    this.p2p.registerGossipHandler('joinarchiver', async (payload, sender, tracker) => {
      if (!this.state.acceptJoinRequests) return this.logDebug('Archiver join request not accepted. Not accepting join requests currently.')
      const accepted = await this.addJoinRequest(payload, tracker, false)
      if (!accepted) return this.logDebug('Archiver join request not accepted.')
      this.logDebug('Archiver join request accepted!')
    })

    this.p2p.network.registerExternalPost('requestdata', (req, res) => {
      const invalidDataReqErr = 'Invalid data request'
      if (!req.body) {
        this.logError(invalidDataReqErr)
        return res.json({ success: false, error: invalidDataReqErr })
      }

      const dataRequest = req.body

      // [TODO] Authenticate tag
      /*
      const invalidTagErr = 'Tag is invalid'
      if (!this.crypto.authenticate(dataRequest, this.crypto.getCurvePublicKey(dataRequest.publicKey))) {
        this.logError(invalidTagErr)
        return res.json({ success: false, error: invalidTagErr })
      }
      */

      const nodeInfo = this.archiversList.find(archiver => archiver.publicKey === dataRequest.publicKey)

      const archiverNotFoundErr = 'Archiver not found in list'
      if (!nodeInfo) {
        this.logError(archiverNotFoundErr)
        return res.json({ success: false, error: archiverNotFoundErr })
      }

      delete dataRequest.publicKey
      delete dataRequest.tag

      this.addDataRecipient(nodeInfo, dataRequest)
    })

    this.p2p.network.registerExternalGet('archivers', (req, res) => {
      res.json({ archivers: this.archiversList })
    })

    this.p2p.network.registerExternalGet('datarecipients', (req, res) => {
      res.json({ dataRecipients: this.dataRecipients })
    })
  }
}

module.exports = P2PArchivers
