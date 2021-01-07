import { start } from 'repl'
import { Certificate } from 'crypto'
//import { RequestHandler } from "express"; //express was causing problems.

type RequestHandler = any

// Type definitions for Shardus
// Project: Shardus Enterprise Server
// Definitions by: Erik Xavier
export = Shardus
declare class Shardus {
  constructor(configs?: Shardus.ShardusConfiguration)
  /**
   * Setups an application to run within the shardus enterprise server instance
   * @param App The provided application
   */
  setup(App: Shardus.App): Shardus
  /**
   * Starts the shardus enterprise server instace
   * @param exitProcOnFail Sets if the process should terminate on any error
   *
   */
  start(exitProcOnFail?: boolean): void
  /**
   * Register an external endpoint to shardus enterprise server
   * https://shardus.gitlab.io/docs/developer/main-concepts/building-a-poc-app/shardus-app-interface/register-external-get.html
   * @param route The route to register an external GET endpoint
   * @param handler An express.js standard route handler function
   */
  registerExternalGet(route: string, handler: RequestHandler): void
  /**.
   * Register an external endpoint to shardus enterprise server.  version 2
   * https://shardus.gitlab.io/docs/developer/main-concepts/building-a-poc-app/shardus-app-interface/register-external-get.html
   * @param route The route to register an external POST endpoint
   * @param handler An express.js standard route handler function
   */

  registerExternalPost(route: string, handler: RequestHandler): void
  /**
   * Register an external endpoint to shardus enterprise server
   * @param route The route to register an external PUT endpoint
   * @param handler An express.js standard route handler function
   */

  registerExternalPut(route: string, handler: RequestHandler): void
  /**
   * Register an external endpoint to shardus enterprise server
   * @param route The route to register an external DELETE endpoint
   * @param handler An express.js standard route handler function
   */

  registerExternalDelete(route: string, handler: RequestHandler): void
  /**
   * Register an external endpoint to shardus enterprise server
   * @param route The route to register an external PATCH endpoint
   * @param handler An express.js standard route handler function
   */

  registerExternalPatch(route: string, handler: RequestHandler): void
  /**
   * Register handler for caught exceptions on http requests
   */
  registerExceptionHandler(): void
  /**
   * Handle incoming transaction requests
   *
   * @param tx the transaction
   * @param set?
   */
  put(tx: object, set?: boolean): Shardus.IncomingTransactionResult
  /**
   * Handle incoming set requests
   *
   * @param tx the set tx
   */
  set(tx: object): Shardus.IncomingTransactionResult
  /**
   * Logging for the application
   * @param data The data you want the application to log
   */
  log(...data: any): void
  /**
   * A function that clears shardus App related State
   */
  resetAppRelatedState(): void
  /**
   * A function that executes a cleanup and terminates the server
   * @param exitProcess Flag to define if process.exit() should be called or not. Default: true
   */
  shutdown(exitProcess?: boolean): void

  /**
   * Returns the application associated with the shardus module
   * @param Application The configured application
   */

  _getApplicationInterface(Application: Shardus.App): Shardus.App

  createApplyResponse(txId: string, txTimestamp: number): Shardus.ApplyResponse

  createWrappedResponse(
    accountId: string,
    accountCreated: boolean,
    hash: string,
    timestamp: number,
    fullData: any
  ): Shardus.WrappedResponse

  setPartialData(response: any, partialData: any, userTag: any): void

  genericApplyPartialUpate(
    fullAccountData: any,
    updatedPartialAccount: any
  ): void

  applyResponseAddState(
    applyResponse: any,
    fullAccountData: any,
    localCache: any,
    accountId: string,
    txId: string,
    txTimestamp: number,
    accountStateBefore: string,
    accountStateAfter: string,
    accountCreated: boolean
  ): void

  getLocalOrRemoteAccount(
    address: string
  ): Promise<Shardus.WrappedDataFromQueue>

  getRemoteAccount(address: string): Promise<Shardus.WrappedDataFromQueue>

  getLatestCycles(): Shardus.Cycle[]

  getNodeId(): string

  getClosestNodes(hash: string, number: number): string[]

  getNode(nodeId: string): Shardus.Node
  // not sure where this def should go?
  // profiler: any
  p2p: any
}

declare namespace Shardus {
  export interface App {
    validateTransaction: (...data: any) => any
    /**
     * A function responsible for validation the incoming transaction fields
     */
    validateTxnFields: (
      inTx: Shardus.OpaqueTransaction // it is better to not use IncomingTransaction 
    ) => Shardus.IncomingTransactionResult
    /**
     * A function responsible for applying an accepted transaction
     */
    apply: (
      inTx: Shardus.OpaqueTransaction,
      wrappedStates: any
    ) => Shardus.ApplyResponse

    /**
     * This is called after consensus has received or produced a receipt and the trasaction is approved.
     * Do not change any of the values passes in.
     * This is a place to generate other transactions, or do off chain work like send and email.
     */
    transactionReceiptPass: (
      inTx: Shardus.OpaqueTransaction,
      wrappedStates: any,
      applyResponse: Shardus.ApplyResponse
    ) => void
    
    /**
     * This is called after consensus has received or produced a receipt and the trasaction fails.
     * Do not change any of the values passes in.
     * This is a place to generate other transactions, or do off chain work like send and email.
     */    
    transactionReceiptFail: (
      inTx: Shardus.OpaqueTransaction,
      wrappedStates: any,
      applyResponse: Shardus.ApplyResponse
    ) => void


    updateAccountFull: (
      wrappedState: WrappedResponse,
      localCache: any,
      applyResponse: Shardus.ApplyResponse
    ) => void

    updateAccountPartial: (
      wrappedState: WrappedResponse,
      localCache: any,
      applyResponse: Shardus.ApplyResponse
    ) => void

    getRelevantData: (accountId: string, tx: object) => WrappedResponse

    /**
     * A function that returns the Keys for the accounts involved in the transaction
     */
    getKeyFromTransaction: (inTx: Shardus.OpaqueTransaction) => TransactionKeys
    /**
     * A function that returns the State ID for a given Account Address
     */
    getStateId: (accountAddress: string, mustExist?: boolean) => string
    /**
     * A function that returns the timestamp for a given Account Address
     */
    getAccountTimestamp: (accountAddress: string, mustExist?: boolean) => number

    /**
     * A function that allows the app to look at a passed in account ane return the hash and timestamp
     */
    getTimestampAndHashFromAccount: (account: any) => { timestamp:number, hash: string }

    /**
     * A function that will be called when the shardus instance shuts down
     */
    close: () => void

    getAccountData: (
      accountStart: string,
      accountEnd: string,
      maxRecords: number
    ) => WrappedData[]

    getAccountDataByRange: (
      accountStart: string,
      accountEnd: string,
      tsStart: number,
      tsEnd: number,
      maxRecords: number
    ) => WrappedData[]

    calculateAccountHash: (account: any) => string

    setAccountData: (accountRecords: any[]) => void

    resetAccountData: (accountRecords: any[]) => void

    deleteAccountData: (addressList: string[]) => void

    getAccountDataByList: (addressList: string[]) => WrappedData[]

    deleteLocalAccountData: () => void

    getAccountDebugValue: (wrappedAccount: any) => string

    canDebugDropTx: (tx: any) => boolean

    /**
     * This gives the application a chance to sync or load initial data before going active.
     * If it is the first node it can use .set() to set data
     * If it is not the first node it could use getLocalOrRemote() to query data it needs.
     */
    sync: () => any

    dataSummaryInit: (blob: any, accountData: any) => void
    dataSummaryUpdate: (blob: any, accountDataBefore: any, accountDataAfter: any) => void
    txSummaryUpdate: (blob: any, tx: any, wrappedStates: any) => void

  }

  export interface TransactionKeys {
    /**
     * An array of the source keys
     */
    sourceKeys: string[]
    /**
     * An array of the target keys
     */

    targetKeys: string[]
    /**
     * all keys
     */

    allKeys: string[]
    /**
     * Timestamp for the transaction
     */
    timestamp: number
    /**
     * debug info string
     */
    debugInfo?: string
  }
  export interface ApplyResponse {
    /**
     * The statle table results array
     */
    stateTableResults: StateTableObject[]
    /**
     * Transaction ID
     */
    txId: string
    /**
     * Transaction timestamp
     */
    txTimestamp: number
    /**
     * Account data array
     */
    accountData: WrappedResponse[]
    /**
     * a blob for the app to define. 
     * This gets passed to post apply
     */
    appDefinedData: any
  }

  export interface AccountData {
    /** Account ID */
    accountId: string
    /** Account Data */
    data: string
    /** Transaction ID */
    txId: string
    /** Timestamp */
    timestamp: number // is it ok to use string here, how about data?
    /** Account hash */
    hash: string
  }

  // similar to AccountData but comes from the accounts copy backup table.
  export interface AccountsCopy {
    accountId: string
    cycleNumber: number
    data: any
    timestamp: number
    hash: string,
    isGlobal: boolean
  }

  export interface WrappedData {
    /** Account ID */
    accountId: string
    /** hash of the data blob */
    stateId: string
    /** data blob opaqe */
    data: any
    /** Timestamp */
    timestamp: number

    /** optional data related to sync process */
    syncData?: any


  }

  export interface WrappedResponse extends WrappedData {
    accountCreated: boolean
    isPartial: boolean

    //Set by setPartialData
    userTag?: any
    localCache?: any  // TODO CODEREIVEW: use by partial data, but really need to code review everything localCache related.
                      // LocalCache was supposed to be a full copy of the account before tx was applied. This would allow for 
                      // sending partial account data out for a TX but still doing the full transform when it is local
                      // for some reason localCache is also getting check for logic to determin if the account should be saved locally,
                      // a more explicit mechanism would be nicer

    // state manager tracking
    prevStateId?: string
    // need a before copy of the data for stats system. may not be super effcient. possibly merge this with original data on the queue entry
    prevDataCopy?: any
  }

  // old version:
  // export interface WrappedResponse {
  //   accountId: string,
  //   accountCreated: boolean,
  //   isPartial: boolean,
  //   stateId: string,
  //   timestamp: number,
  //   data: any
  // }

  //seenInQueue

  export interface WrappedDataFromQueue extends WrappedData {
    /** is this account still in the queue */
    seenInQueue: boolean
  }

  export interface AccountData2 {
    /** Account ID */
    accountId: string
    /** Account Data */
    data: string
    /** Transaction ID */
    txId: string
    /** Timestamp */
    txTimestamp: string
    /** Account hash */
    hash: string
    /** Account data */
    accountData: any
    /** localCache */
    localCache: any
  }

  // createWrappedResponse (accountId, accountCreated, hash, timestamp, fullData) {
  //   // create and return the response object, it will default to full data.
  //   return { accountId: accountId, accountCreated, isPartial: false, stateId: hash, timestamp: timestamp, data: fullData }
  // }

  // createApplyResponse (txId, txTimestamp) {
  //   let replyObject = { stateTableResults: [], txId, txTimestamp, accountData: [] }
  //   return replyObject
  // }

  // // USED BY SIMPLECOINAPP
  // applyResponseAddState (resultObject, accountData, localCache, accountId, txId, txTimestamp, stateBefore, stateAfter, accountCreated) {
  //   let state = { accountId, txId, txTimestamp, stateBefore, stateAfter }
  //   if (accountCreated) {
  //     state.stateBefore = allZeroes64
  //   }
  //   resultObject.stateTableResults.push(state)
  //   resultObject.accountData.push({ accountId, data: accountData, txId, timestamp: txTimestamp, hash: stateAfter, localCache: localCache })
  // }

  export interface StateTableObject {
    /** Account ID */
    accountId: string
    /** Transaction ID */
    txId: string
    /** Transaction Timestamp */
    txTimestamp: string
    /** The hash of the state before applying the transaction */
    stateBefore: string
    /** The hash of the state after applying the transaction */
    stateAfter: string
  }

  // NEED to loosen this defination..  shardus should not know this much!!!  maybe just move it to the app side
  export interface IncomingTransaction {
    /** Source account address for the transaction */
    srcAct: string
    /** Target account address for the transaction */
    tgtActs?: string
    /** Target account addresses for the transaction */
    tgtAct?: string
    /** The transaction type */
    txnType: string
    /** The transaction amount */
    txnAmt: number
    /** The transaction Sequence Number */
    seqNum: number
    /** The transaction signature */
    sign: Shardus.Sign
    /** The transaction timestamp */
    txnTimestamp?: string
  }

  export interface Sign {
    /** The key of the owner */
    owner: string
    /** The hash of the object's signature signed by the owner */
    sig: string
  }

  export interface IncomingTransactionResult {
    /** The result for the incoming transaction */
    success: boolean //was Results before.. but having trouble with that
    /** The reason for the transaction result */
    reason: string
    /** The timestamp for the result */
    txnTimestamp?: number
  }

  enum Results {
    pass,
    fail,
  }

  export interface ShardusConfiguration {
    /** The heartbeatInterval parameter is an Integer that defines the number of seconds between each heartbeat logged within shardus */
    heartbeatInterval?: number
    /** The baseDir parameter is a String that defines the relative base directory for this running instance of shardus */
    baseDir?: string
    /** The transactionExpireTime parameter is an Integer that defines the amount of time (in seconds) allowed to pass before a transaction will expire and be rejected by the network. */
    transactionExpireTime?: number
    /** Crypto module configuration */
    crypto?: {
      /** The hashkey parameter is a String that is used to initialize the crypto module, which is used for the cryptographic functions within shardus */
      hashKey?: string
    }
    /** P2P module configuration */
    p2p?: {
      /** The ipServer parameter is a String that specifies a the url for the ipServer. */
      ipServer?: string
      /** The timeServers parameter is an Array of String that specifies where to get time critical data. */
      timeServers?: string[]
      /**  */
      existingArchivers?: Array<{
        ip: string
        port: number
        publicKey: string
      }>
      /** The syncLimit parameter is an Integer that specifies the amount of time (in seconds) a node’s local time can differ from the network’s time. */
      syncLimit?: number
      /** The cycleDuration parameter is an Integer specifying the amount of time (in seconds) it takes for a shardus network cycle to complete. */
      cycleDuration?: number
      /** The maxRejoinTime parameter is an Integer specifying the amount of time (in seconds) between network heartbeats before a node must ask to rejoin. */
      maxRejoinTime?: number
      /** The seedList parameter is a String specifying the url for the seedNode server that the application will communicate with. */
      seedList?: string
      /** The difficulty parameter is an Integer specifying the proof of work difficulty to prevent network spam. */
      difficulty?: number
      /** The queryDelay parameter is an Integer specifying the amount of time (in seconds) to delay between cycle phase. */
      queryDelay?: number
      /** The netadmin parameter is a String specifying the public key of the network admin for emergency network alerts, updates, or broadcasts. */
      netadmin?: string
      /** The gossipRecipients parameter is an Integer specifying the number of nodes to send gossip to in the network after receiving a message.
       * Shardus groups nodes with neighbors, who they can gossip the message to, so you can set this pretty low and still expect it to be
       * propogated through the entire network. (It’s recommended to set this to AT LEAST 3, 4 is recommended, and 5 would be even safer,
       * but maybe overkill). Shardus will send 2 gossips to neighboring nodes, and send the remaining number left over in the parameter to
       * random nodes in the network, so messages will be propagated very quickly.
       **/
      gossipRecipients?: number
      /** The gossipTimeout parameter is an Integer specifying the amount of time (in seconds) before an old gossip is deleted from a node. */
      gossipTimeout?: number
      /** The maxSeedNodes parameter is an Integer specifying the maximum number of seedNodes used to be used. */
      maxSeedNodes?: number
      /** The minNodesToAllowTxs parameter is an Integer specifying the minimum number of active nodes needed in the network to process txs. */
      minNodesToAllowTxs?: number
      /** The minNodes parameter is an Integer specifying the minimum number of nodes that need to be active in the network in order to process transactions. */
      minNodes?: number
      /** The maxNodes parameter is an Integer specifying the maximum number of nodes that can be active in the network at once. */
      maxNodes?: number
      /** The seedNodeOffset parameter is an Integer specifying the number of seedNodes to remove when producing the seedList */
      seedNodeOffset?: number
      /** The nodeExpiryAge parameter is an Integer specifying the amount of time (in seconds) before a node can be in the network before getting rotated out. */
      nodeExpiryAge?: number

      /** The maxJoinedPerCycle parameter is an Integer specifying the maximum number of nodes that can join the syncing phase each cycle. */
      maxJoinedPerCycle?: number
      /** The maxSyncingPerCycle parameter is an Integer specifying the maximum number of nodes that can be in the syncing phase each cycle. */
      maxSyncingPerCycle?: number
      /** The maxRotatedPerCycle parameter is an Integer specifying the maximum number of nodes that can that can be rotated out of the network each cycle. */
      maxRotatedPerCycle?: number

      /** The maxPercentOfDelta parameter is an Integer specifying the percent out of 100 that additional nodes can be accepted to the network. */
      maxPercentOfDelta?: number
      /** The scaleReqsNeeded parameter is an Integer specyifying the number of internal scaling requests shardus needs to receive before scaling up or down the number of desired nodes in the network. */
      scaleReqsNeeded?: number
      /** The maxScaleReqs parameter is an Integer specifying the maximum number of scaling requests the network will process before scaling up or down. */
      maxScaleReqs?: number
      /** The amountToScale parameter is an Integer specifying the amount of nodes to add or remove from the number of desired nodes the network wants. */
      amountToScale?: number
      /** If witenss mode is true, node will not join the network but help other nodes to sync the data */
      startInWitnessMode?: boolean
    }
    /** Server IP configuration */
    ip?: {
      /** The IP address the server will run the external API */
      externalIp?: string | 'auto'
      /** The port the server will run the external API */
      externalPort?: number | 'auto'
      /** The IP address the server will run the internal comunication API */
      internalIp?: string | 'auto'
      /** The port the server will run the internal comunication API  */
      internalPort?: number | 'auto'
    }
    /** Server Network module configuration */
    network?: {
      /** The timeout parameter is an Integer specifying the amount of time (in seconds) given to an internal network request made by the node until it gets timed out. */
      timeout?: number
    }
    /** Server Report module configuration */
    reporting?: {
      /** The report parameter is an Boolean specifying whether or not to report data to a monitor server / client. */
      report?: boolean
      /** The recipient parameter is an String specifying the url of the recipient of the data that will be reported if report is set to true. */
      recipient?: string
      /** The interval paramter is an Integer specifying the amount of time (in seconds) between the reported data updates. */
      interval?: number
      /** The console parameter is an Boolean specifying whether or not to report data updates to the console. */
      console?: boolean
    }
    /** Server Debug module configuration */
    debug?: {
      /** The loseReceiptChance parameter is a Float specifying a percentage chance to randomly drop a receipt (currently doesn’t do anything) */
      loseReceiptChance?: number
      /** The loseTxChance parameter is a Float specifying a percentage chance to randomly drop a transaction. */
      loseTxChance?: number
      /** The canDataRepair parameter is a boolean that allows dataRepair to be turned on/off by the application (true = on | false = off) */
      canDataRepair?: boolean
      /** Disable voting consensus for TXs (true = on | false = off) */
      debugNoTxVoting?: boolean
      /** ignore initial incomming receipt */
      ignoreRecieptChance?: number
      /** ignore initial incomming vote */
      ignoreVoteChance?: number
      /** chance to fail making a receipt */
      failReceiptChance?: number
      /** chance to flip our vote */
      voteFlipChance?: number      
      /** use the new stats data for partition state reports to monitor server */
      useNewParitionReport?: boolean
      /** is the old partition checking system enabled */
      oldPartitionSystem?: boolean
      /** slow old reporting that queries sql for account values */
      dumpAccountReportFromSQL?: boolean
    }
    /** Options for the statistics module */
    statistics?: {
      /** The save parameter is a Boolean specifying whether or not statistics will be gathered and saved when running the network. */
      save?: boolean
      /** The interval parameter is a Integer specifying the amount of time (in seconds) between each generated stats data. */
      interval?: number
    }
    /**  */
    loadDetection?: {
      /**
       * The queueLimit parameter is an Integer which specifies one of the two possible limits to check whether the network is under heavy load.
       * It does this by checking it’s set value against the current transaction queue. The threshold will be equal to the number of transactions
       * in the queue / the queueLimit.
       **/
      queueLimit?: number
      /** The desiredTxTime parameter is an Integer which specifies the other condition to check whether the network is under heavy load. */
      desiredTxTime?: number
      /** The highThreshold parameter is an Integer which specifies the high end of the load the network can take. Reaching this threshold will cause the network to increase the desired nodes. */
      highThreshold?: number
      /** The lowThreshold parameter is an Integer which specifies the low end of the load the network can take. Reaching this threshold will cause the network to decrease the desired nodes. */
      lowThreshold?: number
    }
    /** Options for rate limiting */
    rateLimiting?: {
      /** The limitRate parameter is a Boolean indicating whether or not the network should rate limit in any way. */
      limitRate?: boolean
      /**
       * The loadLimit parameter is a Float (between 0 and 1) indicating the maximum level of load the network can handle before starting to drop transactions.
       * With loadLimit set to 0.5, at 75% or 0.75 load, the network would drop 50% of incoming transactions.
       * (The percentage of chance to drop a transaction scales linearly as the load increases past the threshold).
       **/
      loadLimit?: number
    }
    /** Server State manager module configuration */
    stateManager?: {
      /** The stateTableBucketSize parameter is an Integer which defines the max number of accountRecords that the p2p module will ask for in it’s get_account_state call. */
      stateTableBucketSize?: number
      /** The accountBucketSize This is also currently used as input to a p2p ask method for the max number of account records */
      accountBucketSize?: number
    }
    /** Options for sharding calculations */
    sharding?: {
      /** The nodesPerConsensusGroup parameter defines how many nodes will be contained within a shard */
      nodesPerConsensusGroup?: number
    }
  }

  export interface LogsConfiguration {
    saveConsoleOutput?: boolean
    dir?: string
    files?: {
      main?: string
      fatal?: string
      net?: string
      app?: string
    }
    options?: {
      appenders?: {
        out?: {
          type?: string
        }
        main?: {
          type?: string
          maxLogSize?: number
          backups?: number
        }
        fatal?: {
          type?: string
          maxLogSize?: number
          backups?: number
        }
        errorFile?: {
          type?: string
          maxLogSize?: number
          backups?: number
        }
        errors?: {
          type?: string
          maxLogSize?: number
          backups?: number
        }
        net?: {
          type?: string
          maxLogSize?: number
          backups?: number
        }
        playback?: {
          type?: string
          maxLogSize?: number
          backups?: number
        }
        shardDump?: {
          type?: string
          maxLogSize?: number
          backups?: number
        }
      }
    }
    categories?: {
      default?: {
        appenders?: string[]
        level?: string
      }
      main?: {
        appenders?: string[]
        level?: string
      }
      fatal?: {
        appenders?: string[]
        level?: string
      }
      net?: {
        appenders?: string[]
        level?: string
      }
      playback?: {
        appenders?: string[]
        level?: string
      }
      shardDump?: {
        appenders?: string[]
        level?: string
      }
    }
  }

  export interface StorageConfiguration {
    database?: string
    username?: string
    password?: string
    options?: {
      logging?: false
      host?: string
      dialect?: string
      operatorsAliases?: false
      pool?: {
        max?: number
        min?: number
        acquire?: number
        idle?: number
      }
      storage?: string
      sync?: {
        force?: false
      }
      memoryFile?: false
    }
  }

  export interface Node {
    id: string
    publicKey: string
    cycleJoined: number
    internalIp: string
    externalIp: string
    internalPort: number
    externalPort: number
    joinRequestTimestamp: number
    address: string
    status: string
  }

  export interface Cycle {
    counter: number
    certificate: any // todo proper definition of certificate!
    previous: string
    marker: string
    start: number
    duration: number
    active: number
    desired: number
    expired: number
    joined: string[]
    activated: string[]
    removed: string[]
    returned: string[]
    lost: string[]
    refuted: string[]
    apoptosized: string[]
  }

  export interface AcceptedTx {
    id: string
    timestamp: number
    data: OpaqueTransaction
    status: string
    receipt: TxReceipt
  }

  export interface TxReceipt {
    txHash: string
    sign?: Shardus.Sign
    time: number //transaction timestamp
    stateId: string //hash of the source account.  this should be phased out or modified to handle multiple sources
    targetStateId: string //hash of the target account.  this should be phased out or modified to handle multiple targets
  }

  type ObjectAlias = object
  /**
   * OpaqueTransaction is the way shardus should see transactions internally. it should not be able to mess with parameters individually
   */
  export interface OpaqueTransaction extends ObjectAlias {}
}
