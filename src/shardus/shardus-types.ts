import { start } from "repl";
import { Certificate } from "crypto";

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
  registerExternalGet(route: string, handler: any): void
  /**.
   * Register an external endpoint to shardus enterprise server.  version 2
   * https://shardus.gitlab.io/docs/developer/main-concepts/building-a-poc-app/shardus-app-interface/register-external-get.html
   * @param route The route to register an external POST endpoint
   * @param handler An express.js standard route handler function
   */  
  registerExternalPost(route: string, handler: any): void
  /**
   * Register an external endpoint to shardus enterprise server
   * @param route The route to register an external PUT endpoint
   * @param handler An express.js standard route handler function
   */  
  registerExternalPut(route: string, handler: any): void
  /**
   * Register an external endpoint to shardus enterprise server
   * @param route The route to register an external DELETE endpoint
   * @param handler An express.js standard route handler function
   */  
  registerExternalDelete(route: string, handler: any): void
  /**
   * Register an external endpoint to shardus enterprise server
   * @param route The route to register an external PATCH endpoint
   * @param handler An express.js standard route handler function
   */  
  registerExternalPatch(route: string, handler: any): void
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

  createWrappedResponse(accountId: string, accountCreated: boolean, hash: string, timestamp: number, fullData: any): Shardus.WrappedResponse

  setPartialData(response: any, partialData: any, userTag: any): void

  genericApplyPartialUpate(fullAccountData: any, updatedPartialAccount: any): void

  applyResponseAddState(applyResponse: any, fullAccountData: any, localCache: any, accountId: string, txId: string, txTimestamp: number, accountStateBefore: string, accountStateAfter: string, accountCreated: number): void

  getLocalOrRemoteAccount(address: string): Shardus.WrappedDataFromQueue
  // not sure where this def should go?
  // profiler: any
}

declare namespace Shardus {
  export interface App {

    /**
     * A function responsible for validation the incoming transaction fields
     */
    validateTxnFields: (inTx: Shardus.IncomingTransaction) => Shardus.IncomingTransactionResult
    /**
     * A function responsible for applying an accepted transaction
     */
    apply: (inTx: Shardus.IncomingTransaction, wrappedStates: any) => Shardus.ApplyResponse


    updateAccountFull: (wrappedStates: any, localCache: any, applyResponse: any) => void

    updateAccountPartial: (wrappedStates: any, localCache: any, applyResponse: any) => void

    getRelevantData: (accountId: string, tx: any) => any

    /**
     * A function that returns the Keys for the accounts involved in the transaction
     */
    getKeyFromTransaction: (inTx: Shardus.OpaqueTransaction) => TransactionKeys
    /**
     * A function that returns the State ID for a given Account Address
     */
    getStateId: (accountAddress: string, mustExist?: boolean) => string
    /**
     * A function that will be called when the shardus instance shuts down
     */
    close: () => void

    getAccountData: (accountStart: string, accountEnd: string, maxRecords: number) => any

    getAccountDataByRange: (accountStart: string, accountEnd: string, tsStart: number, tsEnd: number, maxRecords: number) => any

    calculateAccountHash: (account: string) => any

    setAccountData: (accountRecords: any) => any

    resetAccountData: (accountRecords: any) => any

    deleteAccountData: (addressList: any) => any

    getAccountDataByList: (addressList: any) => any

    deleteLocalAccountData: () => void

    getAccountDebugValue: (wrappedAccount: any) => string

    canDebugDropTx: (tx: any) => boolean
    
    /**
     * This gives the application a chance to sync or load initial data before going active.
     * If it is the first node it can use .set() to set data
     * If it is not the first node it could use getLocalOrRemote() to query data it needs.
     */
    sync: () => any
  }
  
  export interface TransactionKeys {
    /**
     * An array of the source keys
     */
    sourceKeys: string[],
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
    debugInfo: string
  }
  export interface ApplyResponse {
    /**
     * The statle table results array
     */
    stateTableResults: StateTableObject[],
    /**
     * Transaction ID
     */
    txId: string,
    /**
     * Transaction timestamp
     */
    txTimestamp: number,
    /**
     * Account data array
     */
    accountData: AccountData2[]
  }

  export interface WrappedResponse {
    accountId: string,
    accountCreated: boolean,
    isPartial: boolean,
    stateId: string,
    timestamp: number,
    data: any
  }

  export interface AccountData {
    /** Account ID */
    accountId: string,
    /** Account Data */
    data: string,
    /** Transaction ID */
    txId: string,
    /** Timestamp */
    timestamp: string,
    /** Account hash */
    hash: string,
  }

  export interface WrappedData {
    /** Account ID */
    accountId: string,
    /** hash of the data blob */
    stateId: string,
    /** data blob opaqe */
    data: any,
    /** Timestamp */
    timestamp: number,
  }
  //seenInQueue

  export interface WrappedDataFromQueue extends WrappedData {
    /** is this account still in the queue */
    seenInQueue: boolean,
  }

  export interface AccountData2 {
    /** Account ID */
    accountId: string,
    /** Account Data */
    data: string,
    /** Transaction ID */
    txId: string,
    /** Timestamp */
    txTimestamp: string,
    /** Account hash */
    hash: string,
    /** Account data */
    accountData: any,
    /** localCache */
    localCache: any,
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
    accountId: string,
    /** Transaction ID */
    txId: string,
    /** Transaction Timestamp */
    txTimestamp: string,
    /** The hash of the state before applying the transaction */
    stateBefore: string,
    /** The hash of the state after applying the transaction */
    stateAfter: string
  }

  // NEED to loosen this defination..  shardus should not know this much!!!  maybe just move it to the app side
  export interface IncomingTransaction {
    /** Source account address for the transaction */
    srcAct: string,
    /** Target account address for the transaction */
    tgtActs?: string,
    /** Target account addresses for the transaction */
    tgtAct?: string,    
    /** The transaction type */
    txnType: string,
    /** The transaction amount */
    txnAmt: number,
    /** The transaction Sequence Number */
    seqNum: number,
    /** The transaction signature */
    sign: Shardus.Sign,
    /** The transaction timestamp */
    txnTimestamp?: string
  }

  export interface Sign {
    /** The key of the owner */
    owner: string,
    /** The hash of the object's signature signed by the owner */
    sig: string
  }

  export interface IncomingTransactionResult {
    /** The result for the incoming transaction */
    result: string,    //was Results before.. but having trouble with that
    /** The reason for the transaction result */
    reason: string,
    /** The timestamp for the result */
    txnTimestamp?: string
  }

  enum Results { pass, fail }

  export interface ShardusConfiguration {
    heartbeatInterval?: number,
    baseDir?: string,
    transactionExpireTime?: number,
    /** Crypto module configuration */
    crypto?: {
      /** The hash key for initializing the crypto module */
      hashKey?: string
    },
    /** P2P module configuration */
    p2p?: {
      /**  */
      ipServer?: string,
      /**  */
      timeServer?: string,
      /**  */
      syncLimit?: number,
      /**  */
      cycleDuration?: number,
      /**  */
      maxRejoinTime?: number,
      /**  */
      seedList?: string,
      /**  */
      difficulty?: number,
      /**  */
      queryDelay?: number,
      /**  */
      netadmin?: string,
      /**  */
      gossipRecipients?: number,
      /**  */
      gossipTimeout?: number,
      
      maxSeedNodes?: number,
      /**  */
      minNodes?: number,
      /**  */
      maxNodes?: number,
      /**  */
      seedNodeOffset?: number,
      /**  */
      nodeExpiryAge?: number,
      /**  */
      maxNodesToRotate?: number,
      /**  */
      maxNodesPerCycle?: number,
      /**  */
      maxPercentOfDelta?: number,
      /**  */
      scaleReqsNeeded?: number,
      /**  */
      maxScaleReqs?: number,
      /**  */
      amountToScale?: number
    },
     /** Server IP configuration */
    ip?: {
      /** The IP address the server will run the external API */
      externalIp?: string,
      /** The port the server will run the external API */
      externalPort?: number,
      /** The IP address the server will run the internal comunication API */
      internalIp?: string,
      /** The port the server will run the internal comunication API  */
      internalPort?: number
    },
    /** Server Network module configuration */
    network?: {
      /**  */
      timeout?: number
    },
    /** Server Report module configuration */
    reporting?: {
      /**  */
      report?: boolean,
      /**  */
      recipient?: string,
      /**  */
      interval?: number,
      /**  */
      console?: boolean
    },
    /** Server Debug module configuration */
    debug?: {
      /**  */
      loseReceiptChance?: number,
      /**  */
      loseTxChance?: number
    },
    /**  */
    statistics?: {
      /**  */
      save?: boolean,
      /**  */
      interval?: number
    },
    /**  */
    loadDetection?: {
      /**  */
      queueLimit?: number,
      /**  */
      desiredTxTime?: number,
      /**  */
      highThreshold?: number,
      /**  */
      lowThreshold?: number
    },
    /**  */
    rateLimiting?: {
      /**  */
      limitRate?: boolean,
      /**  */
      loadLimit?: number
    },
    /** Server State manager module configuration */
    stateManager?: {
      /**  */
      stateTableBucketSize?: number,
      /**  */
      accountBucketSize?: number
    }
  }

  export interface Node {
    id: string,
    publicKey: string,
    cycleJoined: number,
    internalIp: string,
    externalIp: string,
    internalPort: number,
    externalPort: number,
    joinRequestTimestamp: number,
    address: string,
    status: string,
  }

  export interface Cycle {
    counter: number,
    certificate: any, // todo proper definition of certificate!
    previous: string,
    marker: string,
    start: number,
    duration: number,
    active: number,
    desired: number,
    expired: number,
    joined: string[],
    activated: string[],
    removed: string[],
    returned: string[],
    lost: string[],
    refuted: string[],
    apoptosized: string[],
  }

  export interface AcceptedTx {
    id: string,
    timestamp: number,
    data: OpaqueTransaction,
    status: string,
    receipt: TxReceipt,
  }

  export interface TxReceipt {
    txHash: string,
    sign?: Shardus.Sign,    
    time: number, //transaction timestamp    
    stateId: string, //hash of the source account.  this should be phased out or modified to handle multiple sources
    targetStateId: string, //hash of the target account.  this should be phased out or modified to handle multiple targets
  }

  type ObjectAlias = object;
  /**
   * OpaqueTransaction is the way shardus should see transactions internally. it should not be able to mess with parameters individually
   */
  export interface OpaqueTransaction extends ObjectAlias {

  }

}