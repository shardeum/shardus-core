const utils = require('../utils')

// const EnumSyncState = { NotStarted: 1, InitialStateData: 2, GettingAppData: 3, SecondaryStateData: 4, Failed: 5 }

// general notes / questions
// should we wipe our local DB before sync?
// todo m12: need error handling on all the p2p requests.

const allZeroes64 = '0'.repeat(64)

class DataSync {
  constructor (config, logger, storage, p2p, crypto, accountUtility) {
    this.mainLogger = logger.getLogger('main')
    this.p2p = p2p
    this.crypto = crypto
    this.storage = storage
    this.accountUtility = accountUtility
    this.logger = logger

    this.completedPartitions = []
    this.syncSettleTime = 5000 // 3 * 10 // an estimate of max transaction settle time. todo make it a config or function of consensus later
    this.mainStartingTs = Date.now()

    this.queueSitTime = 3000 // todo make this a setting. and tie in with the value in consensus

    this.clearPartitionData()

    this.acceptedTXQueue = []
    this.acceptedTXByHash = {}
    this.registerEndpoints()

    this.isSyncingAcceptedTxs = true // default is true so we will start adding to our tx queue asap

    this.verboseLogs = false
    if (this.mainLogger && ['TRACE'].includes(this.mainLogger.level.levelStr)) {
      this.verboseLogs = true
    }
  }

  // this clears state data related to the current partion we are processing.
  clearPartitionData () {
    // These are all for the given partition
    this.addressRange = null
    this.dataSourceNodes = []
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
    this.isSyncingAcceptedTxs = true
    await utils.sleep(5000) // Temporary delay to make it easier to attach a debugger
    console.log('syncStateData start')
    // delete and re-create some tables before we sync:
    await this.storage.dropAndCreatAccountStateTable()
    await this.storage.dropAndCreateAcceptedTransactions()
    await this.accountUtility.deleteLocalAccountData()

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
    await this.applyAcceptedTx()

    console.log('syncStateData end' + '   time:' + Date.now())
    // TODO after enterprise: once we are on the network we still need to patch our state data so that it is a perfect match of other nodes for our supported address range
    //  Only need to requery the range that overlaps when we joined and when we started receiving our own state updates on the network.
    //  The trick is this query will get some duplicate data, but maybe the way the keys are in the db are setup we can just attemp to save what we get.  will need testing
    //  also this should be not invoked here but some time after we have joined the network... like syncSettleTime after we went active
    //  see patchRemainingStateData()
    //  update.. not going to worry about this until after enterprise.  possibly ok to do this right before apply acceptedTX() !!

    // all complete!
  }

  async finalTXCatchup (diableQueue) {
    console.log('finalTXCatchup ' + '   time:' + Date.now())

    // await utils.sleep(2000) // can add a sleep in to excercise this functionality

    await this.applyAcceptedTx()
    if (diableQueue) {
      this.isSyncingAcceptedTxs = false
    }
  }

  async syncStateDataForPartition (partition) {
    try {
      this.currentPartition = partition
      this.addressRange = this.partitionToAddressRange(partition)

      this.partitionStartTimeStamp = Date.now()

      let lowAddress = this.addressRange.low
      let highAddress = this.addressRange.high

      this.mainLogger.debug(`DATASYNC: syncStateDataForPartition partition: ${partition} low: ${lowAddress} high: ${highAddress} `)

      await this.getSyncNodes(lowAddress, highAddress)

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
      if (error.message === 'FailAndRestartPartition') {
        this.mainLogger.debug(`DATASYNC: Error Failed at: ${error.stack}`)
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

  async getSyncNodes (lowAddress, highAddress) {
    // The following is repeated for each range of addresses or partitions
    //   Nodes to get data from should be selected based on the range of addresses or partitions
    this.dataSourceNodes = this.getRandomNodesInRange(3, lowAddress, highAddress, this.visitedNodes) // todo after enterprise: should probably expand the range used to look for node to include +- N partitions
    if (this.dataSourceNodes.length <= 0) {
      throw new Error('found no nodes to sync app data from')
    }
    if (this.dataSourceNodes.length < this.requiredNodeCount) {
      // TODO m11: fail if not in development mode.  use a development flag?
      // edge case would be restarting an entire network that has data..

      // await utils.sleep(10000)
      // throw new Error('FailAndRestartPartition')
      this.mainLogger.debug(`DATASYNC: below minimum number of nodes required to sync data, but going to try anyway  required: ${this.requiredNodeCount}  available: ${this.dataSourceNodes.length}`)
    }
    this.dataSourceNode = this.dataSourceNodes[0]

    for (let node of this.dataSourceNodes) {
      this.visitedNodes[node.id] = true
    }
  }

  async getMoreNodes (lowAddress, highAddress, count, excludeList = []) {
    let moreNodes = this.getRandomNodesInRange(count, lowAddress, highAddress, excludeList) // todo after enterprise: should probably expand the range used to look for node to include +- N partitions
    if (moreNodes.length <= count) {

    }
    for (let node of moreNodes) {
      excludeList[node.id] = true
    }
    return moreNodes
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
      this.lastStateSyncEndtime = endTime

      let queryLow
      let queryHigh
      let nodesToAsk = []
      let firstHash
      nodesToAsk = nodesToAsk.concat(this.dataSourceNodes)
      let searchingForGoodHash = true
      while (searchingForGoodHash) {
        queryLow = lowAddress
        queryHigh = highAddress
        let message = { accountStart: queryLow, accountEnd: queryHigh, tsStart: startTime, tsEnd: endTime }
        let stateHashResults = []
        for (let node of nodesToAsk) {
          let result = await this.p2p.ask(node, 'get_account_state_hash', message) // todo mem performance after enterprise: upgrade this to allow an array of N hashes if there is too much data to query in one shot
          // todo m11: handle error cases?
          stateHashResults.push({ hash: result.stateHash, node: node })
        }

        let hashesMatch = true
        firstHash = stateHashResults[0].hash
        // Test that results match.
        for (let i = 1; i < stateHashResults.length; i++) {
          if (stateHashResults[i].hash !== firstHash) {
            hashesMatch = false
          }
        }
        if (hashesMatch === false) {
          this.mainLogger.debug(`DATASYNC: hash: syncStateTableData hashes do not match `)
          for (let hashResp of stateHashResults) {
            this.mainLogger.debug(`DATASYNC: node:  ${hashResp.node.externalIp}:${hashResp.node.externalPort}  hash: ${hashResp.hash}`)
          }
          // // failed restart with new nodes.  TODO ?: record/eval/report blame?
          this.recordPotentialBadnode()
          throw new Error('FailAndRestartPartition') // TODO m11: we need to ask other nodes for a hash one at a time until we can feel better about a hash consensus

          // TODO after enterprise? code to handle getting bad hash data where we ask for one more node at a time until we have consensus on what hashes are good vs. bad
          // let moreNodes = this.getMoreNodes(1, lowAddress, highAddress, this.visitedNodes)
          // if (moreNodes.length > 0) {
          //   nodesToAsk = nodesToAsk.concat(moreNodes)
          // }
        } else {
          this.mainLogger.debug(`DATASYNC: hash: got good hash ${firstHash}`)
          searchingForGoodHash = false
        }
      }

      if (nodesToAsk.length === 0) {
        this.mainLogger.debug(`DATASYNC: hash: no nodes availabe to ask for hash`)
      }

      // queryLow = lowAddress
      // queryHigh = highAddress
      // let message = { accountStart: queryLow, accountEnd: queryHigh, tsStart: startTime, tsEnd: endTime }

      // let equalFn = (a, b) => {
      //   return a.stateHash === b.stateHash
      // }
      // let queryFn = async (node) => {
      //   let result = await this.p2p.ask(node, 'get_account_state_hash', message)
      //   return result
      // }
      // let winners = []
      // let nodes = this.getRandomNodesInRange(100, lowAddress, highAddress)
      // // let nodes = this.p2p.state.getAllNodes(this.p2p.id)
      // if (nodes.length === 0) {
      //   this.mainLogger.debug(`no nodes available`)
      //   return // nothing to do
      // }
      // this.mainLogger.debug(`DATASYNC: _robustQuery get_account_state_hash from ${utils.stringifyReduce(nodes.map(node => utils.makeShortHash(node.id) + ':' + node.externalPort))}`)
      // let result = await this.p2p._robustQuery(nodes, queryFn, equalFn, 3, winners)
      // if (result && result.stateHash) {
      //   this.mainLogger.debug(`DATASYNC: _robustQuery returned result: ${result.stateHash}`)
      //   if (winners.length === 0) {
      //     throw new Error('FailAndRestartPartition1')
      //   }
      //   this.dataSourceNode = winners[0]
      //   this.mainLogger.debug(`DATASYNC: got hash ${result.stateHash} from ${utils.stringifyReduce(winners.map(node => utils.makeShortHash(node.id) + ':' + node.externalPort))}`)
      //   firstHash = result.stateHash
      // } else {
      //   this.mainLogger.debug(`DATASYNC: _robustQuery get_account_state_hash failed`)
      //   throw new Error('FailAndRestartPartition2')
      // }

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

  async syncAccountData (lowAddress, highAddress) {
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

  async failandRestart () {
    this.mainLogger.debug(`failandRestart`)
    this.clearPartitionData()

    // using set timeout before we resume to prevent infinite stack depth.
    // setTimeout(async () => {
    //   await this.syncStateDataForPartition(this.currentPartition)
    // }, 1000)
    utils.sleep(1000)
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

    let missingButOkAccounts = 0
    let missingTXs = 0
    let handledButOk = 0
    let otherMissingCase = 0
    let missingButOkAccountIDs = {}

    this.mainLogger.debug(`DATASYNC: processAccountData stateTableCount: ${this.inMemoryStateTableData.length}`)
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
          }
          otherMissingCase++
        }
        // should we check timestamp for the state table data?
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
      this.mainLogger.debug(`DATASYNC: processAccountData accouts missing from accountData, but are ok, because we have transactions for them: ${missingButOkAccounts}, ${handledButOk}`)
    }
    if (this.missingAccountData.length > 0) {
      // getting this indicates a non-typical problem that needs correcting
      this.mainLogger.debug(`DATASYNC: processAccountData accounts missing from accountData, but in the state table.  This is an unexpected error and we will need to handle them as failed accounts: ${this.missingAccountData.length}, ${missingTXs}`)
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
    let failedHashes = await this.accountUtility.setAccountData(this.goodAccounts) // repeatable form may need to call this in batches

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
    for (let account of this.accountsWithStateConflict) {
      if (account.address != null) {
        addressList.push(account.address)
      }
    }
    // add the addresses of accounts that we got state table data for but not data for
    addressList = addressList.concat(this.missingAccountData)
    this.missingAccountData = []

    // TODO m11:  should we pick different nodes to ask? (at the very least need to change the data source node!!!!!!)
    this.mainLogger.debug(`DATASYNC: syncFailedAcccounts requesting data for failed hashes ${utils.stringifyReduce(addressList)}`)

    let message = { accountIds: addressList }
    let accountData = await this.p2p.ask(this.dataSourceNode, 'get_account_data_by_list', message)

    this.combinedAccountData.concat(accountData)

    await this.syncStateTableData(lowAddress, highAddress, this.lastStateSyncEndtime, Date.now())

    // process the new accounts.
    await this.processAccountData()
  }

  // Apply the Accepted Tx
  //   This should be done after we have synced the Account data across all the partitions or address ranges
  //   Starting with the oldest accepted transactions we have in the Accepted Tx Table apply the transactions using the App.apply function
  //   If the transaction was applied the App.apply function will return the State_before and State_after and we need to create an entry in the Account State Table with the Tx_id and the before and after states for this account
  //   Some of the early transactions will not be applied since the account data is more recent
  //   Note that the state in the receipt associated with the transaction may not be the same as State_before at the time of applying the transaction
  //   Once all the accepted transactions have been applied, gossip the “Active” message
  async applyAcceptedTx () {
    let counter = 0

    this.mainLogger.debug(`DATASYNC: applyAcceptedTx for up to ${this.acceptedTXQueue.length} transactions`)

    console.log(`applyAcceptedTx   queue: ${this.acceptedTXQueue.length}` + '   time:' + Date.now())

    let anyAcceptedTx = false

    while (this.acceptedTXQueue.length > 0) {
      let currentTime = Date.now()
      let txAge = currentTime - this.acceptedTXQueue[0].timestamp
      if (txAge < this.queueSitTime) {
        console.log(`applyAcceptedTx tx too young, exiting.  remaining queue: ${this.acceptedTXQueue.length}` + '   time:' + Date.now())
        this.mainLogger.debug(`DATASYNC: applyAcceptedTx tx too young, exiting.  remaining queue: ${this.acceptedTXQueue.length}` + '   time:' + Date.now())
        return this.acceptedTXQueue.length
      }

      // apply the tx
      let nextTX = this.acceptedTXQueue.shift()

      // we no longer have state table data in memory so there is not much more the datasync can do
      // shardus / the app code can take it from here
      let result = await this.accountUtility.tryApplyTransaction(nextTX)
      if (result === false && anyAcceptedTx === false) {
        // hit a trailing edge. we must have mismatche sync of account data, need to requery and restart this
        // uery account data for the next N transactions?

        // push this back in
        // this.acceptedTXQueue.unshift(nextTX)
        // break // we will need more state table data for coverage.
      }
      if (result === true) {
        anyAcceptedTx = true
      }

      // every x messages need to yeild
      counter++
      if (counter > 10) {
        counter = 0
        await utils.sleep(1)
      }
    }
    this.mainLogger.debug(`DATASYNC: applyAcceptedTx finished`)
    return this.acceptedTXQueue.length
  }

  // we get any transactions we need through the acceptedTx gossip
  async syncAcceptedTX () {

  }

  // this won't actually do much until after Shardus Enterprise
  // potentially we could do a better job of tracking exactly which state table we did not get and be able to get this with half the bandwith
  async patchRemainingStateData () {
    this.mainLogger.debug(`DATASYNC: patchRemainingStateData`)

    this.clearPartitionData()

    // todo after enterprise: use only the address range that our node needs
    this.addressRange = this.partitionToAddressRange(1)
    let lowAddress = this.addressRange.low
    let highAddress = this.addressRange.high
    await this.getSyncNodes(lowAddress, highAddress)

    // pick new nodes? / handle errors?
    let startTime = this.mainStartingTs - this.syncSettleTime
    let endTime = Date.now()
    await this.syncStateTableData(lowAddress, highAddress, startTime, endTime)
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

      this.p2p.sendGossipIn('acceptedTx', acceptedTX, tracker)

      if (!this.isSyncingAcceptedTxs) {
        // if (this.verboseLogs) console.log('got accepted tx after sync complete: ' + acceptedTX.timestamp + '   time:' + Date.now())
        return
      }

      if (this.verboseLogs) console.log('got accepted tx: ' + acceptedTX.timestamp + '   time:' + Date.now())
      // Lets insert this tx into a sorted list where index 0 == oldest and length-1 == newest
      if (this.isSyncingAcceptedTxs) {
        let txId = acceptedTX.id
        this.acceptedTXByHash[txId] = acceptedTX // we already have .id.. do we really need to hash this also?
        let timestamp = acceptedTX.timestamp
        if (this.acceptedTXQueue.length === 0) {
          this.acceptedTXQueue.push(acceptedTX)
        } else {
          let index = this.acceptedTXQueue.length - 1
          let lastTx = this.acceptedTXQueue[index]
          while (index >= 0 && ((timestamp < lastTx.timestamp) || (timestamp === lastTx.timestamp && txId < lastTx.id))) {
            index--
            lastTx = this.acceptedTXQueue[index]
          }
          this.acceptedTXQueue.splice(index + 1, 0, acceptedTX)
        }
      }
    })
  }

  enableSyncCheck () {
    this.p2p.registerOnNewCycle(async (cycles) => {
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

      await utils.sleep(5000) // wait a few seconds for things to settle

      let equalFn = (a, b) => {
        return a.stateHash === b.stateHash
      }
      let queryFn = async (node) => {
        let result = await this.p2p.ask(node, 'get_account_state_hash', message)
        return result
      }
      let winners = []
      // let nodes = this.p2p.state.getAllNodes(this.p2p.id)
      let nodes = this.getRandomNodesInRange(100, accountStart, accountEnd, [])
      if (nodes.length === 0) {
        return // nothing to do
      }
      let result = await this.p2p._robustQuery(nodes, queryFn, equalFn, 3, winners)
      if (result && result.stateHash) {
        let stateHash = await this.accountUtility.getAccountsStateHash(accountStart, accountEnd, startTime, endTime)
        if (stateHash === result.stateHash) {
          this.logger.playbackLogNote('appStateCheck', '', `Hashes Match = ${utils.makeShortHash(stateHash)} num cycles:${cycles.length} start: ${startTime}  end:${endTime}`)
        } else {
          this.logger.playbackLogNote('appStateCheck', '', `Hashes Dont Match ourState: ${utils.makeShortHash(stateHash)} otherState: ${utils.makeShortHash(result.stateHash)} window: ${startTime} to ${endTime}`)
          // winners[0]
          await this.restoreAccountDataByTx(winners, accountStart, accountEnd, startTime, endTime)
        }
      }
    })
  }

  async restoreAccountDataByTx (nodes, accountStart, accountEnd, timeStart, timeEnd) {
    this.logger.playbackLogNote('restoreByTx', '', `start`)

    let helper = nodes[0]

    let message = { tsStart: timeStart, tsEnd: timeEnd, limit: 10000 }
    let result = await this.p2p.ask(helper, 'get_accpeted_transactions', message) // todo perf, could await these in parallel
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

    await this.applyAcceptedTx()

    this.logger.playbackLogNote('restoreByTx', '', `end`)
  }

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
      // todo  this.accountUtility.patchUpdateAccounts(accountData)
    }
  }
}

module.exports = DataSync
