const utils = require('../utils')

// const EnumSyncState = { NotStarted: 1, InitialStateData: 2, GettingAppData: 3, SecondaryStateData: 4, Failed: 5 }

// general notes / questions
// should we wipe our local DB before sync?
// todo need error handling on all the p2p requests.

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
    this.failedAccounts = []
    this.mapAccountData = {}
  }

  // syncs transactions and application state data
  // This is the main outer loop that will loop over the different partitions
  // The last step catch up on the acceptedTx queue
  async syncStateData (requiredNodeCount) {

    await utils.sleep(5000) // Temporary delay to make it easier to attach a debugger
    this.mainLogger.debug(`DATASYNC: starting syncStateData`)

    this.requiredNodeCount = requiredNodeCount
    // in the future, loop through and call this for each partition
    //todo after enterprise: use only the address range that our node needs
    for (let i = 0; i < this.getNumPartitions(); i++) {
      await this.syncStateDataForPartition(i)
      this.completedPartitions.push(i)
      // todo reset any state we need here.
      this.clearPartitionData()
    }

    // one we have all of the initial data the last thing to do is get caught up on transactions
    await this.applyAcceptedTx()
    
    // TODO !!! once we are on the network we still need to patch our state data so that it is a perfect match of other nodes for our supported address range
    //  Only need to requery the range that overlaps when we joined and when we started receiving our own state updates on the network.
    //  The trick is this query will get some duplicate data, but maybe the way the keys are in the db are setup we can just attemp to save what we get.  will need testing
    //  also this should be not invoked here but some time after we have joined the network... like syncSettleTime after we went active
    //  see patchRemainingStateData() 

    // all complete!
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
    // todo implement partition->address range math.  possibly store it in a lookup table
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
    this.dataSourceNodes = this.getRandomNodesInRange(3, lowAddress, highAddress, this.visitedNodes) // todo should probably expand the range used to look for node to include +- N partitions
    if (this.dataSourceNodes.length <= 0) {
      throw new Error('found no nodes to sync app data from')
    }
    if (this.dataSourceNodes.length < this.requiredNodeCount) {
      // TODO fail if not in development mode.
      // edge case would be restarting an entire network that has data..

      // await utils.sleep(10000)
      // throw new Error('FailAndRestartPartition')
    }
    this.dataSourceNode = this.dataSourceNodes[0]

    for (let node of this.dataSourceNodes) {
      this.visitedNodes[node.id] = true
    }
  }

  // todo refactor this into a util, grabbed it from p2p
  // From: https://stackoverflow.com/a/12646864
  shuffleArray (array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]]
    }
  }

  // todo move to p2p?  todo need to ask nodes that
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
        }
      }
    }
    return results
  }

  // TODO !!  need to upgrade this to the form that can re-request data if the limit has been hit.  see syncAccountData
  async syncStateTableData (lowAddress, highAddress, startTime, endTime) {
    let searchingForGoodData = true

    this.mainLogger.debug(`DATASYNC: syncStateTableData startTime: ${startTime} endTime: ${endTime} low: ${lowAddress} high: ${highAddress} `)
    // todo this loop will try three more random nodes, this is slightly different than described how to handle failure in the doc. this should be corrected but will take more code
    // should prossible break this into a state machine in  its own class.
    while (searchingForGoodData) { // todo this needs to be replaced
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
        await utils.sleep( safeTime - endTime )
      }
      this.lastStateSyncEndtime = endTime

      let queryLow = lowAddress
      let queryHigh = highAddress
      let message = { accountStart: queryLow, accountEnd: queryHigh, tsStart: startTime, tsEnd: endTime }
      let stateHashResults = []
      for (let node of this.dataSourceNodes) {
        let result = await this.p2p.ask(node, 'get_account_state_hash', message) // todo wrap and call this in the repeatable form.
        // todo handle error cases?
        stateHashResults.push(result.stateHash)
      }

      let hashesMatch = true
      let firstHash = stateHashResults[0]
      // Test that results match.
      for (let i = 1; i < stateHashResults; i++) {
        if (stateHashResults[i] !== firstHash) {
          hashesMatch = false
        }
      }
      if (hashesMatch === false) {
        this.mainLogger.debug(`DATASYNC: syncStateTableData hashes do not match `)
        // failed restart with new nodes.  TODO record/eval/report blame?
        this.recordPotentialBadnode()
        throw new Error('FailAndRestartPartition') //TODO we need to ask other nodes for a hash one at a time untill we can feel better about a hash consensus
      }

      //  Simple one shot way to get account state data, loop form below
      // message = { accountStart: queryLow, accountEnd: queryHigh, tsStart: startTime, tsEnd: endTime }
      // let accountStateData = await this.p2p.ask(this.dataSourceNode, 'get_account_state', message)
      // let recievedStateDataHash = this.crypto.hash(accountStateData)
      // this.combinedAccountStateData.concat(accountStateData)

      let moreDataRemaining = true
      this.combinedAccountStateData = []
      let loopCount = 0

      let lowTimeQuery = startTime
      // this loop is required since after the first query we may have to adjust the address range and re-request to get the next N data entries.
      while (moreDataRemaining) {
        message = { accountStart: queryLow, accountEnd: queryHigh, tsStart: lowTimeQuery, tsEnd: endTime }
        let result = await this.p2p.ask(this.dataSourceNode, 'get_account_state', message)

        let accountStateData = result.accountStates
        let lastLowQuery = lowTimeQuery
        if (accountStateData.length > 0) {
          let lastAccount = accountStateData[accountStateData.length - 1]
          if (lastAccount.txTimestamp > lowTimeQuery) {
            moreDataRemaining = true
            lowTimeQuery = lastAccount.txTimestamp
          }
        } 

        // if this is a repeated query, clear out any dupes from the new list we just got
        // there could be many rows that use the stame timestamp so we will search for them
        let dataDuplicated = true
        while (loopCount > 0 && accountStateData.length > 0 && dataDuplicated) {
          let stateData = accountStateData[0]
          dataDuplicated = false
          for(let i = this.combinedAccountStateData.length-1; i>=0; i--){
            let existingStateData = this.combinedAccountStateData[i]
            if((existingStateData.txTimestamp === stateData.txTimestamp) && (existingStateData.accountId === stateData.accountId)){
              dataDuplicated = true
              break
            }
            // once we get to an older timestamp we can stop looking, the outer loop will be done also
            if(existingStateData.txTimestamp < stateData.txTimestamp) {
              break
            }
          }
          if (dataDuplicated){
            accountStateData.shift()
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
        // Failed again back through loop! TODO record/eval/report blame?
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
      //max records artificially low to make testing coverage better.  todo make it a config or calculate based on data size
      let message = { accountStart: queryLow, accountEnd: queryHigh, maxRecords: 3 }
      let result = await this.p2p.ask(this.dataSourceNode, 'get_account_data', message) // need the repeatable form... possibly one that calls apply to allow for datasets larger than memory
      // accountData is in the form [{accountId, stateId, data}] for n accounts.
      let accountData = result.accountData

      let lastAccount
      let firstAccount
      if (accountData.length > 0) {
        lastAccount = accountData[accountData.length - 1]
        firstAccount = accountData[0]
        if (lastAccount.accountId > queryLow) {
          moreDataRemaining = true
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
    // TODO log failure
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
    // let accountData =

    this.mapAccountData = {}
    // create a fast lookup map for the accounts we have.  Perf.  will need to review if this fits into memory.  May need a novel structure.
    let account
    for (let i = 0; i < this.combinedAccountData.length; i++) {
      account = this.combinedAccountData[i]
      this.mapAccountData[account.accountId] = account
    }

    //   For each account in the Account data make sure the entry in the Account State Table has the same State_after value; if not remove the record from the Account data
    for (let stateData of this.inMemoryStateTableData) {
      account = this.mapAccountData[stateData.accountId]
      // todo check if state table has an account we dont have

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
      // TODO record/eval/report blame?
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
      addressList.push(account)
    }

    // should we pick different nodes to ask? (at the very least need to change the data source node!!!!!!)

    let message = { accountIds: addressList }
    let accountData = await this.p2p.ask(this.dataSourceNode, 'get_account_data_by_list', message)

    this.mainLogger.debug(`DATASYNC: syncFailedAcccounts requesting data for failed hashes`)
    this.combinedAccountData.combine(accountData)

    // todo need queury state table data, then reprocess our data.
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
      let nextTX = acceptedTXQueue.slice()

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
  }

  async patchRemainingStateData() {
    this.mainLogger.debug(`DATASYNC: patchRemainingStateData`)

    this.clearPartitionData()

    //todo after enterprise: use only the address range that our node needs
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
    this.p2p.registerGossipHandler('acceptedTx', async (data) => {
      // what to do with this data?
      // need to insert into state table and accepted tx table for any nodes in our shard that are involved
      this.acceptedTXQueue.push(data)
      // TODO a timestamp sorted insert
    })
  }
}

module.exports = DataSync
