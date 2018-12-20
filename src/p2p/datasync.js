const utils = require('../utils')

// const EnumSyncState = { NotStarted: 1, InitialStateData: 2, GettingAppData: 3, SecondaryStateData: 4, Failed: 5 }

// general notes / questions
// should we wipe our local DB before sync?
// todo m12: need error handling on all the p2p requests.

class DataSync {
  constructor (config, logger, storage, p2p, crypto, accountUtility) {
    this.mainLogger = logger.getLogger('main')
    this.p2p = p2p
    this.crypto = crypto
    this.storage = storage
    this.accountUtility = accountUtility

    this.completedPartitions = []
    this.syncSettleTime = 3 * 10 // an estimate of max transaction settle time. todo make it a config or function of consensus later
    this.mainStartingTs = Date.now()

    this.clearPartitionData()

    this.acceptedTXQueue = []
    this.registerEndpoints()

    this.isSyncingAcceptedTxs = true // default is true so we will start adding to our tx queue asap
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

    // TODO after enterprise: once we are on the network we still need to patch our state data so that it is a perfect match of other nodes for our supported address range
    //  Only need to requery the range that overlaps when we joined and when we started receiving our own state updates on the network.
    //  The trick is this query will get some duplicate data, but maybe the way the keys are in the db are setup we can just attemp to save what we get.  will need testing
    //  also this should be not invoked here but some time after we have joined the network... like syncSettleTime after we went active
    //  see patchRemainingStateData()
    //  update.. not going to worry about this until after enterprise.  possibly ok to do this right before apply acceptedTX() !!

    // all complete!

    this.isSyncingAcceptedTxs = false
  }

  async syncStateDataForPartition (partition) {
    try {
      this.currentPartition = partition
      this.addressRange = this.partitionToAddressRange(partition)

      this.partitionStartTimeStame = Date.now()

      let lowAddress = this.addressRange.low
      let highAddress = this.addressRange.high

      this.mainLogger.debug(`DATASYNC: syncStateDataForPartition partition: ${partition} low: ${lowAddress} high: ${highAddress} `)

      await this.getSyncNodes(lowAddress, highAddress)

      await this.syncStateTableData(lowAddress, highAddress, 0, Date.now() - this.syncSettleTime)

      await this.syncAccountData(lowAddress, highAddress)

      // potentially do the next 2 blocks periodically in the account data retreval so we can flush data to disk!  generalize the account state table update so it can be called 'n' times

      // Sync the Account State Table Second Pass
      //   Wait at least 10T since the Ts_end time of the First Pass
      //   Same as the procedure for First Pass except:
      //   Ts_start should be the Ts_end value from last time and Ts_end value should be current time minus 10T
      await this.syncStateTableData(lowAddress, highAddress, this.lastStateSyncEndtime, Date.now())

      // Process the Account data
      //   For each account in the Account data make sure the entry in the Account State Table has the same State_after value; if not remove the record from the Account data
      //   For each account in the Account State Table make sure the entry in Account data has the same State_after value; if not save the account id to be looked up later
      //   Use the App.set_account_data function with the Account data to save the data to the application Accounts Table; if any failed accounts are returned save the account id to be looked up later
      this.processAccountData()

      // Sync the failed accounts
      //   Log that some account failed
      //   Use the /get_account_data_by_list API to get the data for the accounts that need to be looked up later from any of the nodes that had a matching hash but different from previously used nodes
      //   Repeat the “Sync the Account State Table Second Pass” step
      //   Repeat the “Process the Account data” step
      await this.syncFailedAcccounts(lowAddress, highAddress)
    } catch (error) {
      if (error.message === 'FailAndRestartPartition') {
        this.mainLogger.debug(`DATASYNC: Error Failed at: ${error.stack}`)
        this.failandRestart()
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
    let allNodes = this.p2p.state.getAllNodes(this.p2p.id)
    this.shuffleArray(allNodes)
    let results = []
    if (allNodes.length <= count) {
      count = allNodes.length
    }
    for (let node of allNodes) {
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
      if (endTime <= safeTime) {
        // need to idle for bit
        await utils.sleep(safeTime - endTime)
      }
      this.lastStateSyncEndtime = endTime

      let searchingForGoodHash = true

      let queryLow
      let queryHigh
      let nodesToAsk = []
      let firstHash
      nodesToAsk = nodesToAsk.concat(this.dataSourceNodes)
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
          this.mainLogger.debug(`DATASYNC: syncStateTableData hashes do not match `)
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
          searchingForGoodHash = false
        }
      }

      let moreDataRemaining = true
      this.combinedAccountStateData = []
      let loopCount = 0

      let lowTimeQuery = startTime
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
    setTimeout(async () => {
      await this.syncStateDataForPartition(this.currentPartition)
    }, 1000)
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

    // For each account in the Account data make sure the entry in the Account State Table has the same State_after value; if not remove the record from the Account data
    for (let stateData of this.inMemoryStateTableData) {
      account = this.mapAccountData[stateData.accountId]
      // does the state data table have a node and we don't have data for it?
      if (account == null) {
        this.missingAccountData.push(stateData.accountId)
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

    if (this.missingAccountData.length > 0) {
      this.mainLogger.debug(`DATASYNC: processAccountData hashes missing from data, but in the state table: ${this.missingAccountData.length}`)
    }

    //   For each account in the Account State Table make sure the entry in Account data has the same State_after value; if not save the account id to be looked up later
    this.accountsWithStateConflict = []
    this.goodAccounts = []
    for (let account of this.combinedAccountData) {
      if (!account.syncData) {
        // this account was not found in state data
        this.accountsWithStateConflict.push(account)
      } else if (!account.syncData.anyMatch) {
        // this account was in state data but none of the state table stateAfter matched our state
        this.accountsWithStateConflict.push(account)
      } else {
        delete account.syncData
        this.goodAccounts.push(account)
      }
    }

    this.mainLogger.debug(`DATASYNC: processAccountData saving ${this.goodAccounts.length} of ${this.combinedAccountData.length} records to db`)
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
      for (let accountId of this.failedHashes) {
        account = this.mapAccountData[accountId]
        this.accountsWithStateConflict.push(account)
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
    if (this.accountsWithStateConflict.length === 0) {
      this.mainLogger.debug(`DATASYNC: syncFailedAcccounts not failed hashes to sync`)
      return
    }
    let addressList = []
    for (let account of this.accountsWithStateConflict) {
      addressList.push(account.address)
    }
    // add the addresses of accounts that we got state table data for but not data for
    addressList = addressList.concat(this.missingAccountData)
    this.missingAccountData = []

    // TODO m11:  should we pick different nodes to ask? (at the very least need to change the data source node!!!!!!)

    let message = { accountIds: addressList }
    let accountData = await this.p2p.ask(this.dataSourceNode, 'get_account_data_by_list', message)

    this.mainLogger.debug(`DATASYNC: syncFailedAcccounts requesting data for failed hashes`)
    this.combinedAccountData.combine(accountData)

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

    while (this.acceptedTXQueue.length > 0) {
      // apply the tx
      let nextTX = this.acceptedTXQueue.slice()

      // we no longer have state table data in memory so there is not much more the datasync can do
      // shardus / the app code can take it from here
      await this.accountUtility.tryApplyTransaction(nextTX)

      // every x messages need to yeild
      counter++
      if (counter > 10) {
        counter = 0
        await utils.sleep(1)
      }
    }

    this.mainLogger.debug(`DATASYNC: applyAcceptedTx finished`)
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
    this.p2p.registerGossipHandler('acceptedTx', async (acceptedTX) => {
      // docs mention putting this in a table but it seems so far that an in memory queue should be ok
      // should we filter, or instead rely on gossip in to only give us TXs that matter to us?

      // Lets insert this tx into a sorted list where index 0 == oldest and length-1 == newest
      if (this.isSyncingAcceptedTxs) {
        if (this.acceptedTXQueue.length === 0) {
          this.acceptedTXQueue.push(acceptedTX)
        } else {
          let index = this.acceptedTXQueue.length - 1
          let lastTx = this.acceptedTXQueue[index]
          while (acceptedTX.timestamp < lastTx.timestamp && index > 0) {
            index--
            lastTx = this.acceptedTXQueue[index]
          }
          this.acceptedTXQueue.splice(index, 0, acceptedTX)
        }
      }
    })
  }
}

module.exports = DataSync
