import { P2P } from '@shardus/types'
import { JoinRequest } from '@shardus/types/build/src/p2p/JoinTypes'
import { AppObjEnum } from '../types/enum/AppObjEnum'
export type Node = P2P.NodeListTypes.Node
export type Cycle = P2P.CycleCreatorTypes.CycleRecord
export type Archiver = P2P.ArchiversTypes.JoinedArchiver
export interface NodeWithRank {
  rank: bigint
  id: string
  status: string
  publicKey: string
  externalIp: string
  externalPort: number
  internalIp: string
  internalPort: number
}

export { AppObjEnum }

//import { RequestHandler } from "express"; //express was causing problems.

// Type definitions for Shardus
// Project: Shardus Enterprise Server
// Definitions by: Erik Xavier
// export class Shardus {
//   constructor(configs?: ShardusConfiguration)
//   /**
//    * Setups an application to run within the shardus enterprise server instance
//    * @param App The provided application
//    */
//   setup(App: App): Shardus
//   /**
//    * Starts the shardus enterprise server instace
//    * @param exitProcOnFail Sets if the process should terminate on any error
//    *
//    */
//   start(exitProcOnFail?: boolean): void
//   /**
//    * Register an external endpoint to shardus enterprise server
//    * https://shardus.gitlab.io/docs/developer/main-concepts/building-a-poc-app/shardus-app-interface/register-external-get.html
//    * @param route The route to register an external GET endpoint
//    * @param handler An express.js standard route handler function
//    */
//   registerExternalGet(route: string, handler: RequestHandler): void
//   /**.
//    * Register an external endpoint to shardus enterprise server.  version 2
//    * https://shardus.gitlab.io/docs/developer/main-concepts/building-a-poc-app/shardus-app-interface/register-external-get.html
//    * @param route The route to register an external POST endpoint
//    * @param handler An express.js standard route handler function
//    */

//   registerExternalPost(route: string, handler: RequestHandler): void
//   /**
//    * Register an external endpoint to shardus enterprise server
//    * @param route The route to register an external PUT endpoint
//    * @param handler An express.js standard route handler function
//    */

//   registerExternalPut(route: string, handler: RequestHandler): void
//   /**
//    * Register an external endpoint to shardus enterprise server
//    * @param route The route to register an external DELETE endpoint
//    * @param handler An express.js standard route handler function
//    */

//   registerExternalDelete(route: string, handler: RequestHandler): void
//   /**
//    * Register an external endpoint to shardus enterprise server
//    * @param route The route to register an external PATCH endpoint
//    * @param handler An express.js standard route handler function
//    */

//   registerExternalPatch(route: string, handler: RequestHandler): void
//   /**
//    * Register handler for caught exceptions on http requests
//    */
//   registerExceptionHandler(): void
//   /**
//    * Handle incoming transaction requests
//    *
//    * @param tx the transaction
//    * @param set?
//    */
//   put(tx: object, set?: boolean): IncomingTransactionResult
//   /**
//    * Handle incoming set requests
//    *
//    * @param tx the set tx
//    */
//   set(tx: object): IncomingTransactionResult
//   /**
//    * Logging for the application
//    * @param data The data you want the application to log
//    */
//   log(...data: any): void
//   /**
//    * A function that clears shardus App related State
//    */
//   resetAppRelatedState(): void
//   /**
//    * A function that executes a cleanup and terminates the server
//    * @param exitProcess Flag to define if process.exit() should be called or not. Default: true
//    */
//   shutdown(exitProcess?: boolean): void

//   /**
//    * Returns the application associated with the shardus module
//    * @param Application The configured application
//    */

//   _getApplicationInterface(Application: App): App

//   createApplyResponse(txId: string, txTimestamp: number): ApplyResponse

//   createWrappedResponse(
//     accountId: string,
//     accountCreated: boolean,
//     hash: string,
//     timestamp: number,
//     fullData: any
//   ): WrappedResponse

//   setPartialData(response: any, partialData: any, userTag: any): void

//   genericApplyPartialUpate(
//     fullAccountData: any,
//     updatedPartialAccount: any
//   ): void

//   applyResponseAddState(
//     applyResponse: any,
//     fullAccountData: any,
//     localCache: any,
//     accountId: string,
//     txId: string,
//     txTimestamp: number,
//     accountStateBefore: string,
//     accountStateAfter: string,
//     accountCreated: boolean
//   ): void

//   getLocalOrRemoteAccount(
//     address: string
//   ): Promise<WrappedDataFromQueue>

//   getRemoteAccount(address: string): Promise<WrappedDataFromQueue>

//   getLatestCycles(): Cycle[]

//   getNodeId(): string

//   getClosestNodes(hash: string, number: number): string[]

//   getNode(nodeId: string): Node
//   // not sure where this def should go?
//   // profiler: any
//   p2p: any
// }

interface ValidateJoinRequestResponse {
  success: boolean
  reason: string
  fatal: boolean
  data?: string
}

export interface InjectTxResponse {
  success: boolean
  reason?: string
}

export interface App {
  injectTxToConsensor(
    consensor: ValidatorNodeDetails[],
    tx: OpaqueTransaction
  ): Promise<InjectTxResponse | null>
  getNonceFromTx(tx: OpaqueTransaction): bigint
  getAccountNonce(accountId: string, wrappedData?: WrappedData): Promise<bigint>
  getTxSenderAddress(tx: OpaqueTransaction): string
  /**
   * Runs fast validation of the tx checking if all tx fields present, data
   * types acceptable, and ranges valid.
   *
   * Returns whether tx pass or failed validation plus the reason why
   */
  validate(tx: OpaqueTransaction, appData: any): { success: boolean; reason: string; status: number }

  /**
   * Checks if the incoming transaction is an internal tx or not
   *
   * Returns a boolean value indicaing the same
   */
  isInternalTx(tx: OpaqueTransaction): boolean

  /**
   * Cracks open the transaction and returns its timestamp, id (hash), and any
   * involved keys.
   *
   * Txs passed to this function are guaranteed to have passed validation first.
   */
  crack(
    tx: OpaqueTransaction,
    appData: any
  ): {
    timestamp: number
    id: string
    keys: TransactionKeys
    shardusMemoryPatterns: ShardusMemoryPatternsInput
  }

  /**
   * give the app a chance to generate additional data for the crack function
   * @param tx
   * @param appData
   */
  txPreCrackData(tx: OpaqueTransaction, appData: any): Promise<{ status: boolean; reason: string }> // Promise<any>

  // DEPRECATED . This was previously a deep validate for buisness logic but it is up to the dapp to handle this as part of apply
  validateTransaction?: (...data: any) => any
  /**
   * A function responsible for validation the incoming transaction fields
   */
  // DEPRECATED in favor of `validate`
  validateTxnFields?: (
    inTx: OpaqueTransaction, // it is better to not use IncomingTransaction
    appData: any
  ) => IncomingTransactionResult
  /**
   * A function responsible for applying an accepted transaction
   */
  apply: (
    inTx: OpaqueTransaction,
    wrappedStates: { [accountId: string]: WrappedData },
    appData: any
  ) => Promise<ApplyResponse>

  /**
   * This is called after consensus has received or produced a receipt and the trasaction is approved.
   * Do not change any of the values passes in.
   * This is a place to generate other transactions, or do off chain work like send and email.
   * isExecutionGroup: boolean  this is set to true if we are in the execution group
   */
  transactionReceiptPass?: (
    inTx: OpaqueTransaction,
    wrappedStates: any,
    applyResponse: ApplyResponse,
    isExecutionGroup: boolean
  ) => void

  /**
   * This is called after consensus has received or produced a receipt and the trasaction fails.
   * Do not change any of the values passes in.
   * This is a place to generate other transactions, or do off chain work like send and email.
   */

  transactionReceiptFail?: (inTx: OpaqueTransaction, wrappedStates: any, applyResponse: ApplyResponse) => void

  updateAccountFull: (wrappedState: WrappedResponse, localCache: any, applyResponse: ApplyResponse) => void

  updateAccountPartial: (wrappedState: WrappedResponse, localCache: any, applyResponse: ApplyResponse) => void

  getRelevantData: (accountId: string, tx: object, appData: any) => Promise<WrappedResponse>

  /**
   * A function responsible for getting timestamp from injected transaction
   */
  getTimestampFromTransaction: (
    inTx: OpaqueTransaction, // it is better to not use IncomingTransaction
    appData: {}
  ) => number

  calculateTxId: (inTx: OpaqueTransaction) => string

  /**
   * A function that returns the Keys for the accounts involved in the transaction
   */
  // DEPRECATED in favor of `crack`
  getKeyFromTransaction?: (inTx: OpaqueTransaction) => TransactionKeys
  /**
   * A function that returns the State ID for a given Account Address
   */
  getStateId?: (accountAddress: string, mustExist?: boolean) => Promise<string>
  /**
   * A function that returns the timestamp for a given Account Address
   */
  getAccountTimestamp?: (accountAddress: string, mustExist?: boolean) => Promise<number>

  /**
   * A function that allows the app to look at a passed in account ane return the hash and timestamp
   */
  getTimestampAndHashFromAccount?: (account: any) => {
    timestamp: number
    hash: string
  }

  /**
   * A function that will be called when the shardus instance shuts down
   */
  close: () => void

  getAccountData: (accountStart: string, accountEnd: string, maxRecords: number) => Promise<WrappedData[]>

  getAccountDataByRange: (
    accountStart: string,
    accountEnd: string,
    tsStart: number,
    tsEnd: number,
    maxRecords: number,
    offset: number,
    accountOffset: string
  ) => Promise<WrappedData[]>

  calculateAccountHash: (account: unknown) => string

  setAccountData: (accountRecords: unknown[]) => Promise<void>

  resetAccountData: (accountRecords: unknown[]) => void

  deleteAccountData: (addressList: string[]) => void

  getAccountDataByList: (addressList: string[]) => Promise<WrappedData[]>

  getCachedRIAccountData: (addressList: string[]) => Promise<WrappedData[]>

  setCachedRIAccountData: (accountRecords: unknown[]) => Promise<void>

  getNetworkAccount: () => Promise<WrappedData>

  deleteLocalAccountData: () => Promise<void>

  getAccountDebugValue: (wrappedAccount: WrappedData) => string

  getSimpleTxDebugValue?: (tx: unknown) => string

  canDebugDropTx?: (tx: unknown) => boolean

  /**
   * This gives the application a chance to sync or load initial data before going active.
   * If it is the first node it can use .set() to set data
   * If it is not the first node it could use getLocalOrRemote() to query data it needs.
   */
  sync?: () => any

  dataSummaryInit?: (blob: any, accountData: any) => void
  dataSummaryUpdate?: (blob: any, accountDataBefore: any, accountDataAfter: any) => void
  txSummaryUpdate?: (blob: any, tx: any, wrappedStates: any) => void
  // use of minNodes instead of baselineNodes here do to minNodes used when not in processing mode (check shardeum-server condition where used)
  validateJoinRequest?: (
    data: any,
    mode: P2P.ModesTypes.Record['mode'] | null,
    latestCycle: Cycle,
    minNodes: number
  ) => ValidateJoinRequestResponse
  validateArchiverJoinRequest?: (data: any) => any
  getJoinData?: () => any
  eventNotify?: (event: ShardusEvent) => void
  isReadyToJoin: (
    latestCycle: Cycle,
    nodePublicKey: string,
    activeNodes: P2P.P2PTypes.Node[],
    mode: P2P.ModesTypes.Record['mode'] | null
  ) => Promise<boolean>

  getNodeInfoAppData?: () => any
  signAppData?: (type: string, hash: string, nodesToSign: number, appData: any) => Promise<SignAppDataResult>
  updateNetworkChangeQueue?: (account: WrappedData, appData: any) => Promise<WrappedData[]>
  pruneNetworkChangeQueue?: (account: WrappedData, cycle: number) => Promise<WrappedData[]>
  beforeStateAccountFilter?: (account: WrappedData) => boolean
  canStayOnStandby: (joinInfo: JoinRequest) => { canStay: boolean; reason: string }
  binarySerializeObject: (identifier: AppObjEnum, obj: any) => Buffer
  binaryDeserializeObject: (identifier: AppObjEnum, buffer: Buffer) => any
  verifyMultiSigs: (
    rawPayload: object,
    sigs: Sign[],
    allowedPubkeys: { [pubkey: string]: DevSecurityLevel },
    minSigRequired: number,
    requiredSecurityLevel: DevSecurityLevel
  ) => boolean
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
   * Optional(for now) list of accounts that were written to
   * Can include accounts that were not in the initial list of involved accounts
   */
  accountWrites: {
    accountId: string
    data: WrappedResponse
    txId: string
    timestamp: number
  }[]
  /**
   * a blob for the app to define.
   * This gets passed to post apply
   */
  appDefinedData: unknown
  /**
   * can return this if failed instead of throwing an exception
   */
  failed: boolean
  failMessage: string
  /**
   * a blob of dapp data returned. This can attach to the receipt for a pass
   * or fail vote
   */
  appReceiptData: any
  appReceiptDataHash: string
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
  data: unknown
  timestamp: number
  hash: string
  isGlobal: boolean
}

export interface WrappedData {
  /** Account ID */
  accountId: string
  /** hash of the data blob */
  stateId: string
  /** data blob opaqe */
  data: unknown
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
  localCache?: any // TODO CODEREIVEW: use by partial data, but really need to code review everything localCache related.
  // LocalCache was supposed to be a full copy of the account before tx was applied. This would allow for
  // sending partial account data out for a TX but still doing the full transform when it is local
  // for some reason localCache is also getting check for logic to determin if the account should be saved locally,
  // a more explicit mechanism would be nicer

  // state manager tracking
  prevStateId?: string
  // need a before copy of the data for stats system. may not be super effcient. possibly merge this with original data on the queue entry
  prevDataCopy?: any
  sign?: Sign
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
export interface TimestampReceipt {
  txId: string
  cycleMarker: string
  cycleCounter: number
  timestamp: number
}

export interface TimestampedTx {
  tx: OpaqueTransaction
  timestampReceipt?: TimestampReceipt
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
  accountData: unknown
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
  sign: Sign
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
  status?: number
}

export enum ServerMode {
  Debug = 'debug',
  Release = 'release',
}

// enum for security levels
export enum DevSecurityLevel {
  Unauthorized = 0,
  Low = 1,
  Medium = 2,
  High = 3,
}

export interface ServerConfiguration {
  /** The heartbeatInterval parameter is an Integer that defines the number of seconds between each heartbeat logged within shardus */
  heartbeatInterval?: number
  /** The baseDir parameter is a String that defines the relative base directory for this running instance of shardus */
  baseDir?: string
  /** The transactionExpireTime parameter is an Integer that defines the amount of time (in seconds) allowed to pass before a transaction will expire and be rejected by the network. */
  transactionExpireTime?: number
  /** The changeListGlobalAccount sets the global network account value for the validator and thereby the whole network */
  globalAccount: string
  /**
   * [TODO] Introduced on 2024-04-15 and needs to be checked through out the code
   * nonce mode:
   *   * Client signed tx has a nonce
   *   * network assigns timestamp
   *   * if network cancels tx its gets resubmitted by the network
   *   * if network cancels a tx its not propagated to archivers
   * timestamp mode:
   *   * Client signed tx has timestamp
   *   * network does not assign timestamp
   *   * if network cancels tx its does not get resubmitted by the network
   *   * if network cancels a tx it gets propagated to archivers
   */
  nonceMode: boolean
  /** Crypto module configuration */
  crypto?: {
    /** The hashkey parameter is a String that is used to initialize the crypto module, which is used for the cryptographic functions within shardus */
    hashKey?: string
    /** All config related to the node keypair */
    keyPairConfig?: {
      useKeyPairFromFile?: boolean
      /** The file location to save and fetch the keypair from. The secrets will use the baseDir to look for the file */
      keyPairJsonFile?: string
    }
  }
  /** P2P module configuration */
  p2p?: {
    /** The ipServer parameter is an array of Strings that specifies a urls for the ipServer. */
    ipServers?: string[]
    /** The timeServers parameter is an Array of String that specifies where to get time critical data. */
    timeServers?: string[]
    /**  */
    existingArchivers?: Array<P2P.P2PTypes.Node>
    /** The syncLimit parameter is an Integer that specifies the amount of time (in seconds) a node’s local time can differ from the network’s time. */
    syncLimit?: number
    /** use ntp offset in our ShardusDateNow() Funtion */
    useNTPOffsets?: boolean
    /** use fake time offset in our ShardusDateNow() Function (debug-test only)*/
    useFakeTimeOffsets?: boolean

    /** The cycleDuration parameter is an Integer specifying the amount of time (in seconds) it takes for a shardus network cycle to complete. */
    cycleDuration?: number
    /** The maxRejoinTime parameter is an Integer specifying the amount of time (in seconds) between network heartbeats before a node must ask to rejoin. */
    maxRejoinTime?: number
    /** The seedList parameter is a String specifying the url for the seedNode server that the application will communicate with. */
    // seedList?: string
    /** The dynamicBogonFiltering is a boolean specifying if the network should dynamically filter Bogon IPs */
    dynamicBogonFiltering: boolean
    /** hack to force filtering to be on, can remove this after more testing */
    forceBogonFilteringOn: boolean
    /** check if we are about to send a bogon IP in a join request. (not this is a good node behavoir may need it off for testing) */
    rejectBogonOutboundJoin: boolean
    /** The difficulty parameter is an Integer specifying the proof of work difficulty to prevent network spam. */
    difficulty?: number
    /** The queryDelay parameter is an Integer specifying the amount of time (in seconds) to delay between cycle phase. */
    queryDelay?: number
    /** The netadmin parameter is a String specifying the public key of the network admin for emergency network alerts, updates, or broadcasts. */
    // netadmin?: string
    /** The gossipRecipients parameter is an Integer specifying the number of nodes to send gossip to in the network after receiving a message.
     * Shardus groups nodes with neighbors, who they can gossip the message to, so you can set this pretty low and still expect it to be
     * propogated through the entire network. (It’s recommended to set this to AT LEAST 3, 4 is recommended, and 5 would be even safer,
     * but maybe overkill). Shardus will send 2 gossips to neighboring nodes, and send the remaining number left over in the parameter to
     * random nodes in the network, so messages will be propagated very quickly.
     **/
    gossipRecipients?: number
    gossipFactor?: number
    /** When dynamicGossipFactor is true use calculateGossipFactor instead of gossipFactor */
    dynamicGossipFactor: boolean
    gossipStartSeed?: number
    gossipSeedFallof?: number
    /** The gossipTimeout parameter is an Integer specifying the amount of time (in seconds) before an old gossip is deleted from a node. */
    gossipTimeout?: number
    /** The maxSeedNodes parameter is an Integer specifying the maximum number of seedNodes used to be used. */
    maxSeedNodes?: number
    /** The minNodesToAllowTxs parameter is an Integer specifying the minimum number of active nodes needed in the network to process txs. */
    minNodesToAllowTxs?: number
    /** The continueOnException parameter is a toggle that, when true, allows the node to continue running if it enounters an unhandled exception
     *  and the number of active nodes in the network is < minNodesPerctToAllowExitOnException of minNodes.
     */
    continueOnException?: boolean
    /** The minNodesPerctToAllowExitOnException parameter is an Integer used to calculate the minimum number of active nodes needed in the network to allow a node to exit on exception.
     *  If the number of active nodes in the network is less than (minNodesPerctToAllowExitOnException) * (minNodes), then the node will not exit on exception.
     */
    minNodesPerctToAllowExitOnException?: number
    /** The baselineNodes parameter is an Integer specifying the minimum number of nodes that need to be active to not change the mode into safety, recovery, and restore. */
    baselineNodes?: number
    /** The minNodes parameter is an Integer specifying the minimum number of nodes that need to be active in the network in order to process transactions. */
    minNodes?: number
    /** The maxNodes parameter is an Integer specifying the maximum number of nodes that can be active in the network at once. */
    maxNodes?: number
    /** should the maxStandbyCount limit be enforced*/
    enableMaxStandbyCount: boolean
    /** The mamaxStandbyCount  parameter is an Integer specifying the maximum number of standby nodes that can be in the network**/
    maxStandbyCount: number
    /** The seedNodeOffset parameter is an Integer specifying the number of seedNodes to remove when producing the seedList */
    seedNodeOffset?: number
    /** The nodeExpiryAge parameter is an Integer specifying the amount of time (in seconds) before a node can be in the network before getting rotated out. */
    nodeExpiryAge?: number

    /** The maxJoinedPerCycle parameter is an Integer specifying the maximum number of nodes that can join the syncing phase each cycle. */
    maxJoinedPerCycle?: number
    /** The maxSyncingPerCycle parameter is an Integer specifying the maximum number of nodes that can be in the syncing phase each cycle. */
    maxSyncingPerCycle?: number
    /** allow syncing more nodes in a small network. only works well if we are not loading a lot of data */
    syncBoostEnabled?: boolean
    /** The max syncing time a node can take */
    maxSyncTimeFloor?: number
    /** max nodes to calculate median/max sync time */
    maxNodeForSyncTime?: number
    /** The maxRotatedPerCycle parameter is an Integer specifying the maximum number of nodes that can that can be rotated out of the network each cycle. */
    maxRotatedPerCycle?: number
    /** A fixed boost to let more nodes in when we have just the one seed node in the network */
    firstCycleJoin?: number

    /** The maxPercentOfDelta parameter is an Integer specifying the percent out of 100 that additional nodes can be accepted to the network. */
    maxPercentOfDelta?: number
    /** The minScaleReqsNeeded parameter is an Integer specyifying the number of internal scaling requests shardus needs to receive before scaling up or down the number of desired nodes in the network.
     *  This is just the minimum votes needed, scaleConsensusRequired is a 0-1 fraction of num nodes required.
     *  The votes needed is  Math.Max(minScaleReqsNeeded,  numNodes * scaleConsensusRequired )
     */
    minScaleReqsNeeded?: number
    /** The maxScaleReqs parameter is an Integer specifying the maximum number of scaling requests the network will process before scaling up or down. */
    maxScaleReqs?: number
    /** What fraction 0-1 of numNodes is required for a scale up or down vote */
    scaleConsensusRequired?: number
    /** The amountToGrow parameter is an Integer specifying the amount of nodes to ADD to the number of desired nodes the network wants. */
    amountToGrow?: number
    /** The amountToShrink parameter is an Integer specifying the amount of nodes to REMOVE from the number of desired nodes the network wants. */
    amountToShrink?: number
    /** The 0-1 multipler to active nodes of how many nodes we can shrink by in one cycle.  This is a cap but will be at least amountToShrink */
    maxShrinkMultiplier?: number
    /** When 0 there will be no scaling when 1 the full scaling factor will be applied */
    scaleInfluenceForShrink?: number
    /** max desired nodes based on a multiplier of our active node count */
    maxDesiredMultiplier?: number
    /** If witenss mode is true, node will not join the network but help other nodes to sync the data */
    startInWitnessMode?: boolean
    experimentalSnapshot?: boolean
    detectLostSyncing?: boolean
    /** limit the scaling group to a max number of nodes */
    scaleGroupLimit?: number
    /** this is to switch to signature based auth for gossip messages. default: false */
    useSignaturesForAuth?: boolean
    /** should the shardus core version be checked */
    checkVersion: boolean
    /** how many extra cycles should we keep beyond the cycles needed to cover known node counts */
    extraCyclesToKeep: number
    /** multiplier applied to cycle to keep before extraCyclesToKeep is added */
    extraCyclesToKeepMultiplier: number
    /** Should the node remove itself from the network (apoptosize) if the network has stopped */
    checkNetworkStopped: boolean
    /** Toggles Active Request validation on or off */
    validateActiveRequests: boolean
    /** for the cycle syncing to complete if it is stuck */
    hackForceCycleSyncComplete: boolean
    /** Unique Ids between Apop and Removed Nodes */
    uniqueRemovedIds: boolean
    /** Unique Ids between Apop and Removed Nodes ( Fix for collision because of the apop nodes that are due to lost ) */
    uniqueRemovedIdsUpdate: boolean
    /** Unique Ids between Apop and Lost Nodes */
    uniqueLostIdsUpdate: boolean
    /** Use LRU cache for socket connection mgmt in shardus/net. Default: false */
    useLruCacheForSocketMgmt: boolean
    /** LRU cache size for socket connection mgmt in shardus/net. Is used only if `useLruCacheForSocketMgmt` is set to `true`. Default: 1000 */
    lruCacheSizeForSocketMgmt: number
    /** Number of cycles we want to delay the lost report by */
    delayLostReportByNumOfCycles: number
    /** If disabled, the lost reports are sent to the checker immediately */
    aggregateLostReportsTillQ1: boolean

    /** how many cycles old should an is down cache entry be before we clear it */
    isDownCachePruneCycles: number
    /** should we use the is down cache */
    isDownCacheEnabled: boolean
    /** how many cycles before we prune our info of a node being lost and can report it again */
    stopReportingLostPruneCycles: number
    /** how many cycles before we prune our info of our map of lost node information */
    lostMapPruneCycles: number
    /** To forward the receipt data to the archivers as soon as a receipt is formed */
    instantForwardReceipts: boolean
    /** A node can serve only X max archivers for data transfer and can refuse other archivers requests if it’s serving the max number */
    maxArchiversSubscriptionPerNode: number
    /** Whether to write `nodeListHash` and `archiverListHash` to CycleRecords */
    writeSyncProtocolV2: boolean
    /** Use the new experimental sync protocol for better synchronizing efficiency. Other nodes must also have this enabled for it to work. */
    useSyncProtocolV2: boolean
    /** To validate the archiver app data from dapp in the archiver join request */
    validateArchiverAppData: boolean
    /** use the mode system to regulate network growth and transactions*/
    useNetworkModes: boolean
    /** Use the new join protocol that gossips all valid join requests to validators.  */
    useJoinProtocolV2: boolean
    /** Add a random wait before sending the join effect. Should not need this but may be a safet valve if timing in the network gets off
     * for example the nodes trying to join do not have the same cycle time as the network
     */
    randomJoinRequestWait: number

    /** number of cycles a node can age while in the standby list.  when it has been in the list beyond this time
     * it is added to standbyRemove and removed from the list.  The waiting node will detect this and do a
     * clean exit which will allow it to restart
     */
    standbyListCyclesTTL: number

    /** This limitts the amount of nodes removed from the network in a single cycle due to age in the strandby list.
     * This is to prevent a large number of nodes leaving all at once.  leaving is not a big deal but then they may try to sync/join again at the same time
     */
    standbyListMaxRemoveTTL: number

    /**This limitts the amount of nodes removed from the network in a single cycle due to app reasons (for example an app version check.
     * This is to prevent a large number of nodes leaving all at once.  leaving is not a big deal but then they may try to sync/join again at the same time
     */
    standbyListMaxRemoveApp: number

    /** remove nodes form the standb list that have been in for too long (standbyListCyclesTTL) */
    standbyAgeScrub: boolean
    /** remove nodes from the list that are the wrong version */
    standbyVersionScrub: boolean
    /** check a standby node to see if it is still up */
    standbyAgeCheck: boolean
    /** this is the percent delay fraction of a quarter cycle duration that we wait before sending cycle transactions
     * This is needed because of small delays between what time the cycle starts for any given node.
     * NTP gets us closer, but it will never be perfect
     */
    q1DelayPercent: number
    /* Golden ticket enablement to allow nodes join the network without staking and have priority over other nodes */
    goldenTicketEnabled: boolean
    /* Weather to check isNodeValidForInternalMessage before gossip */
    preGossipNodeCheck: boolean
    /* isNodeValidForInternalMessage parameter checkForNodeDown*/
    preGossipDownCheck: boolean
    /* isNodeValidForInternalMessage parameter checkForNodeLost*/
    preGossipLostCheck: boolean
    /* isNodeValidForInternalMessage parameter checkIsUpRecent*/
    preGossipRecentCheck: boolean
    /** The initShutdown flag can be switched on by an Admin/DAO via Change-Server-Config Tx to put the network in 'shutdown' mode */
    initShutdown: boolean
    /** Enables or disables the Lost Archiver Detection feature */
    enableLostArchiversCycles: boolean
    /** The number of consecutive cycles an Archiver has refute its appearance in the lostArchivers field before it is actually removed */
    lostArchiversCyclesToWait: number
    /** enable new logic for creating a hash of our join list */
    standbyListFastHash: boolean
    /** networkBaselineEnabled is a boolean that enables the use of the new config `baselineNodes` which is used as the new threshold for safety, recovery, and restore modes. */
    networkBaselineEnabled: boolean
    useBinarySerializedEndpoints: boolean
    useCombinedTellBinary: boolean
    /** in rotaiton mode, use this multiplier to change the amount we want to add*/
    rotationCountMultiply: number
    /** in roation mode use this value to change the amount of nodes to add, by adding this amount to the near final calculation*/
    rotationCountAdd: number
    /** not an actual percent but 0-1 value or multiplication */
    rotationPercentActive: number
    /** not an actual percent but 0-1 value or multiplication */
    rotationMaxAddPercent: number
    /** not an actual percent but 0-1 value or multiplication */
    rotationMaxRemovePercent: number
    /** The max number of nodes added to `activated` list in cycleRecord each cycle */
    allowActivePerCycle: number
    useProxyForDownCheck: boolean
    /** The number of checker nodes to ask to investigate whether a node that is potentially lost */
    numCheckerNodes: number
    /** The minimum number of down reports mark node as node as lost */
    minChecksForDown: number
    /** The minimum number of up reports to not mark node as node as lost */
    minChecksForUp: number
    /** The multiplier of how many cycles to before attempting to join the network again */
    attemptJoiningWaitMultiplier: number
    /** The number of cycles to wait for a selected node to send sync-started gossip before removing it */
    cyclesToWaitForSyncStarted: number
    /** The number of cycles before standbyListCyclesTTL a standby node should send a refresh message */
    cyclesToRefreshEarly: number
    /** we will add minNodes + this value nodes to the network in restart mode */
    extraNodesToAddInRestart: number
    /** In waitForQ1, we check every secondsToCheckForQ1 number of seconds to see if we are not in Q1 */
    secondsToCheckForQ1: number
    /** hardenNewSyncingProtocol upgrades to syncing protocol */
    hardenNewSyncingProtocol: boolean
    /** whether node should remove a lost syncing node from its syncing list */
    removeLostSyncingNodeFromList: boolean
    /** Enable binary serilization by specific endpoint */
    compareCertBinary: boolean
    makeReceiptBinary: boolean
    lostArchiverInvestigateBinary: boolean
    signAppDataBinary: boolean
    sendCachedAppDataBinary: boolean
    syncTrieHashesBinary: boolean
    getTrieHashesBinary: boolean
    getTrieAccountHashesBinary: boolean
    getAccountDataBinary: boolean
    getAccountDataByHashBinary: boolean
    getAccountDataByListBinary: boolean
    getGloablAccountReportBinary: boolean
    getCachedAppDataBinary: boolean
    getAccountQueueCountBinary: boolean
    getAccountDataWithQueueHintsBinary: boolean
    getTxTimestampBinary: boolean
    getAppliedVoteBinary: boolean
    getConfirmOrChallengeBinary: boolean
    spreadAppliedVoteHashBinary: boolean
    spreadTxToGroupSyncingBinary: boolean
    requestStateForTxBinary: boolean
    requestReceiptForTxBinary: boolean
    requestTxAndStateBinary: boolean
    requestStateForTxPostBinary: boolean
    broadcastStateBinary: boolean
    broadcastFinalStateBinary: boolean
    lostReportBinary: boolean
    repairMissingAccountsBinary: boolean
    poqoSendReceiptBinary: boolean
    poqoDataAndReceiptBinary: boolean
    poqoSendVoteBinary: boolean
    /** number of nodes on both ends of the rotationIndex
     *  that will not respond to queries like account data, inject etc
     *  is only activated when more than 10 nodes active  */
    rotationEdgeToAvoid: number
    /** mode to force network into. can be cleared.*/
    forcedMode?: string
    /** Number of seconds to wait before shutting down after discovering we are a zombie node */
    delayZombieRestartSec: number
    // /** The number of ms to wait to resubmit a standby refresh request to an active node if we get an error */
    resumbitStandbyRefreshWaitDuration: number
    // /** The number of nodes to attemp joining per cycle during forming mode */
    formingNodesPerCycle: number
    // /** Enables or disables filtering nodes from internal gossip if they are marked down. */
    downNodeFilteringEnabled: boolean
    /** Whether to use upgraded FACT corresponding tell algorithm */
    useFactCorrespondingTell: boolean
    // /** The number of ms to wait to resubmit a standby add request to an active node if we get an error */
    resubmitStandbyAddWaitDuration: number
    // /** The percentage of votes required to confirm transaction*/
    requiredVotesPercentage: number
    // /** a fix to prevent node from producing different ts for same txId */
    timestampCacheFix: boolean
    // /** The number of network transactions to try to process per cycle from txAdd in cycle record */
    networkTransactionsToProcessPerCycle: number
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
    /** periodically log report on how many sockets are opened on this system */
    logSocketReports: boolean
  }
  /** Server's current mode or environment to be run in. Can be 'release' or 'debug' with 'release' being the default. */
  mode?: ServerMode
  /** Server Debug module configuration */
  debug?: {
    /**
     * This value control whether a node check itself to be in authorized before sending out scaling request
     */
    ignoreScaleGossipSelfCheck?: boolean

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
    /** should skip patcher repair system */
    skipPatcherRepair?: boolean
    /** chance to fail a TX and the TX repair */
    failNoRepairTxChance?: number
    /** use the new stats data for partition state reports to monitor server */
    useNewParitionReport?: boolean
    /** is the old partition checking system enabled */
    oldPartitionSystem?: boolean
    /** slow old reporting that queries sql for account values */
    dumpAccountReportFromSQL?: boolean
    /** enable the built in profiling */
    profiler?: boolean
    /** starts the node in fatals mode, use endpoints to turn back on default logs */
    startInFatalsLogMode?: boolean
    /** starts the node in error mode, use endpoints to turn back on default logs */
    startInErrorLogMode?: boolean
    /** fake network delay in ms */
    fakeNetworkDelay?: number
    /** disable snapshots */
    disableSnapshots?: boolean
    /** disable txCoverage report */
    disableTxCoverageReport?: boolean
    /** disable lost node report*/
    disableLostNodeReports?: boolean
    /** Halt repair attempts when data OOS happens */
    haltOnDataOOS?: boolean
    /** start counting endpoints */
    countEndpointStart?: number
    /** stop counting endpoints */
    countEndpointStop?: number
    //** hash of our dev auth key */
    hashedDevAuth?: string
    devPublicKeys?: {
      [pubKey: string]: DevSecurityLevel
    }
    /** keys that are used for multisig operations */
    multisigKeys?: {
      [pubKey: string]: DevSecurityLevel
    }
    /** minimum approvals needed for debug endpoint access using multisig */
    minMultiSigRequiredForEndpoints: number
    /** minimum approvals needed for global txs using multisig */
    minMultiSigRequiredForGlobalTxs: number
    /** dump extra data for robust query even if in error/fatal logggin only mode */
    robustQueryDebug: boolean
    /** pretty sure we don't want this ever but making a config so we can AB test as needed */
    forwardTXToSyncingNeighbors: boolean
    /** flag to toggle recording accepted app transactions in db */
    recordAcceptedTx: boolean
    /** flag to toggle recording app account states in db */
    recordAccountStates: boolean
    /** use hints about the memory access patterns for better parallel processing */
    useShardusMemoryPatterns: boolean
    /** Clean untrusted input that endpoints receive to improve security. Config setting to AB test and judge perf it*/
    sanitizeInput: boolean
    /** test if the TX group changes sizes after an apply() */
    checkTxGroupChanges: boolean
    /** Flag to toggle startup check that makes sure system time is within acceptable range of time from NTP Server */
    ignoreTimeCheck: boolean
    /** Flag to toggle Shardus address format verification, checks if an address is 32-bytes in size & 64 chars long */
    checkAddressFormat: boolean
    /** Flag to simulate bad vote creation in PoQLS */
    produceBadVote: boolean
    /** Flag to simulate a bad challenge response */
    produceBadChallenge: boolean
    /**   add a random error to our ntp offset time +- */
    debugNTPErrorWindowMs: number
    /**  Flag to enable detail scoped profiling **/
    enableScopedProfiling: boolean
    /**  Flag to enable basic profiling **/
    enableBasicProfiling: boolean
    /**  Flag to enable writing cycle records to text file for debugging **/
    enableCycleRecordDebugTool: boolean
    /**  Flag to force a tx to expire **/
    forcedExpiration: boolean
    /** chance to ignore a request to submit a standby refresh request on behalf of a standby node */
    ignoreStandbyRefreshChance: number
    /** Flag to enable/disable enableCycleRecordTool and download files written by it **/
    localEnableCycleRecordDebugTool: boolean
    /** Flag to enable/disable integration tests **/
    enableTestMode: boolean
    /** Whether to enable high-resolution profiling */
    highResolutionProfiling: boolean
    /** Flag to enable/disbale adding random data to cycle record */
    randomCycleData: boolean
    // Maximum number of elements allowed in txDebugStatList map
    debugStatListMaxSize: number
    /** chance to ignore being told data for a certain account */
    ignoreDataTellChance: number
    // flag to add bogus increments to NTP offset
    debugNTPBogusDecrements: boolean
    /** chance to fail before state in sending tx receipt to archiver */
    beforeStateFailChance: number
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
    /**
     * The queueLimit parameter is an Integer which specifies one of the two possible limits to check whether the network is under heavy load.
     * It does this by checking it’s set value against the current transaction queue. The threshold will be equal to the number of transactions
     * in the queue / the queueLimit.
     * executeQueueLimit is similar to queueLimit but will only count transactions that will execute on this node
     */
    executeQueueLimit?: number
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
    loadLimit?: {
      internal?: number
      external?: number
      txTimeInQueue?: number
      queueLength?: number
      executeQueueLength?: number
    }
  }
  /** Server State manager module configuration */
  stateManager?: {
    /** This limit the amount size of the nonce queue to protect out of memeory attacks. */
    maxNonceQueueSize?: number
    /** The stateTableBucketSize parameter is an Integer which defines the max number of accountRecords that the p2p module will ask for in it’s get_account_state call. */
    stateTableBucketSize?: number
    /** The accountBucketSize This is also currently used as input to a p2p ask method for the max number of account records */
    accountBucketSize?: number
    /** number of accounts that the patcher can get per request */
    patcherAccountsPerRequest: number
    /** number of accounts that the patcher can get per upddate (cycle) */
    patcherAccountsPerUpdate: number
    /** number of hashes we can ask for per request (non leaf) , not enabled yet. not sure if we want or need it*/
    patcherMaxHashesPerRequest: number
    /** number of hashes we can ask for child nodes per request */
    patcherMaxLeafHashesPerRequest: number
    /** max number of child hashes that we can respond with */
    patcherMaxChildHashResponses: number
    /** max number of sync restarts allowed due to thrown exceptions before we go apop */
    maxDataSyncRestarts: number
    /** max number of sync restarts allowed due to thrown exceptions for each tracker instance */
    maxTrackerRestarts: number
    /** Use accountID for the offset command when syncing data */
    syncWithAccountOffset: boolean
    /** this will control if the account copies table functions */
    useAccountCopiesTable: boolean
    /** How long before we decide that processingn is stuck */
    stuckProcessingLimit: number
    //** auto fix stuck processing.  this is a stopgap method */
    autoUnstickProcessing: boolean
    //** auto apop with stuck processing.  this is a stopgap method */
    apopFromStuckProcessing: boolean
    //** if we have very old pending TX this allows us to discard them */
    discardVeryOldPendingTX: boolean
    //** if the apply function is stuck for two long we can bypass it, this is a bandaid fix. */
    transactionApplyTimeout: number
    //** Includes before states in the TX receipts for contract storage accounts */
    includeBeforeStatesInReceipts: boolean
    //** fixes for where we unlock fifolocks. the sync code was doing brute force clear of fifolocks that could be the cause of lockups!   */
    fifoUnlockFix: boolean
    //** alternate fix for fifo fifolocks. related to the above fix.  but this one focus on avoiding calling clearSyncData in a potential problem spot   */
    fifoUnlockFix2: boolean
    //** alternate fix for fifo fifolocks. disable all fifo lock logic.  the atomic option */
    fifoUnlockFix3: boolean
    //** enable account fetch for queue counts.  the extra fetching could cause too much latency so we want the option to control it for testing first */
    enableAccountFetchForQueueCounts: boolean
    //** the number of cycles within which we want to keep \changes to a config*/
    configChangeMaxCyclesToKeep: number
    //** the number of config changes to keep*/
    configChangeMaxChangesToKeep: number
    // how long to wait before confirming or challenging a vote
    waitTimeBeforeConfirm: number
    // max limit on how long to wait before confirming or challenge since first vote
    waitLimitAfterFirstVote: number
    // how long to wait before producing receipt from confirm/challenge
    waitTimeBeforeReceipt: number
    // max limit on how long to wait before confirming or challenge since first vote
    waitLimitAfterFirstMessage: number
    // number of unique challenges to produce a fail receipt
    minRequiredChallenges: number
    // turn on the improved Proof of Quorum for large shards sizes
    useNewPOQ: boolean
    // milliseconds to wait after receiving the receipt and before asking data
    nonExWaitForData: number
    // turn on POQo consensus
    usePOQo: boolean
    // Interval between switching to the next vote aggregator batch
    poqoloopTime: number
    // batch size for vote aggregation
    poqobatchCount: number
    // should the network forward TXs to lucky nodes?  (does not impact nonce queue, that is the flag below)
    forwardToLuckyNodes: boolean
    // should the network forward TXs to lucky nodes?  (only for the nonce queue)
    forwardToLuckyNodesNonceQueue: boolean
    // forward to multiple lucky nodes (requires other configs to forward at all)
    forwardToLuckyMulti: boolean
    // only send to lucky nodes in the case that we did not already have this item in our nonce queue
    forwardToLuckyNodesNonceQueueLimitFix: boolean
    /// check rotation bounds when forwarding to lucky nodes
    forwardToLuckyNodesCheckRotation: boolean
    // whether the node should verify its data against the network before challenging
    integrityCheckBeforeChallenge: boolean
    // Should the protocol consier a precrack failure as a failed transaction
    checkPrecrackStatus: boolean
    // extra time for tx group node when they have not seen a vote yet
    noVoteSeenExpirationTime: number
    // extra time for tx group nodes that seen a vote
    voteSeenExpirationTime: number
    // extra time for tx group nodes that seen a vote + confirmation
    confirmationSeenExpirationTime: number
    // percentage of execution group which will share the vote
    voterPercentage: number
    // whether to wait upstream tx before enqueueing
    waitUpstreamTx: boolean
    // whether the node should gossip complete data
    gossipCompleteData: boolean
    // whether the node should share the complete data to neighbors
    shareCompleteData: boolean
    // state machine chages updateTxState in several places from 'consensing' to 'await final data'
    txStateMachineChanges: boolean
    // will a node attempt to request final data
    canRequestFinalData: boolean
    // how many node to re-inject the tx received from client
    numberOfReInjectNodes: number
    // max number of pending nonce tx for an account
    maxPendingNonceTxs: number
    // should attach final data to receipt
    attachDataToReceipt: boolean
    // number of execution nodes to gossip appliedReceipt
    nodesToGossipAppliedReceipt: number
    // should we use deep copied wrapped state for apply
    useCopiedWrappedStateForApply: boolean
    // set "true" will prevent tx from expiring
    disableTxExpiration: boolean
    // whether to remove the tx from the queue if it stuck for X min
    removeStuckTxsFromQueue: boolean
    // how long to wait before removing the tx from the queue
    stuckTxRemoveTime: number
    // whether to remove the tx from the queue if it stuck for X min. Based on time since first vote seen
    removeStuckTxsFromQueue2: boolean
    // how long to wait before removing the tx from the queue. Based on time since first vote seen
    stuckTxRemoveTime2: number
    // whether to remove the tx from the queue if it stuck for X min. must be in consensing state
    removeStuckTxsFromQueue3: boolean
    // how long to wait before removing the tx from the queue. must be in consensing state
    stuckTxRemoveTime3: number
    // remove a stuck challenged tx
    removeStuckChallengedTXs: boolean
    // receipt remove fix
    receiptRemoveFix: boolean
    // fix for stuck txs in the queue
    stuckTxQueueFix: boolean
    // force vote for failed preApply
    forceVoteForFailedPreApply: boolean
    // fix for stuck txs for single account tests
    singleAccountStuckFix: boolean
    // wait time before moving stuck "consensing" tx to "await final data"
    stuckTxMoveTime: number
    // use newer collected data
    collectedDataFix: boolean
    // no repairToMatch if data is attached to receipt
    noRepairIfDataAttached: boolean
    // reject shared data if we cover it
    rejectSharedDataIfCovered: boolean
    // set if our node is allowed to request awaited data after a certain time.  See comments. not ready to enable
    requestAwaitedDataAllowed: boolean
    /** if this is true and our node still cant run the TX but the rest of the network already has a valid receipt
        then we can move to awaiting final data */
    awaitingDataCanBailOnReceipt: boolean
    // Filter receiving nodes if they cover the account already
    filterReceivingNodesForTXData: boolean
    // unwrap sender indicies when calculating corresponding tell
    correspondingTellUseUnwrapped: boolean
    // concat unwrap sender indicies when calculating corresponding tell
    concatCorrespondingTellUseUnwrapped: boolean
    // decide txGroupCycle based on the txTimestamp
    deterministicTXCycleEnabled: boolean
    // deterministic reduce time from tx timestamp (in ms)
    reduceTimeFromTxTimestamp: number
    // whether node should use current cycle if derived cycle is lager than current cycle
    fallbackToCurrentCycleFortxGroup: boolean
    // max number of recent cycle shard data to keep
    maxCyclesShardDataToKeep: number
    // make sure we send data to non-self nodes
    avoidOurIndexInFactTell: boolean
  }
  /** Options for sharding calculations */
  sharding?: {
    /** The nodesPerConsensusGroup parameter defines how many nodes will be contained within a shard */
    nodesPerConsensusGroup?: number
    /** The number of edge nodes on each side */
    nodesPerEdge?: number
    /** Sets if the execute in one shard feature is active */
    executeInOneShard?: boolean
  }
  /** Options for enabling features on the network at specific versions */
  features?: {
    /** Generic flag for the dapp to enable/disable certain features. Todo: replace this with something less hardcoded **/
    dappFeature1enabled: boolean
    /** Enabled at shardeum v1.1.3. Fixes homeNode check for TX group changes: https://gitlab.com/shardus/global/shardus-global-server/-/merge_requests/268 */
    fixHomeNodeCheckForTXGroupChanges?: boolean
    /** To enable at shardeum v1.1.3 */
    archiverDataSubscriptionsUpdate?: boolean
    startInServiceMode?: boolean
    /** This flag defaults to true. If set to true, addresses marked as ir will be fetched when tx is ageing. */
    enableRIAccountsCache: boolean
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
    seq?: string
  }
  options?: {
    appenders?: {
      out?: {
        type?: string
        maxLogSize?: number
        backups?: number
      }
      main?: {
        type?: string
        maxLogSize?: number
        backups?: number
      }
      seq?: {
        type?: string
        maxLogSize?: number
        backups?: number
      }
      app?: {
        type?: string
        maxLogSize?: number
        backups?: number
      }
      p2p?: {
        type?: string
        maxLogSize?: number
        backups?: number
      }
      snapshot?: {
        type?: string
        maxLogSize?: number
        backups?: number
      }
      cycle?: {
        type?: string
        maxLogSize?: number
        backups?: number
      }
      fatal?: {
        type?: string
        maxLogSize?: number
        backups?: number
      }
      exit?: {
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
        level?: string
        appender?: string
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
      statsDump?: {
        type?: string
        maxLogSize?: number
        backups?: number
      }
    }
    categories?: {
      default?: {
        appenders?: string[]
        level?: string
      }
      app?: {
        appenders?: string[]
        level?: string
      }
      main?: {
        appenders?: string[]
        level?: string
      }
      seq?: {
        appenders?: string[]
        level?: string
      }
      p2p?: {
        appenders?: string[]
        level?: string
      }
      snapshot?: {
        appenders?: string[]
        level?: string
      }
      cycle?: {
        appenders?: string[]
        level?: string
      }
      fatal?: {
        appenders?: string[]
        level?: string
      }
      exit?: {
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
      statsDump?: {
        appenders?: string[]
        level?: string
      }
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
    saveOldDBFiles: boolean
    walMode: boolean
    exclusiveLockMode: boolean
  }
}

export interface ShardusConfiguration {
  server?: ServerConfiguration
  logs?: LogsConfiguration
  storage?: StorageConfiguration
}

export type StrictServerConfiguration = DeepRequired<ServerConfiguration>
export type StrictLogsConfiguration = DeepRequired<LogsConfiguration>
export type StrictStorageConfiguration = DeepRequired<StorageConfiguration>

export interface StrictShardusConfiguration {
  server: StrictServerConfiguration
  logs: StrictLogsConfiguration
  storage: StrictStorageConfiguration
}

export interface AcceptedTx {
  timestamp: number
  txId: string
  keys: TransactionKeys
  data: TimestampedTx
  appData: any
  shardusMemoryPatterns: ShardusMemoryPatternsInput
}

export type ShardusMemoryPatternsInput = {
  ro: string[]
  rw: string[]
  wo: string[]
  on: string[]
  ri: string[]
}

export interface TxReceipt {
  txHash: string
  sign?: Sign
  time: number //transaction timestamp
  stateId: string //hash of the source account.  this should be phased out or modified to handle multiple sources
  targetStateId: string //hash of the target account.  this should be phased out or modified to handle multiple targets
}

type ObjectAlias = object
/**
 * OpaqueTransaction is the way shardus should see transactions internally. it should not be able to mess with parameters individually
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface OpaqueTransaction extends ObjectAlias {}

export interface ReinjectedOpaqueTransaction extends OpaqueTransaction {
  isReinjected: boolean
}

export type DeepRequired<T> = Required<{
  [P in keyof T]: T[P] extends object | undefined ? DeepRequired<Required<T[P]>> : T[P]
}>

type ShardusEventType =
  | 'node-activated'
  | 'node-deactivated'
  | 'node-left-early'
  | 'node-refuted'
  | 'node-sync-timeout'
  | 'try-network-transaction'

export type ShardusEvent = {
  type: ShardusEventType
  nodeId: string
  reason: string
  time: number //Time for 'node-activated' and 'node-deactivated' are the cycle start time in seconds, other event may use ms in the future
  publicKey: string
  cycleNumber: number
  activeCycle?: number
  additionalData?: any
}

export type GetAppDataSignaturesResult = {
  success: boolean
  signatures: Sign[]
}

//I think we may need to add failure codes to this later so we can tell track what type of signature rejections
//we are getting.
export type SignAppDataResult = {
  success: boolean
  signature: Sign
}

export interface ValidatorNodeDetails {
  ip: string
  port: number
  publicKey: string
}
