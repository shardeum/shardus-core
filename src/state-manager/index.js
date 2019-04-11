const EventEmitter = require('events')
const utils = require('../utils')

// todo m12: need error handling on all the p2p requests.

const allZeroes64 = '0'.repeat(64)

class StateManager extends EventEmitter {
  constructor (verboseLogs, profiler, app, consensus, logger, storage, p2p, crypto, config) {
    super()
    this.verboseLogs = verboseLogs
    this.profiler = profiler
    this.mainLogger = logger.getLogger('main')
    this.fatalLogger = logger.getLogger('fatal')
    this.p2p = p2p
    this.crypto = crypto
    this.storage = storage
    this.app = app
    this.consensus = consensus
    this.logger = logger
    this.config = config

    this._listeners = {}

    this.completedPartitions = []
    this.mainStartingTs = Date.now()

    this.queueSitTime = 6000 // todo make this a setting. and tie in with the value in consensus
    // this.syncSettleTime = 8000 // 3 * 10 // an estimate of max transaction settle time. todo make it a config or function of consensus later
    this.syncSettleTime = this.queueSitTime + 2000 // 3 * 10 // an estimate of max transaction settle time. todo make it a config or function of consensus later

    this.clearPartitionData()

    this.acceptedTXQueue = []
    this.acceptedTXByHash = {}
    this.registerEndpoints()

    this.isSyncingAcceptedTxs = true // default is true so we will start adding to our tx queue asap

    this.verboseLogs = false
    if (this.mainLogger && ['TRACE'].includes(this.mainLogger.level.levelStr)) {
      this.verboseLogs = true
    }

    this.newAcceptedTXQueue = []
    this.newAcceptedTXQueueRunning = false
    this.dataSyncMainPhaseComplete = false

    this.dataPhaseTag = 'DATASYNC: '
    // this.accountRepair
    this.applySoftLock = false
    this.queueStopped = false
  }

  /* -------- DATASYNC Functions ---------- */

  // this clears state data related to the current partion we are processing.
  clearPartitionData () {
    // These are all for the given partition
    this.addressRange = null
    this.dataSourceNode = null
    this.removedNodes = []

    // this.state = EnumSyncState.NotStarted
    this.allFailedHashes = []
    this.inMemoryStateTableData = []

    this.combinedAccountData = []
    this.lastStateSyncEndtime = 0

    this.visitedNodes = {} // map of node we have visited

    this.accountsWithStateConflict = []
    this.failedAccounts = [] // todo m11: determine how/when we will pull something out of this list!
    this.mapAccountData = {}

    this.fifoLocks = {}
  }

  // TODO: Milestone 14-15? this will take a short list of account IDs and get us resynced on them
  async resyncIndividualAccounts (accountsList) {
    this.isSyncingAcceptedTxs = true
    // make sure we are patched up to date on state data
    // get fresh copies of account data
    // catch up to tx queue

    this.isSyncingAcceptedTxs = false
  }

  // TODO: Milestone 13.  this is the resync procedure that keeps existing app data and attempts to update it
  async resyncStateData (requiredNodeCount) {
    this.isSyncingAcceptedTxs = true
    // 1. Determine the time window that needs to be covered (when were we last active)

    // 2. query accepted transactions for the given range

    // 3. query state table data to cover the range

    // 4. re-processAccountData .  similar to process data but should handle working with only accounts that had new transactions in the given time.

    // 5. any error handling / loops etc.

    // 6a. catch up to tx queue

    // 6. optionally?  validate hashes on our data range? over a givn time..
    this.isSyncingAcceptedTxs = false
  }

  // syncs transactions and application state data
  // This is the main outer loop that will loop over the different partitions
  // The last step catch up on the acceptedTx queue
  async syncStateData (requiredNodeCount) {
    // Dont sync if first node
    if (this.p2p.isFirstSeed) {
      this.dataSyncMainPhaseComplete = true
      return
    }

    this.isSyncingAcceptedTxs = true
    await utils.sleep(5000) // Temporary delay to make it easier to attach a debugger
    console.log('syncStateData start')
    // delete and re-create some tables before we sync:
    await this.storage.clearAppRelatedState()
    await this.app.deleteLocalAccountData()

    this.mainLogger.debug(`DATASYNC: starting syncStateData`)

    this.requiredNodeCount = requiredNodeCount
    // in the future, loop through and call this for each partition
    // todo after enterprise: use only the address range that our node needs
    for (let i = 0; i < this.getNumPartitions(); i++) {
      await this.syncStateDataForPartition(i)
      this.completedPartitions.push(i)
      this.clearPartitionData()
    }

    // one we have all of the initial data the last thing to do is get caught up on transactions
    // This will await the queue processing up to Date.now()
    await this._firstTimeQueueAwait()

    console.log('syncStateData end' + '   time:' + Date.now())

    // all complete!
    this.mainLogger.debug(`DATASYNC: complete`)
    this.logger.playbackLogState('datasyncComplete', '', '')

    // update the debug tag and restart the queue
    this.dataPhaseTag = 'STATESYNC: '
    this.dataSyncMainPhaseComplete = true
    this.tryStartAcceptedQueue()
  }

  async syncStateDataForPartition (partition) {
    try {
      this.currentPartition = partition
      this.addressRange = this.partitionToAddressRange(partition)

      this.partitionStartTimeStamp = Date.now()

      let lowAddress = this.addressRange.low
      let highAddress = this.addressRange.high

      this.mainLogger.debug(`DATASYNC: syncStateDataForPartition partition: ${partition} low: ${lowAddress} high: ${highAddress} `)

      await this.syncStateTableData(lowAddress, highAddress, 0, Date.now() - this.syncSettleTime)
      this.mainLogger.debug(`DATASYNC: partition: ${partition}, syncStateTableData 1st pass done.`)

      await this.syncAccountData(lowAddress, highAddress)
      this.mainLogger.debug(`DATASYNC: partition: ${partition}, syncAccountData done.`)

      // potentially do the next 2 blocks periodically in the account data retreval so we can flush data to disk!  generalize the account state table update so it can be called 'n' times

      // Sync the Account State Table Second Pass
      //   Wait at least 10T since the Ts_end time of the First Pass
      //   Same as the procedure for First Pass except:
      //   Ts_start should be the Ts_end value from last time and Ts_end value should be current time minus 10T
      await this.syncStateTableData(lowAddress, highAddress, this.lastStateSyncEndtime, Date.now())
      this.mainLogger.debug(`DATASYNC: partition: ${partition}, syncStateTableData 2nd pass done.`)

      // Process the Account data
      //   For each account in the Account data make sure the entry in the Account State Table has the same State_after value; if not remove the record from the Account data
      //   For each account in the Account State Table make sure the entry in Account data has the same State_after value; if not save the account id to be looked up later
      //   Use the App.set_account_data function with the Account data to save the data to the application Accounts Table; if any failed accounts are returned save the account id to be looked up later
      await this.processAccountData()
      this.mainLogger.debug(`DATASYNC: partition: ${partition}, processAccountData done.`)

      // Sync the failed accounts
      //   Log that some account failed
      //   Use the /get_account_data_by_list API to get the data for the accounts that need to be looked up later from any of the nodes that had a matching hash but different from previously used nodes
      //   Repeat the “Sync the Account State Table Second Pass” step
      //   Repeat the “Process the Account data” step
      await this.syncFailedAcccounts(lowAddress, highAddress)
    } catch (error) {
      if (error.message.includes('FailAndRestartPartition')) {
        this.mainLogger.debug(`DATASYNC: Error Failed at: ${error.stack}`)
        this.fatalLogger.fatal('DATASYNC: FailAndRestartPartition: ' + error.name + ': ' + error.message + ' at ' + error.stack)
        await this.failandRestart()
      } else {
        this.fatalLogger.fatal('syncStateDataForPartition failed: ' + error.name + ': ' + error.message + ' at ' + error.stack)
        this.mainLogger.debug(`DATASYNC: unexpected error. restaring sync:` + error.name + ': ' + error.message + ' at ' + error.stack)
        await this.failandRestart()
      }
    }
  }

  partitionToAddressRange (partition) {
    // let numPartitions = getNumPartitions()
    // let partitionFraction = partition / numPartitions
    // todo after enterprise: implement partition->address range math.  possibly store it in a lookup table
    let result = {}
    result.partition = partition
    result.low = '0'.repeat(64)
    result.high = 'f'.repeat(64)
    return result
  }

  getNumPartitions () {
    // hardcoded to one in enterprise
    return 1
  }

  // todo refactor: this into a util, grabbed it from p2p
  // From: https://stackoverflow.com/a/12646864
  shuffleArray (array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]]
    }
  }

  // todo refactor: move to p2p?
  getRandomNodesInRange (count, lowAddress, highAddress, exclude) {
    let allNodes = this.p2p.state.getActiveNodes(this.p2p.id)
    this.shuffleArray(allNodes)
    let results = []
    if (allNodes.length <= count) {
      count = allNodes.length
    }
    for (const node of allNodes) {
      if (node.id >= lowAddress && node.id <= highAddress) {
        if ((node.id in exclude) === false) {
          results.push(node)
          if (results.length >= count) {
            return results
          }
        }
      }
    }
    return results
  }

  async syncStateTableData (lowAddress, highAddress, startTime, endTime) {
    let searchingForGoodData = true

    console.log(`syncStateTableData startTime: ${startTime} endTime: ${endTime}` + '   time:' + Date.now())
    this.mainLogger.debug(`DATASYNC: syncStateTableData startTime: ${startTime} endTime: ${endTime} low: ${lowAddress} high: ${highAddress} `)
    // todo m11: this loop will try three more random nodes, this is slightly different than described how to handle failure in the doc. this should be corrected but will take more code
    // should prossible break this into a state machine in  its own class.
    while (searchingForGoodData) { // todo m11: this needs to be replaced
      // Sync the Account State Table First Pass
      //   Use the /get_account_state_hash API to get the hash from 3 or more nodes until there is a match between 3 nodes. Ts_start should be 0, or beginning of time.  The Ts_end value should be current time minus 10T (as configured)
      //   Use the /get_account_state API to get the data from one of the 3 nodes
      //   Take the hash of the data to ensure that it matches the expected hash value
      //   If not try getting the data from another node
      //   If the hash matches then update our Account State Table with the data
      //   Repeat this for each address range or partition
      let currentTs = Date.now()

      let safeTime = currentTs - this.syncSettleTime
      if (endTime >= safeTime) {
        // need to idle for bit
        await utils.sleep(endTime - safeTime)
      }
      this.lastStateSyncEndtime = endTime + 1 // Adding +1 so that the next query will not overlap the time bounds. this saves us from a bunch of data tracking and filtering to remove duplicates when this function is called later

      let firstHash
      let queryLow
      let queryHigh

      queryLow = lowAddress
      queryHigh = highAddress
      let message = { accountStart: queryLow, accountEnd: queryHigh, tsStart: startTime, tsEnd: endTime }

      let equalFn = (a, b) => {
        return a.stateHash === b.stateHash
      }
      let queryFn = async (node) => {
        let result = await this.p2p.ask(node, 'get_account_state_hash', message)
        return result
      }
      let nodes = this.p2p.state.getActiveNodes(this.p2p.id)
      if (nodes.length === 0) {
        this.mainLogger.debug(`no nodes available`)
        return // nothing to do
      }
      this.mainLogger.debug(`DATASYNC: robustQuery get_account_state_hash from ${utils.stringifyReduce(nodes.map(node => utils.makeShortHash(node.id) + ':' + node.externalPort))}`)
      let result
      let winners
      try {
        [result, winners] = await this.p2p.robustQuery(nodes, queryFn, equalFn, 3)
      } catch (ex) {
        this.mainLogger.debug('syncStateTableData: robustQuery ' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
        this.fatalLogger.fatal('syncStateTableData: robustQuery ' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
        throw new Error('FailAndRestartPartition0')
      }

      if (result && result.stateHash) {
        this.mainLogger.debug(`DATASYNC: robustQuery returned result: ${result.stateHash}`)
        if (!winners || winners.length === 0) {
          this.mainLogger.debug(`DATASYNC: no winners, going to throw fail and restart`)
          this.fatalLogger.fatal(`DATASYNC: no winners, going to throw fail and restart`) // todo: consider if this is just an error
          throw new Error('FailAndRestartPartition1')
        }
        this.dataSourceNode = winners[0] // Todo random index
        this.mainLogger.debug(`DATASYNC: got hash ${result.stateHash} from ${utils.stringifyReduce(winners.map(node => utils.makeShortHash(node.id) + ':' + node.externalPort))}`)
        firstHash = result.stateHash
      } else {
        this.mainLogger.debug(`DATASYNC: robustQuery get_account_state_hash failed`)
        throw new Error('FailAndRestartPartition2')
      }

      let moreDataRemaining = true
      this.combinedAccountStateData = []
      let loopCount = 0

      let lowTimeQuery = startTime
      this.mainLogger.debug(`DATASYNC: hash: getting state table data from: ${utils.makeShortHash(this.dataSourceNode.id) + ':' + this.dataSourceNode.externalPort}`)

      // this loop is required since after the first query we may have to adjust the address range and re-request to get the next N data entries.
      while (moreDataRemaining) {
        let message = { accountStart: queryLow, accountEnd: queryHigh, tsStart: lowTimeQuery, tsEnd: endTime }
        let result = await this.p2p.ask(this.dataSourceNode, 'get_account_state', message)

        let accountStateData = result.accountStates
        // get the timestamp of the last account state received so we can use it as the low timestamp for our next query
        if (accountStateData.length > 0) {
          let lastAccount = accountStateData[accountStateData.length - 1]
          if (lastAccount.txTimestamp > lowTimeQuery) {
            lowTimeQuery = lastAccount.txTimestamp
          }
        }

        // If this is a repeated query, clear out any dupes from the new list we just got.
        // There could be many rows that use the stame timestamp so we will search and remove them
        let dataDuplicated = true
        if (loopCount > 0) {
          while (accountStateData.length > 0 && dataDuplicated) {
            let stateData = accountStateData[0]
            dataDuplicated = false
            for (let i = this.combinedAccountStateData.length - 1; i >= 0; i--) {
              let existingStateData = this.combinedAccountStateData[i]
              if ((existingStateData.txTimestamp === stateData.txTimestamp) && (existingStateData.accountId === stateData.accountId)) {
                dataDuplicated = true
                break
              }
              // once we get to an older timestamp we can stop looking, the outer loop will be done also
              if (existingStateData.txTimestamp < stateData.txTimestamp) {
                break
              }
            }
            if (dataDuplicated) {
              accountStateData.shift()
            }
          }
        }

        if (accountStateData.length === 0) {
          moreDataRemaining = false
        } else {
          this.mainLogger.debug(`DATASYNC: syncStateTableData got ${accountStateData.length} more records`)
          this.combinedAccountStateData = this.combinedAccountStateData.concat(accountStateData)
          loopCount++
        }
      }

      let recievedStateDataHash = this.crypto.hash(this.combinedAccountStateData)

      if (recievedStateDataHash === firstHash) {
        searchingForGoodData = false
      } else {
        this.mainLogger.debug(`DATASYNC: syncStateTableData finished downloading the requested data but the hash does not match`)
        // Failed again back through loop! TODO ? record/eval/report blame?
        this.recordPotentialBadnode()
        throw new Error('FailAndRestartPartition')
      }

      this.mainLogger.debug(`DATASYNC: syncStateTableData saving ${this.combinedAccountStateData.length} records to db`)
      // If the hash matches then update our Account State Table with the data
      await this.storage.addAccountStates(this.combinedAccountStateData) // keep in memory copy for faster processing...
      this.inMemoryStateTableData = this.inMemoryStateTableData.concat(this.combinedAccountStateData)
    }
  }

  // sync account data by address range
  async syncAccountDataOld (lowAddress, highAddress) {
    // Sync the Account data
    //   Use the /get_account_data API to get the data from the Account Table using any of the nodes that had a matching hash
    console.log(`syncAccountData` + '   time:' + Date.now())

    let queryLow = lowAddress
    let queryHigh = highAddress

    let moreDataRemaining = true

    this.combinedAccountData = []
    let loopCount = 0
    // this loop is required since after the first query we may have to adjust the address range and re-request to get the next N data entries.
    while (moreDataRemaining) {
      // max records artificially low to make testing coverage better.  todo refactor: make it a config or calculate based on data size
      let message = { accountStart: queryLow, accountEnd: queryHigh, maxRecords: 3 }
      let result = await this.p2p.ask(this.dataSourceNode, 'get_account_data', message) // need the repeatable form... possibly one that calls apply to allow for datasets larger than memory
      // accountData is in the form [{accountId, stateId, data}] for n accounts.
      let accountData = result.accountData

      let lastAccount
      let firstAccount
      // get the address of the last account received so we can use it as the low address for our next query
      if (accountData.length > 0) {
        lastAccount = accountData[accountData.length - 1]
        firstAccount = accountData[0]
        if (lastAccount.accountId > queryLow) {
          queryLow = lastAccount.accountId
        }
      }

      // if this is a repeated query, clear out any dupes from the new list we just got
      // there should be only one dupe in since account ids are unique
      if (loopCount > 0 && accountData.length > 0) {
        if (this.combinedAccountData[this.combinedAccountData.length - 1].accountId === firstAccount.accountId) {
          accountData.shift()
        }
      }

      if (accountData.length === 0) {
        moreDataRemaining = false
      } else {
        this.mainLogger.debug(`DATASYNC: syncAccountData got ${accountData.length} more records`)
        this.combinedAccountData = this.combinedAccountData.concat(accountData)
        loopCount++
      }
    }
  }

  // syncs account data up to a certain time by making time based queries
  async syncAccountDataOld2 (lowAddress, highAddress) {
    // Sync the Account data
    //   Use the /get_account_data API to get the data from the Account Table using any of the nodes that had a matching hash
    console.log(`syncAccountData2` + '   time:' + Date.now())

    let queryLow = lowAddress
    let queryHigh = highAddress

    let moreDataRemaining = true

    this.combinedAccountData = []
    let loopCount = 0

    let startTime = 0
    let endTime = this.mainStartingTs + 50000 // todo get better end time
    let lowTimeQuery = startTime
    // this loop is required since after the first query we may have to adjust the address range and re-request to get the next N data entries.
    while (moreDataRemaining) {
      // max records artificially low to make testing coverage better.  todo refactor: make it a config or calculate based on data size
      let message = { accountStart: queryLow, accountEnd: queryHigh, tsStart: startTime, tsEnd: endTime, maxRecords: 3 }
      let result = await this.p2p.ask(this.dataSourceNode, 'get_account_data2', message) // need the repeatable form... possibly one that calls apply to allow for datasets larger than memory
      // accountData is in the form [{accountId, stateId, data}] for n accounts.
      let accountData = result.accountData

      // get the timestamp of the last account data received so we can use it as the low timestamp for our next query
      if (accountData.length > 0) {
        let lastAccount = accountData[accountData.length - 1]
        if (lastAccount.timestamp > lowTimeQuery) {
          lowTimeQuery = lastAccount.timestamp
          startTime = lowTimeQuery
        }
      }

      // If this is a repeated query, clear out any dupes from the new list we just got.
      // There could be many rows that use the stame timestamp so we will search and remove them
      let dataDuplicated = true
      if (loopCount > 0) {
        while (accountData.length > 0 && dataDuplicated) {
          let stateData = accountData[0]
          dataDuplicated = false
          for (let i = this.combinedAccountData.length - 1; i >= 0; i--) {
            let existingStateData = this.combinedAccountData[i]
            if ((existingStateData.timestamp === stateData.timestamp) && (existingStateData.accountId === stateData.accountId)) {
              dataDuplicated = true
              break
            }
            // once we get to an older timestamp we can stop looking, the outer loop will be done also
            if (existingStateData.timestamp < stateData.timestamp) {
              break
            }
          }
          if (dataDuplicated) {
            accountData.shift()
          }
        }
      }

      if (accountData.length === 0) {
        moreDataRemaining = false
      } else {
        this.mainLogger.debug(`DATASYNC: syncAccountData2 got ${accountData.length} more records`)
        this.combinedAccountData = this.combinedAccountData.concat(accountData)
        loopCount++
        // await utils.sleep(500)
      }
    }
  }

  async syncAccountData (lowAddress, highAddress) {
    // Sync the Account data
    //   Use the /get_account_data API to get the data from the Account Table using any of the nodes that had a matching hash
    console.log(`syncAccountData3` + '   time:' + Date.now())

    let queryLow = lowAddress
    let queryHigh = highAddress

    let moreDataRemaining = true

    this.combinedAccountData = []
    let loopCount = 0

    let startTime = 0
    let lowTimeQuery = startTime
    // this loop is required since after the first query we may have to adjust the address range and re-request to get the next N data entries.
    while (moreDataRemaining) {
      // max records artificially low to make testing coverage better.  todo refactor: make it a config or calculate based on data size
      let message = { accountStart: queryLow, accountEnd: queryHigh, tsStart: startTime, maxRecords: this.config.stateManager.accountBucketSize }
      let result = await this.p2p.ask(this.dataSourceNode, 'get_account_data3', message) // need the repeatable form... possibly one that calls apply to allow for datasets larger than memory
      // accountData is in the form [{accountId, stateId, data}] for n accounts.
      let accountData = result.data.wrappedAccounts

      let lastUpdateNeeded = result.data.lastUpdateNeeded

      // get the timestamp of the last account data received so we can use it as the low timestamp for our next query
      if (accountData.length > 0) {
        let lastAccount = accountData[accountData.length - 1]
        if (lastAccount.timestamp > lowTimeQuery) {
          lowTimeQuery = lastAccount.timestamp
          startTime = lowTimeQuery
        }
      }

      // If this is a repeated query, clear out any dupes from the new list we just got.
      // There could be many rows that use the stame timestamp so we will search and remove them
      let dataDuplicated = true
      if (loopCount > 0) {
        while (accountData.length > 0 && dataDuplicated) {
          let stateData = accountData[0]
          dataDuplicated = false
          for (let i = this.combinedAccountData.length - 1; i >= 0; i--) {
            let existingStateData = this.combinedAccountData[i]
            if ((existingStateData.timestamp === stateData.timestamp) && (existingStateData.accountId === stateData.accountId)) {
              dataDuplicated = true
              break
            }
            // once we get to an older timestamp we can stop looking, the outer loop will be done also
            if (existingStateData.timestamp < stateData.timestamp) {
              break
            }
          }
          if (dataDuplicated) {
            accountData.shift()
          }
        }
      }

      // if we have any accounts in wrappedAccounts2
      let accountData2 = result.data.wrappedAccounts2
      if (accountData2.length > 0) {
        while (accountData.length > 0 && dataDuplicated) {
          let stateData = accountData2[0]
          dataDuplicated = false
          for (let i = this.combinedAccountData.length - 1; i >= 0; i--) {
            let existingStateData = this.combinedAccountData[i]
            if ((existingStateData.timestamp === stateData.timestamp) && (existingStateData.accountId === stateData.accountId)) {
              dataDuplicated = true
              break
            }
            // once we get to an older timestamp we can stop looking, the outer loop will be done also
            if (existingStateData.timestamp < stateData.timestamp) {
              break
            }
          }
          if (dataDuplicated) {
            accountData2.shift()
          }
        }
      }

      if (lastUpdateNeeded || (accountData2.length === 0 && accountData.length === 0)) {
        moreDataRemaining = false
        this.mainLogger.debug(`DATASYNC: syncAccountData3 got ${accountData.length} more records.  last update: ${lastUpdateNeeded} extra records: ${result.data.wrappedAccounts2.length} tsStart: ${lowTimeQuery} highestTS1: ${result.data.highestTs}`)
        if (accountData.length > 0) {
          this.combinedAccountData = this.combinedAccountData.concat(accountData)
        }
        if (accountData2.length > 0) {
          this.combinedAccountData = this.combinedAccountData.concat(accountData2)
        }
      } else {
        this.mainLogger.debug(`DATASYNC: syncAccountData3 got ${accountData.length} more records.  last update: ${lastUpdateNeeded} extra records: ${result.data.wrappedAccounts2.length} tsStart: ${lowTimeQuery} highestTS1: ${result.data.highestTs}`)
        this.combinedAccountData = this.combinedAccountData.concat(accountData)
        loopCount++
        // await utils.sleep(500)
      }
      await utils.sleep(200)
    }
  }

  // this.p2p.registerInternal('get_account_data2', async (payload, respond) => {

  async failandRestart () {
    this.mainLogger.debug(`DATASYNC: failandRestart`)
    this.logger.playbackLogState('datasyncFail', '', '')
    this.clearPartitionData()

    // using set timeout before we resume to prevent infinite stack depth.
    // setTimeout(async () => {
    //   await this.syncStateDataForPartition(this.currentPartition)
    // }, 1000)
    await utils.sleep(1000)
    await this.syncStateDataForPartition(this.currentPartition)
  }

  // just a placeholder for later
  recordPotentialBadnode () {
    // The may need to live on the p2p class, or call into it
    // record the evidence.
    // potentially report it
  }

  // Process the Account data
  //   For each account in the Account data make sure the entry in the Account State Table has the same State_after value; if not remove the record from the Account data
  //   For each account in the Account State Table make sure the entry in Account data has the same State_after value; if not save the account id to be looked up later
  //   Use the App.set_account_data function with the Account data to save the data to the application Accounts Table; if any failed accounts are returned save the account id to be looked up later

  // State data = {accountId, txId, txTimestamp, stateBefore, stateAfter}
  // accountData is in the form [{accountId, stateId, data}] for n accounts.
  async processAccountData () {
    this.missingAccountData = []
    this.mapAccountData = {}
    // create a fast lookup map for the accounts we have.  Perf.  will need to review if this fits into memory.  May need a novel structure.
    let account
    for (let i = 0; i < this.combinedAccountData.length; i++) {
      account = this.combinedAccountData[i]
      this.mapAccountData[account.accountId] = account
    }

    let accountKeys = Object.keys(this.mapAccountData)
    let uniqueAccounts = accountKeys.length
    let initialCombinedAccountLength = this.combinedAccountData.length
    if (uniqueAccounts < initialCombinedAccountLength) {
      // keep only the newest copies of each account:
      // we need this if using a time based datasync
      this.combinedAccountData = []
      for (let accountID of accountKeys) {
        this.combinedAccountData.push(this.mapAccountData[accountID])
      }
    }

    let missingButOkAccounts = 0
    let missingTXs = 0
    let handledButOk = 0
    let otherMissingCase = 0
    let missingButOkAccountIDs = {}

    let missingAccountIDs = {}

    this.mainLogger.debug(`DATASYNC: processAccountData stateTableCount: ${this.inMemoryStateTableData.length} unique accounts: ${uniqueAccounts}  initial combined len: ${initialCombinedAccountLength}`)
    // For each account in the Account data make sure the entry in the Account State Table has the same State_after value; if not remove the record from the Account data
    for (let stateData of this.inMemoryStateTableData) {
      account = this.mapAccountData[stateData.accountId]
      // does the state data table have a node and we don't have data for it?
      if (account == null) {
        // make sure we have a transaction that matches this in our queue
        // the state table data we are working with is sufficiently old, so that we should have seen a transaction in our queue by the time we could get here
        let txRef = this.acceptedTXByHash[stateData.txId]
        if (txRef == null) {
          missingTXs++
          if (stateData.accountId != null) {
            this.missingAccountData.push(stateData.accountId)
            missingAccountIDs[stateData.accountId] = true
          }
        } else if (stateData.stateBefore === allZeroes64) {
          // this means we are at the start of a valid state table chain that starts with creating an account
          missingButOkAccountIDs[stateData.accountId] = true
          missingButOkAccounts++
        } else if (missingButOkAccountIDs[stateData.accountId] === true) {
          // no action. we dont have account, but we know a different transaction will create it.
          handledButOk++
        } else {
          // unhandled case. not expected.  this would happen if the state table chain does not start with this account being created
          // this could be caused by a node trying to withold account data when syncing
          if (stateData.accountId != null) {
            this.missingAccountData.push(stateData.accountId)
            missingAccountIDs[stateData.accountId] = true
          }
          otherMissingCase++
        }
        // should we check timestamp for the state table data?
        continue
      }

      if (!account.syncData) {
        account.syncData = {}
      }

      if (account.stateId === stateData.stateAfter) {
        // mark it good.
        account.syncData.uptodate = true
        account.syncData.anyMatch = true
      } else {
        //
        account.syncData.uptodate = false
      }
    }

    if (missingButOkAccounts > 0) {
      // it is valid / normal flow to get to this point:
      this.mainLogger.debug(`DATASYNC: processAccountData accouts missing from accountData, but are ok, because we have transactions for them: missingButOKList: ${missingButOkAccounts}, handledbutOK: ${handledButOk}`)
    }
    if (this.missingAccountData.length > 0) {
      // getting this indicates a non-typical problem that needs correcting
      this.mainLogger.debug(`DATASYNC: processAccountData accounts missing from accountData, but in the state table.  This is an unexpected error and we will need to handle them as failed accounts: missingList: ${this.missingAccountData.length}, missingTX count: ${missingTXs} missingUnique: ${Object.keys(missingAccountIDs).length}`)
    }

    //   For each account in the Account State Table make sure the entry in Account data has the same State_after value; if not save the account id to be looked up later
    this.accountsWithStateConflict = []
    this.goodAccounts = []
    let noSyncData = 0
    let noMatches = 0
    for (let account of this.combinedAccountData) {
      if (!account.syncData) {
        // this account was not found in state data
        this.accountsWithStateConflict.push(account)
        noSyncData++
      } else if (!account.syncData.anyMatch) {
        // this account was in state data but none of the state table stateAfter matched our state
        this.accountsWithStateConflict.push(account)
        noMatches++
      } else {
        delete account.syncData
        this.goodAccounts.push(account)
      }
    }

    this.mainLogger.debug(`DATASYNC: processAccountData saving ${this.goodAccounts.length} of ${this.combinedAccountData.length} records to db.  noSyncData: ${noSyncData} noMatches: ${noMatches} missingTXs: ${missingTXs} handledButOk: ${handledButOk} otherMissingCase: ${otherMissingCase}`)
    // failedHashes is a list of accounts that failed to match the hash reported by the server
    let failedHashes = await this.app.setAccountData(this.goodAccounts) // repeatable form may need to call this in batches

    if (failedHashes.length > 1000) {
      this.mainLogger.debug(`DATASYNC: processAccountData failed hashes over 1000:  ${failedHashes.length} restarting sync process`)
      // state -> try another node. TODO record/eval/report blame?
      this.recordPotentialBadnode()
      throw new Error('FailAndRestartPartition')
    }
    if (failedHashes.length > 0) {
      this.mainLogger.debug(`DATASYNC: processAccountData failed hashes:  ${failedHashes.length} will have to download them again`)
      // TODO ? record/eval/report blame?
      this.recordPotentialBadnode()
      this.failedAccounts = this.failedAccounts.concat(failedHashes)
      for (let accountId of failedHashes) {
        account = this.mapAccountData[accountId]

        if (this.verboseLogs) this.mainLogger.debug(`DATASYNC: processAccountData ${accountId}  data: ${utils.stringifyReduce(account)}`)

        if (account != null) {
          if (this.verboseLogs) this.mainLogger.debug(`DATASYNC: processAccountData adding account to list`)
          this.accountsWithStateConflict.push(account)
        } else {
          if (this.verboseLogs) this.mainLogger.debug(`DATASYNC: processAccountData cant find data: ${accountId}`)
          if (accountId) {
            this.accountsWithStateConflict.push({ address: accountId })
          }
        }
      }
    }

    this.combinedAccountData = [] // we can clear this now.
  }

  // Sync the failed accounts
  //   Log that some account failed
  //   Use the /get_account_data_by_list API to get the data for the accounts that need to be looked up later from any of the nodes that had a matching hash but different from previously used nodes
  //   Repeat the “Sync the Account State Table Second Pass” step
  //   Repeat the “Process the Account data” step
  async syncFailedAcccounts (lowAddress, highAddress) {
    if (this.accountsWithStateConflict.length === 0 && this.missingAccountData.length === 0) {
      this.mainLogger.debug(`DATASYNC: syncFailedAcccounts no failed hashes to sync`)
      return
    }
    if (this.verboseLogs) this.mainLogger.debug(`DATASYNC: syncFailedAcccounts start`)
    let addressList = []
    for (let accountEntry of this.accountsWithStateConflict) {
      if (accountEntry.data && accountEntry.data.address) {
        addressList.push(accountEntry.data.address)
      } else {
        if (this.verboseLogs) this.mainLogger.debug(`DATASYNC: syncFailedAcccounts failed to add account ${accountEntry}`)
      }
    }
    // add the addresses of accounts that we got state table data for but not data for
    addressList = addressList.concat(this.missingAccountData)
    this.missingAccountData = []

    // TODO m11:  should we pick different nodes to ask? (at the very least need to change the data source node!!!!!!)
    this.mainLogger.debug(`DATASYNC: syncFailedAcccounts requesting data for failed hashes ${utils.stringifyReduce(addressList)}`)

    let message = { accountIds: addressList }
    let result = await this.p2p.ask(this.dataSourceNode, 'get_account_data_by_list', message)

    this.combinedAccountData = this.combinedAccountData.concat(result.accountData)

    this.mainLogger.debug(`DATASYNC: syncFailedAcccounts combinedAccountData: ${this.combinedAccountData.length} accountData: ${result.accountData.length}`)

    await this.syncStateTableData(lowAddress, highAddress, this.lastStateSyncEndtime, Date.now())

    // process the new accounts.
    await this.processAccountData()
  }

  registerEndpoints () {
    // alternatively we would need to query for accepted tx.

    // This endpoint will likely be a one off thing so that we can test before milesone 15.  after milesone 15 the accepted TX may flow from the consensus coordinator

    // After joining the network
    //   Record Joined timestamp
    //   Even a syncing node will receive accepted transactions
    //   Starts receiving accepted transaction and saving them to Accepted Tx Table
    this.p2p.registerGossipHandler('acceptedTx', async (acceptedTX, sender, tracker) => {
      // docs mention putting this in a table but it seems so far that an in memory queue should be ok
      // should we filter, or instead rely on gossip in to only give us TXs that matter to us?

      this.p2p.sendGossipIn('acceptedTx', acceptedTX, tracker, sender)

      await this.queueAcceptedTransaction(acceptedTX, false, sender)
    })

    // /get_account_state_hash (Acc_start, Acc_end, Ts_start, Ts_end)
    // Acc_start - get data for accounts starting with this account id; inclusive
    // Acc_end - get data for accounts up to this account id; inclusive
    // Ts_start - get data newer than this timestamp
    // Ts_end - get data older than this timestamp
    // Returns a single hash of the data from the Account State Table determined by the input parameters; sort by Tx_ts  then Tx_id before taking the hash
    // Updated names:  accountStart , accountEnd, tsStart, tsEnd
    this.p2p.registerInternal('get_account_state_hash', async (payload, respond) => {
      let result = {}

      // yikes need to potentially hash only N records at a time and return an array of hashes
      let stateHash = await this.getAccountsStateHash(payload.accountStart, payload.accountEnd, payload.tsStart, payload.tsEnd)
      result.stateHash = stateHash
      await respond(result)
    })

    //    /get_account_state (Acc_start, Acc_end, Ts_start, Ts_end)
    // Acc_start - get data for accounts starting with this account id; inclusive
    // Acc_end - get data for accounts up to this account id; inclusive
    // Ts_start - get data newer than this timestamp
    // Ts_end - get data older than this timestamp
    // Returns data from the Account State Table determined by the input parameters; limits result to 1000 records (as configured)
    // Updated names:  accountStart , accountEnd, tsStart, tsEnd
    this.p2p.registerInternal('get_account_state', async (payload, respond) => {
      let result = {}
      // max records set artificially low for better test coverage
      // todo m11: make configs for how many records to query
      let accountStates = await this.storage.queryAccountStateTable(payload.accountStart, payload.accountEnd, payload.tsStart, payload.tsEnd, this.config.stateManager.stateTableBucketSize)
      result.accountStates = accountStates
      await respond(result)
    })

    // /get_accepted_transactions (Ts_start, Ts_end)
    // Ts_start - get data newer than this timestamp
    // Ts_end - get data older than this timestamp
    // Returns data from the Accepted Tx Table starting with Ts_start; limits result to 500 records (as configured)
    // Updated names: tsStart, tsEnd
    this.p2p.registerInternal('get_accepted_transactions', async (payload, respond) => {
      let result = {}

      if (!payload.limit) {
        payload.limit = 10
      }
      let transactions = await this.storage.queryAcceptedTransactions(payload.tsStart, payload.tsEnd, payload.limit)
      result.transactions = transactions
      await respond(result)
    })

    // /get_account_data (Acc_start, Acc_end)
    // Acc_start - get data for accounts starting with this account id; inclusive
    // Acc_end - get data for accounts up to this account id; inclusive
    // Returns data from the application Account Table; limits result to 300 records (as configured);
    // For applications with multiple “Account” tables the returned data is grouped by table name.
    // For example: [ {Acc_id, State_after, Acc_data}, { … }, ….. ]
    // Updated names:  accountStart , accountEnd
    this.p2p.registerInternal('get_account_data', async (payload, respond) => {
      let result = {}
      let accountData = null
      let ourLockID = -1
      try {
        ourLockID = await this.fifoLock('accountModification')
        accountData = await this.app.getAccountData(payload.accountStart, payload.accountEnd, payload.maxRecords)
      } finally {
        this.fifoUnlock('accountModification', ourLockID)
      }
      result.accountData = accountData
      await respond(result)
    })

    this.p2p.registerInternal('get_account_data2', async (payload, respond) => {
      let result = {}
      let accountData = null
      let ourLockID = -1
      try {
        ourLockID = await this.fifoLock('accountModification')
        accountData = await this.app.getAccountData2(payload.accountStart, payload.accountEnd, payload.tsStart, payload.tsEnd, payload.maxRecords)
      } finally {
        this.fifoUnlock('accountModification', ourLockID)
      }
      result.accountData = accountData
      await respond(result)
    })

    this.p2p.registerInternal('get_account_data3', async (payload, respond) => {
      let result = {}
      let accountData = null
      let ourLockID = -1
      try {
        ourLockID = await this.fifoLock('accountModification')
        accountData = await this.app.getAccountData3(payload.accountStart, payload.accountEnd, payload.tsStart, payload.maxRecords)
      } finally {
        this.fifoUnlock('accountModification', ourLockID)
      }
      result.data = accountData
      await respond(result)
    })

    // /get_account_data_by_list (Acc_ids)
    // Acc_ids - array of accounts to get
    // Returns data from the application Account Table for just the given account ids;
    // For applications with multiple “Account” tables the returned data is grouped by table name.
    // For example: [ {Acc_id, State_after, Acc_data}, { … }, ….. ]
    // Updated names:  accountIds, max records
    this.p2p.registerInternal('get_account_data_by_list', async (payload, respond) => {
      let result = {}
      let accountData = null
      let ourLockID = -1
      try {
        ourLockID = await this.fifoLock('accountModification')
        accountData = await this.app.getAccountDataByList(payload.accountIds)
      } finally {
        this.fifoUnlock('accountModification', ourLockID)
      }
      result.accountData = accountData
      await respond(result)
    })
  }

  _unregisterEndpoints () {
    this.p2p.unregisterGossipHandler('acceptedTx')
    this.p2p.unregisterInternal('get_account_state_hash')
    this.p2p.unregisterInternal('get_account_state')
    this.p2p.unregisterInternal('get_accepted_transactions')
    this.p2p.unregisterInternal('get_account_data')
    this.p2p.unregisterInternal('get_account_data2')
    this.p2p.unregisterInternal('get_account_data3')
    this.p2p.unregisterInternal('get_account_data_by_list')
  }

  enableSyncCheck () {
    // return // hack no sync check , dont check in!!!!!
    this._registerListener(this.p2p.state, 'newCycle', (cycles) => process.nextTick(async () => {
      if (cycles.length < 2) {
        return
      }
      let thisCycle = cycles[cycles.length - 1]
      let lastCycle = cycles[cycles.length - 2]
      let endTime = thisCycle.start * 1000
      let startTime = lastCycle.start * 1000

      let accountStart = '0'.repeat(64)
      let accountEnd = 'f'.repeat(64)
      let message = { accountStart, accountEnd, tsStart: startTime, tsEnd: endTime }

      await utils.sleep(this.syncSettleTime) // wait a few seconds for things to settle

      let equalFn = (a, b) => {
        return a.stateHash === b.stateHash
      }
      let queryFn = async (node) => {
        let result = await this.p2p.ask(node, 'get_account_state_hash', message)
        return result
      }
      // let nodes = this.p2p.state.getAllNodes(this.p2p.id)
      let nodes = this.getRandomNodesInRange(100, accountStart, accountEnd, [])
      if (nodes.length === 0) {
        return // nothing to do
      }
      let [result, winners] = await this.p2p.robustQuery(nodes, queryFn, equalFn, 3)
      if (result && result.stateHash) {
        let stateHash = await this.getAccountsStateHash(accountStart, accountEnd, startTime, endTime)
        if (stateHash === result.stateHash) {
          this.logger.playbackLogNote('appStateCheck', '', `Hashes Match = ${utils.makeShortHash(stateHash)} num cycles:${cycles.length} start: ${startTime}  end:${endTime}`)
        } else {
          this.logger.playbackLogNote('appStateCheck', '', `Hashes Dont Match ourState: ${utils.makeShortHash(stateHash)} otherState: ${utils.makeShortHash(result.stateHash)} window: ${startTime} to ${endTime}`)
          // winners[0]
          await this.restoreAccountDataByTx(winners, accountStart, accountEnd, startTime, endTime)
        }
      }
    }))
  }

  async restoreAccountDataByTx (nodes, accountStart, accountEnd, timeStart, timeEnd) {
    this.logger.playbackLogNote('restoreByTx', '', `start`)

    let helper = nodes[0]

    let message = { tsStart: timeStart, tsEnd: timeEnd, limit: 10000 }
    let result = await this.p2p.ask(helper, 'get_accepted_transactions', message) // todo perf, could await these in parallel
    let acceptedTXs = result.transactions

    let toParse = ''
    try {
      for (let i = 0; i < acceptedTXs.length; i++) {
        toParse = acceptedTXs[i]
        if (utils.isObject(toParse) === false) {
          acceptedTXs[i] = JSON.parse(toParse)
          // this.logger.playbackLogNote('restoreByTx', '', `parsed: ${acceptedTXs[i]}`)
        } else {
          // this.logger.playbackLogNote('restoreByTx', '', acceptedTXs[i])

          toParse.data = JSON.parse(toParse.data)
          toParse.receipt = JSON.parse(toParse.receipt)
        }
      }
    } catch (ex) {
      this.fatalLogger.fatal('restoreByTx error: ' + ex.name + ': ' + ex.message + ' at ' + ex.stack + ' while parsing: ' + toParse)
    }
    this.acceptedTXQueue = this.acceptedTXQueue.concat(acceptedTXs)

    this.logger.playbackLogNote('restoreByTx', '', `tx count: ${this.acceptedTXQueue.length} queue: `) // ${utils.stringifyReduce(this.acceptedTXQueue)}

    // await this.applyAcceptedTx()
    for (let acceptedTx of acceptedTXs) {
      this.queueAcceptedTransaction(acceptedTx, false)
    }

    // todo insert these in a sorted way to the new queue

    this.logger.playbackLogNote('restoreByTx', '', `end`)
  }

  // Code Not in use, but could be used as a reference for future code
  sortedArrayDifference (a, b, compareFn) {
    let results = []
    // let aIdx = 0
    let bIdx = 0

    for (let i = 0; i < a.length; ++i) {
      let aEntry = a[i]
      let bEntry = b[bIdx]
      let cmp = compareFn(aEntry, bEntry)
      if (cmp === 0) {
        bIdx++
      } else if (cmp < 1) {
        results.push(aEntry)
      } else {
        // nothing
      }
    }
    return results
  }

  // Code Not in use/finished, but could be used as a reference for future code
  async restoreAccountData (nodes, accountStart, accountEnd, timeStart, timeEnd) {
    let helper = nodes[0]

    let message = { accountStart: accountStart, accountEnd: accountEnd, tsStart: timeStart, tsEnd: timeEnd }
    let remoteAccountStates = await this.p2p.ask(helper, 'get_account_state', message) // todo perf, could await these in parallel
    let accountStates = await this.storage.queryAccountStateTable(accountStart, accountEnd, timeStart, timeEnd, 100000000)

    let compareFn = (a, b) => {
      if (a.txTimestamp !== b.txTimestamp) {
        return (a.txTimestamp > b.txTimestamp) ? 1 : -1
      } else if (a.accountId !== b.accountId) {
        return (a.accountId > b.accountId) ? 1 : -1
      } else {
        return 0
      }
    }
    let diff = this.sortedArrayDifference(remoteAccountStates, accountStates, compareFn)
    if (diff.length <= 0) {
      return // give up
    }
    let accountsToPatch = []
    // patch account states
    await this.storage.addAccountStates(diff)
    for (let state in diff) {
      if (state.accountId) {
        accountsToPatch.push(state.accountId)
      }
    }

    let message2 = { accountIds: accountsToPatch }
    let accountData = await this.p2p.ask(this.dataSourceNode, 'get_account_data_by_list', message2)

    if (accountData) {
      // for(let account in accountData) {
      //   //if exists update.
      //   //else create
      // }
      // todo  this.todo.patchUpdateAccounts(accountData)
    }
  }

  /* -------- APPSTATE Functions ---------- */

  async getAccountsStateHash (accountStart = '0'.repeat(64), accountEnd = 'f'.repeat(64), tsStart = 0, tsEnd = Date.now()) {
    const accountStates = await this.storage.queryAccountStateTable(accountStart, accountEnd, tsStart, tsEnd, 100000000)
    const stateHash = this.crypto.hash(accountStates)
    return stateHash
  }

  async testAccountTimesAndStateTable (tx, accountData) {
    let hasStateTableData = false

    function tryGetAccountData (accountID) {
      for (let accountEntry of accountData) {
        if (accountEntry.accountId === accountID) {
          return accountEntry
        }
      }
      return null
    }

    try {
      let keysResponse = this.app.getKeyFromTransaction(tx)
      let { sourceKeys, targetKeys, timestamp } = keysResponse
      let sourceAddress, targetAddress, sourceState, targetState

      // check account age to make sure it is older than the tx
      let failedAgeCheck = false
      for (let accountEntry of accountData) {
        if (accountEntry.timestamp >= timestamp) {
          failedAgeCheck = true
          if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + 'testAccountTimesAndStateTable account has future state.  id: ' + utils.makeShortHash(accountEntry.accountId) + ' time: ' + accountEntry.timestamp + ' txTime: ' + timestamp + ' delta: ' + (timestamp - accountEntry.timestamp))
        }
      }
      if (failedAgeCheck) {
        // if (this.verboseLogs) this.mainLogger.debug('DATASYNC: testAccountTimesAndStateTable accounts have future state ' + timestamp)
        return { success: false, hasStateTableData }
      }

      // check state table
      if (Array.isArray(sourceKeys) && sourceKeys.length > 0) {
        sourceAddress = sourceKeys[0]
        let accountStates = await this.storage.searchAccountStateTable(sourceAddress, timestamp)
        if (accountStates.length !== 0) {
          let accountEntry = tryGetAccountData(sourceAddress)
          if (accountEntry == null) {
            return { success: false, hasStateTableData }
          }
          sourceState = accountEntry.stateId
          hasStateTableData = true
          if (accountStates.length === 0 || accountStates[0].stateBefore !== sourceState) {
            if (this.verboseLogs) console.log('testAccountTimesAndStateTable ' + timestamp + ' cant apply state 1')
            if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + 'testAccountTimesAndStateTable ' + timestamp + ' cant apply state 1 stateId: ' + utils.makeShortHash(sourceState) + ' stateTable: ' + utils.makeShortHash(accountStates[0].stateBefore) + ' address: ' + utils.makeShortHash(sourceAddress))
            return { success: false, hasStateTableData }
          }
        }
      }
      if (Array.isArray(targetKeys) && targetKeys.length > 0) {
        targetAddress = targetKeys[0]
        let accountStates = await this.storage.searchAccountStateTable(targetAddress, timestamp)

        if (accountStates.length !== 0) {
          hasStateTableData = true
          if (accountStates.length !== 0 && accountStates[0].stateBefore !== allZeroes64) {
            let accountEntry = tryGetAccountData(targetAddress)

            if (accountEntry == null) {
              if (this.verboseLogs) console.log('testAccountTimesAndStateTable ' + timestamp + ' target state does not exist. address: ' + utils.makeShortHash(targetAddress))
              if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + 'testAccountTimesAndStateTable ' + timestamp + ' target state does not exist. address: ' + utils.makeShortHash(targetAddress) + ' accountDataList: ' + utils.stringifyReduce(accountData))
              this.fatalLogger.fatal(this.dataPhaseTag + 'testAccountTimesAndStateTable ' + timestamp + ' target state does not exist. address: ' + utils.makeShortHash(targetAddress) + ' accountDataList: ' + utils.stringifyReduce(accountData)) // todo: consider if this is just an error
              // fail this because we already check if the before state was all zeroes
              return { success: false, hasStateTableData }
            } else {
              targetState = accountEntry.stateId
              if (accountStates[0].stateBefore !== targetState) {
                if (this.verboseLogs) console.log('testAccountTimesAndStateTable ' + timestamp + ' cant apply state 2')
                if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + 'testAccountTimesAndStateTable ' + timestamp + ' cant apply state 2 stateId: ' + utils.makeShortHash(targetState) + ' stateTable: ' + utils.makeShortHash(accountStates[0].stateBefore) + ' address: ' + utils.makeShortHash(targetAddress))
                return { success: false, hasStateTableData }
              }
            }
          }
        }
      }
    } catch (ex) {
      this.fatalLogger.fatal('testAccountTimesAndStateTable failed: ' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
    }
    return { success: true, hasStateTableData }
  }

  // state ids should be checked before applying this transaction because it may have already been applied while we were still syncing data.
  async tryApplyTransaction (acceptedTX, hasStateTableData) {
    let ourLockID = -1
    try {
      let tx = acceptedTX.data
      // let receipt = acceptedTX.receipt
      let keysResponse = this.app.getKeyFromTransaction(tx)
      let { timestamp, debugInfo } = keysResponse

      if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + 'tryApplyTransaction ' + timestamp + ' ' + debugInfo)

      ourLockID = await this.fifoLock('accountModification')

      if (this.verboseLogs) console.log('tryApplyTransaction ' + timestamp + ' Applying!')
      // if (this.verboseLogs) this.mainLogger.debug('APPSTATE: tryApplyTransaction ' + timestamp + ' Applying!' + ' source: ' + utils.makeShortHash(sourceAddress) + ' target: ' + utils.makeShortHash(targetAddress) + ' srchash_before:' + utils.makeShortHash(sourceState) + ' tgtHash_before: ' + utils.makeShortHash(targetState))
      this.applySoftLock = true
      let { stateTableResults } = await this.app.apply(tx)
      this.applySoftLock = false
      // only write our state table data if we dont already have it in the db
      if (hasStateTableData === false) {
        for (let stateT of stateTableResults) {
          if (this.verboseLogs) console.log('writeStateTable ' + utils.makeShortHash(stateT.accountId))
          if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + 'writeStateTable ' + utils.makeShortHash(stateT.accountId) + ' before: ' + utils.makeShortHash(stateT.stateBefore) + ' after: ' + utils.makeShortHash(stateT.stateAfter))
        }
        await this.storage.addAccountStates(stateTableResults)
      }

      // post validate that state ended up correctly?

      // write the accepted TX to storage
      this.storage.addAcceptedTransactions([acceptedTX])
    } catch (ex) {
      this.fatalLogger.fatal('tryApplyTransaction failed: ' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
      return false
    } finally {
      this.fifoUnlock('accountModification', ourLockID)
    }
    this.emit('txApplied', acceptedTX)
    return true
  }

  queueAcceptedTransaction (acceptedTX, sendGossip = true, sender) {
    let keysResponse = this.app.getKeyFromTransaction(acceptedTX.data)
    let timestamp = keysResponse.timestamp
    let txId = acceptedTX.receipt.txHash

    try {
      let age = Date.now() - timestamp
      if (age > this.queueSitTime * 0.9) {
        this.fatalLogger.fatal('queueAcceptedTransaction working on older tx ' + timestamp + ' age: ' + age)
        // TODO consider throwing this out.  right now it is just a warning
        this.logger.playbackLogNote('oldQueueInsertion', '', 'queueAcceptedTransaction working on older tx ' + timestamp + ' age: ' + age)
      }

      if (sendGossip) {
        this.p2p.sendGossipIn('acceptedTx', acceptedTX, '', sender)
        this.logger.playbackLogNote('tx_homeGossip', `${txId}`, `AcceptedTransaction: ${acceptedTX}`)
      }
      // sorted insert
      let index = this.newAcceptedTXQueue.length - 1
      let lastTx = this.newAcceptedTXQueue[index]
      while (index >= 0 && ((timestamp < lastTx.timestamp) || (timestamp === lastTx.timestamp && txId < lastTx.id))) {
        index--
        lastTx = this.newAcceptedTXQueue[index]
      }
      this.newAcceptedTXQueue.splice(index + 1, 0, acceptedTX)
      this.logger.playbackLogNote('tx_addToQueue', `${txId}`, `AcceptedTransaction: ${acceptedTX}`)
      this.emit('txQueued', acceptedTX.receipt.txHash)

      // start the queue if needed
      this.tryStartAcceptedQueue()
    } catch (error) {
      this.logger.playbackLogNote('tx_addtoqueue_rejected', `${txId}`, `AcceptedTransaction: ${acceptedTX}`)
      this.fatalLogger.fatal('queueAcceptedTransaction failed: ' + error.name + ': ' + error.message + ' at ' + error.stack)
      throw new Error(error)
    }
  }

  tryStartAcceptedQueue () {
    if (!this.dataSyncMainPhaseComplete) {
      return
    }
    if (!this.newAcceptedTXQueueRunning) {
      this.processAcceptedTXQueue()
    } else if (this.newAcceptedTXQueue.length > 0) {
      this.interruptSleepIfNeeded(this.newAcceptedTXQueue[0].timestamp)
    }
  }
  async _firstTimeQueueAwait () {
    if (this.newAcceptedTXQueueRunning) {
      this.fatalLogger.fatal('DATASYNC: newAcceptedTXQueueRunning')
      return
    }
    await this.processAcceptedTXQueue(Date.now())
  }

  async applyAcceptedTransaction (acceptedTX) {
    if (this.queueStopped) return
    let tx = acceptedTX.data
    let keysResponse = this.app.getKeyFromTransaction(tx)
    let { sourceKeys, targetKeys, timestamp, debugInfo } = keysResponse

    if (this.verboseLogs) console.log('applyAcceptedTransaction ' + timestamp + ' ' + debugInfo)
    if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + 'applyAcceptedTransaction ' + timestamp + ' ' + debugInfo)

    let allkeys = []
    allkeys = allkeys.concat(sourceKeys)
    allkeys = allkeys.concat(targetKeys)
    let accountData = await this.app.getAccountDataByList(allkeys)

    let { success, hasStateTableData } = await this.testAccountTimesAndStateTable(tx, accountData)

    if (!success) {
      if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + 'applyAcceptedTransaction pretest failed: ' + timestamp)
      this.logger.playbackLogNote('tx_apply_rejected 1', `${acceptedTX.id}`, `Transaction: ${utils.stringifyReduce(acceptedTX)}`)
      return { success: false, reason: 'applyAcceptedTransaction pretest failed' }
    }

    // Validate transaction through the application. Shardus can see inside the transaction
    this.profiler.profileSectionStart('validateTx')
    // todo add data fetch to the result and pass it into app apply(), include previous hashes
    let transactionValidateResult = await this.app.validateTransaction(acceptedTX.data)
    this.profiler.profileSectionEnd('validateTx')
    if (transactionValidateResult.result !== 'pass') {
      let keysResponse = this.app.getKeyFromTransaction(acceptedTX.data)
      let timestamp = keysResponse.timestamp
      if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + 'applyAcceptedTransaction validate failed: ' + timestamp)
      this.mainLogger.error(`Failed to validate transaction. Reason: ${transactionValidateResult.reason} ts:${timestamp}`)
      this.logger.playbackLogNote('tx_apply_rejected 2', `${acceptedTX.id}`, `Transaction: ${utils.stringifyReduce(acceptedTX)}`)
      return { success: false, reason: transactionValidateResult.reason }
    }
    // todo2 refactor the state table data checks out of try apply and calculate them with less effort using results from validate
    let applyResult = await this.tryApplyTransaction(acceptedTX, hasStateTableData)
    if (applyResult) {
      if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + 'applyAcceptedTransaction SUCCEDED ' + timestamp)
      this.logger.playbackLogNote('tx_applied', `${acceptedTX.id}`, `AcceptedTransaction: ${utils.stringifyReduce(acceptedTX)}`)
    } else {
      this.logger.playbackLogNote('tx_apply_rejected 3', `${acceptedTX.id}`, `Transaction: ${utils.stringifyReduce(acceptedTX)}`)
    }
    return { success: applyResult, reason: 'apply result' }
  }

  interruptibleSleep (ms, targetTime) {
    let resolveFn = null
    let promise = new Promise(resolve => {
      resolveFn = resolve
      setTimeout(resolve, ms)
    })
    return { promise, resolveFn, targetTime }
  }

  interruptSleepIfNeeded (targetTime) {
    if (this.sleepInterrupt) {
      if (targetTime < this.sleepInterrupt.targetTime) {
        this.sleepInterrupt.resolveFn()
      }
    }
  }

  async processAcceptedTXQueue (maxTimestamp = -1) {
    try {
      // wait untill next apply time available
      // run as many apply tx as needed.
      this.newAcceptedTXQueueRunning = true

      let acceptedTXCount = 0
      let edgeFailDetected = false

      while (this.newAcceptedTXQueue.length > 0) {
        let currentTime = Date.now()
        let txTime = this.newAcceptedTXQueue[0].timestamp
        let txAge = currentTime - txTime
        if (txAge < this.queueSitTime) {
          let waitTime = this.queueSitTime - txAge
          this.sleepInterrupt = this.interruptibleSleep(waitTime, txTime)
          await this.sleepInterrupt.promise
          continue
        }

        // apply the tx
        let acceptedTX = this.newAcceptedTXQueue.shift()
        this.logger.playbackLogNote('tx_workingOnTx', `${acceptedTX.id}`, `AcceptedTransaction: ${utils.stringifyReduce(acceptedTX)}`)
        this.emit('txPopped', acceptedTX.receipt.txHash)
        let txResult = await this.applyAcceptedTransaction(acceptedTX)

        if (txResult.success) {
          acceptedTXCount++
        } else {
          if (!edgeFailDetected && acceptedTXCount > 0) {
            edgeFailDetected = true
            if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + `processAcceptedTXQueue edgeFail ${utils.stringifyReduce(acceptedTX)}`)
            this.fatalLogger.fatal(this.dataPhaseTag + `processAcceptedTXQueue edgeFail ${utils.stringifyReduce(acceptedTX)}`) // todo: consider if this is just an error
          }
        }

        // await utils.sleep(0)
        if (maxTimestamp > 0 && txTime > maxTimestamp) {
          if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + `processAcceptedTXQueue reached max timestamp. ${maxTimestamp} Exiting with ${this.newAcceptedTXQueue.length} items remaining`)
          this.newAcceptedTXQueueRunning = false
          return
        }
      }
    } finally {
      this.newAcceptedTXQueueRunning = false
    }
  }

  async fifoLock (fifoName) {
    let thisFifo = this.fifoLocks[fifoName]
    if (thisFifo == null) {
      thisFifo = { fifoName, queueCounter: 0, waitingList: [], lastServed: 0, queueLocked: false, lockOwner: null }
      this.fifoLocks[fifoName] = thisFifo
    }
    thisFifo.queueCounter++
    let ourID = thisFifo.queueCounter
    let entry = { id: ourID }

    if (thisFifo.waitingList.length > 0 || thisFifo.queueLocked) {
      thisFifo.waitingList.push(entry)
      // wait till we are at the front of the queue, and the queue is not locked
      while (thisFifo.waitingList[0].id !== ourID || thisFifo.queueLocked) {
      // perf optimization to reduce the amount of times we have to sleep (attempt to come out of sleep at close to the right time)
        let sleepEstimate = ourID - thisFifo.lastServed
        if (sleepEstimate < 1) {
          sleepEstimate = 1
        }
        await utils.sleep(1 * sleepEstimate)
      // await utils.sleep(2)
      }
      // remove our entry from the array
      thisFifo.waitingList.shift()
    }

    // lock things so that only our calling function can do work
    thisFifo.queueLocked = true
    thisFifo.lockOwner = ourID
    thisFifo.lastServed = ourID
    return ourID
  }

  fifoUnlock (fifoName, id) {
    let thisFifo = this.fifoLocks[fifoName]
    if (id === -1 || !thisFifo) {
      return // nothing to do
    }
    if (thisFifo.lockOwner === id) {
      thisFifo.queueLocked = false
    } else if (id !== -1) {
      // this should never happen as long as we are careful to use try/finally blocks
      this.fatalLogger.fatal(`Failed to unlock the fifo ${thisFifo.fifoName}: ${id}`)
    }
  }

  async _clearState () {
    await this.storage.clearAppRelatedState()
  }

  _stopQueue () {
    this.queueStopped = true
  }

  _clearQueue () {
    this.newAcceptedTXQueue = []
  }

  _registerListener (emitter, event, callback) {
    if (this._listeners[event]) {
      this.mainLogger.fatal('State Manager can only register one listener per event!')
      return
    }
    emitter.on(event, callback)
    this._listeners[event] = [emitter, callback]
  }

  _unregisterListener (event) {
    if (!this._listeners[event]) {
      this.mainLogger.warn(`This event listener doesn't exist! Event: \`${event}\` in StateManager`)
      return
    }
    const entry = this._listeners[event]
    const [emitter, callback] = entry
    emitter.removeListener(event, callback)
    delete this._listeners[event]
  }

  _cleanupListeners () {
    for (const event of Object.keys(this._listeners)) {
      this._unregisterListener(event)
    }
  }

  async cleanup () {
    this._stopQueue()
    this._unregisterEndpoints()
    this._clearQueue()
    this._cleanupListeners()
    await this._clearState()
  }
}

module.exports = StateManager
