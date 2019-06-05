import { start } from "repl";

// Type definitions for Shardus
// Project: Shardus Enterprise Server
// Definitions by: Erik Xavier
export = Shardus
declare class Shardus {
  constructor(configs?: Shardus.ShardusConfiguration)
  /**
   * Setups a application to use shardus enterprise server
   */
  setup(App: Shardus.App): Shardus
  start(exitProcOnFail?: boolean): void
  registerExternalGet(route: string, handler: (req: object, res: object) => void): void
  registerExternalPost(route: string, handler: (req: object, res: object) => void): void
  registerExternalPut(route: string, handler: (req: object, res: object) => void): void
  registerExternalDelete(route: string, handler: (req: object, res: object) => void): void
  registerExternalPatch(route: string, handler: (req: object, res: object) => void): void
  /**
   * Handle incoming transaction requests
   */
  put(req: object, res: object): Shardus.IncomingTransactionResult
}

declare namespace Shardus {
  export function ExpressHandler(req: object, res: object): void
  export interface App {
    validateTransaction: (inTx: Shardus.IncomingTransaction) => Shardus.IncomingTransactionResult
    validateTxnFields: (inTx: Shardus.IncomingTransaction) => Shardus.IncomingTransactionResult
    apply: (inTx: Shardus.IncomingTransaction) => Shardus.ApplyResponse
    getKeyFromTransaction: (inTx: Shardus.IncomingTransaction) => TransactionKeys
    getStateId: (accountAddress: string, mustExist?: boolean) => string
    close: () => void
  }
  
  export interface TransactionKeys {
    sourceKeys: string[],
    targetKeys: string[]
  }
  export interface ApplyResponse {
    stateTableResults: StateObject[],
    txId: string,
    txTimestamp: string,
    accountData: AccountData[]
  }

  export interface StateObject {
    accountId: string,
    txId: string,
    txTimestamp: string,
    stateBefore: string,
    stateAfter: string
  }

  export interface AccountData {
    accountId: string,
    data: string,
    txId: string,
    timestamp: string,
    hash: string,
  }

  export interface IncomingTransaction {
    srcAct: string,
    tgtAct: string,
    txnType: string,
    txnAmt: number,
    seqNum: number,
    sign: Shardus.Sign,
    txnTimestamp?: string
  }

  export interface Sign {
    onwer: string,
    sig: string
  }

  export interface IncomingTransactionResult {
    result: Results,
    reason: string,
    txnTimestamp?: string
  }

  enum Results { pass, fail }

  export interface ShardusConfiguration {
    heartbeatInterval: number,
    baseDir: string,
    transactionExpireTime: number,
    crypto: {
      hashKey: string
    },
    /** P2P module configuration */
    p2p: {
      ipServer: string,    
      timeServer: string,
      syncLimit: number,
      cycleDuration: number,
      maxRejoinTime: number,
      seedList: string,
      difficulty: number,
      queryDelay: number,
      netadmin: string,
      gossipRecipients: number,
      gossipTimeout: number,
      maxSeedNodes: number,
      minNodes: number,
      maxNodes: number,
      seedNodeOffset: number,
      nodeExpiryAge: number,
      maxNodesToRotate: number,
      maxNodesPerCycle: number,
      maxPercentOfDelta: number,
      scaleReqsNeeded: number,
      maxScaleReqs: number,
      amountToScale: number
    },
    ip: {
      externalIp: string,
      externalPort: number,
      internalIp: string,
      internalPort: number
    },
    network: {
      timeout: number
    },
    reporting: {
      report: boolean,
      recipient: string,
      interval: number,
      console: boolean
    },
    debug: {
      loseReceiptChance: number,
      loseTxChance: number
    },
    statistics: {
      save: boolean,
      interval: number
    },
    loadDetection: {
      queueLimit: number,
      desiredTxTime: number,
      highThreshold: number,
      lowThreshold: number
    },
    rateLimiting: {
      limitRate: boolean,
      loadLimit: number
    },
    stateManager: {
      stateTableBucketSize: number,
      accountBucketSize: number
    }
  }
}