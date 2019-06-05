import { start } from "repl";

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
   * @param route The route to register an external GET endpoint
   * @param handler An express.js standard route handler function
   */
  registerExternalGet(route: string, handler: (req: object, res: object) => void): void
  /**
   * Register an external endpoint to shardus enterprise server
   * @param route The route to register an external POST endpoint
   * @param handler An express.js standard route handler function
   */  
  registerExternalPost(route: string, handler: (req: object, res: object) => void): void
  /**
   * Register an external endpoint to shardus enterprise server
   * @param route The route to register an external PUT endpoint
   * @param handler An express.js standard route handler function
   */  
  registerExternalPut(route: string, handler: (req: object, res: object) => void): void
  /**
   * Register an external endpoint to shardus enterprise server
   * @param route The route to register an external DELETE endpoint
   * @param handler An express.js standard route handler function
   */  
  registerExternalDelete(route: string, handler: (req: object, res: object) => void): void
  /**
   * Register an external endpoint to shardus enterprise server
   * @param route The route to register an external PATCH endpoint
   * @param handler An express.js standard route handler function
   */  
  registerExternalPatch(route: string, handler: (req: object, res: object) => void): void
  /**
   * Handle incoming transaction requests
   * @param req An express Require parameter
   * @param res An express Response parameter
   */
  put(req: object, res: object): Shardus.IncomingTransactionResult
  /**
   * A function that clears shardus App related State
   */
  resetAppReleatedState(): void
  /**
   * A function that executes a cleanup and terminates the server
   * @param exitProcess Flag to define if process.exit() should be called or not. Default: true
   */
  shutdown(exitProcess?: boolean): void
}

declare namespace Shardus {
  export interface App {
    /**
     * A function responsible for validation an incoming transaction
     */
    validateTransaction: (inTx: Shardus.IncomingTransaction) => Shardus.IncomingTransactionResult
    /**
     * A function responsible for validation the incoming transaction fields
     */
    validateTxnFields: (inTx: Shardus.IncomingTransaction) => Shardus.IncomingTransactionResult
    /**
     * A function responsible for applying an accepted transaction
     */
    apply: (inTx: Shardus.IncomingTransaction) => Shardus.ApplyResponse
    /**
     * A function that returns the Keys for the accounts involved in the transaction
     */
    getKeyFromTransaction: (inTx: Shardus.IncomingTransaction) => TransactionKeys
    /**
     * A function that returns the State ID for a given Account Address
     */
    getStateId: (accountAddress: string, mustExist?: boolean) => string
    /**
     * A function that will be called when the shardus instance shuts down
     */
    close: () => void
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
  }
  export interface ApplyResponse {
    /**
     * The statle table results array
     */
    stateTableResults: StateObject[],
    /**
     * Transaction ID
     */
    txId: string,
    /**
     * Transaction timestamp
     */
    txTimestamp: string,
    /**
     * Account data array
     */
    accountData: AccountData[]
  }

  export interface StateObject {
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

  export interface IncomingTransaction {
    /** Source account address for the transaction */
    srcAct: string,
    /** Target account address for the transaction */
    tgtAct: string,
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
    onwer: string,
    /** The hash of the object's signature signed by the owner */
    sig: string
  }

  export interface IncomingTransactionResult {
    /** The result for the incoming transaction */
    result: Results,
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
}