import * as Shardus from '../shardus/shardus-types'
import { StateManager as StateManagerTypes } from 'shardus-types'
import * as utils from '../utils'
const stringify = require('fast-stable-stringify')
import Profiler, { profilerInstance } from '../utils/profiler'
import { P2PModuleContext as P2P } from '../p2p/Context'
import Storage from '../storage'
import Crypto from '../crypto'
import Logger, {logFlags} from '../logger'
import ShardFunctions from './shardFunctions.js'
import { time } from 'console'
import StateManager from '.'
import { nestedCountersInstance } from '../utils/nestedCounters'
import * as NodeList from '../p2p/NodeList'

import * as Comms from '../p2p/Comms'
import * as Context from '../p2p/Context'
import * as Wrapper from '../p2p/Wrapper'
import { AccountHashCache, AccountHashCacheHistory, AccountIDAndHash, AccountPreTest, HashTrieAccountDataRequest, HashTrieAccountDataResponse, HashTrieAccountsResp, HashTrieNode, HashTrieRadixCoverage, HashTrieReq, HashTrieResp, HashTrieSyncConsensus, HashTrieSyncTell, HashTrieUpdateStats, RadixAndChildHashes, RadixAndHash, ShardedHashTrie, TrieAccount, CycleShardData } from './state-manager-types'
import { isDebugModeMiddleware } from '../network/debugMiddleware'
//import { all } from 'deepmerge'
//import { Node } from '../p2p/Types'


class AccountPatcher {
  app: Shardus.App
  crypto: Crypto
  config: Shardus.ShardusConfiguration
  profiler: Profiler

  p2p: P2P

  logger: Logger

  mainLogger: any
  fatalLogger: any
  shardLogger: any
  statsLogger: any

  statemanager_fatal: (key: string, log: string) => void
  stateManager: StateManager

  treeMaxDepth: number
  treeSyncDepth: number
  shardTrie: ShardedHashTrie


  totalAccounts: number

  accountUpdateQueue: TrieAccount[]
  accountUpdateQueueFuture: TrieAccount[]

  accountRemovalQueue: string[]

  hashTrieSyncConsensusByCycle: Map<number, HashTrieSyncConsensus>

  incompleteNodes: HashTrieNode[]

  debug_ignoreUpdates: boolean

  failedLastTrieSync: boolean
  failStartCycle: number
  failEndCycle: number
  failRepairsCounter: number
  syncFailHistory: {s:number,e:number, cycles:number, repaired:number}[]

  sendHashesToEdgeNodes: boolean

  lastCycleNonConsensusRanges: {low:string,high:string}[]

  nonStoredRanges: {low:string,high:string}[]
  radixIsStored: Map<string, boolean>

  lastRepairInfo: any

  constructor(stateManager: StateManager, profiler: Profiler, app: Shardus.App, logger: Logger, p2p: P2P, crypto: Crypto, config: Shardus.ShardusConfiguration) {
    this.crypto = crypto
    this.app = app
    this.logger = logger
    this.config = config
    this.profiler = profiler
    this.p2p = p2p

    if(logger == null){

      return // for debug
    }

    this.mainLogger = logger.getLogger('main')
    this.fatalLogger = logger.getLogger('fatal')
    this.shardLogger = logger.getLogger('shardDump')
    this.statsLogger = logger.getLogger('statsDump')
    this.statemanager_fatal = stateManager.statemanager_fatal
    this.stateManager = stateManager

    //todo these need to be dynamic
    this.treeMaxDepth = 4
    this.treeSyncDepth = 1

    this.shardTrie = {
      layerMaps: []
    }
    //init or update layer maps. (treeMaxDepth doesn't count root so +1 it)
    for(let i=0; i< this.treeMaxDepth + 1 ; i++ ){
      this.shardTrie.layerMaps.push(new Map())
    }

    this.totalAccounts = 0

    this.hashTrieSyncConsensusByCycle = new Map()

    this.incompleteNodes = []

    this.accountUpdateQueue = []
    this.accountUpdateQueueFuture = []
    this.accountRemovalQueue = []

    this.debug_ignoreUpdates = false

    this.failedLastTrieSync = false

    this.sendHashesToEdgeNodes = true

    this.lastCycleNonConsensusRanges = []
    this.nonStoredRanges = []
    this.radixIsStored = new Map()

    this.lastRepairInfo = 'none'

    this.failStartCycle = -1
    this.failEndCycle = -1
    this.failRepairsCounter = 0
    this.syncFailHistory = []
  }

  hashObj(value:any){
    //could replace with a different cheaper hash!!
    return this.crypto.hash(value)
  }
  sortByAccountID(a, b){
    if (a.accountID < b.accountID) {
      return -1;
    }
    if (a.accountID > b.accountID) {
      return 1;
    }
    return 0;
  }
  sortByRadix(a, b){
    if (a.radix < b.radix) {
      return -1;
    }
    if (a.radix > b.radix) {
      return 1;
    }
    return 0;
  }

  /***
   *    ######## ##    ## ########  ########   #######  #### ##    ## ########  ######
   *    ##       ###   ## ##     ## ##     ## ##     ##  ##  ###   ##    ##    ##    ##
   *    ##       ####  ## ##     ## ##     ## ##     ##  ##  ####  ##    ##    ##
   *    ######   ## ## ## ##     ## ########  ##     ##  ##  ## ## ##    ##     ######
   *    ##       ##  #### ##     ## ##        ##     ##  ##  ##  ####    ##          ##
   *    ##       ##   ### ##     ## ##        ##     ##  ##  ##   ###    ##    ##    ##
   *    ######## ##    ## ########  ##         #######  #### ##    ##    ##     ######
   */

  setupHandlers() {
    Comms.registerInternal('get_trie_hashes', async (payload: HashTrieReq, respond: (arg0: HashTrieResp) => any) => {
      profilerInstance.scopedProfileSectionStart('get_trie_hashes')
      let result = {nodeHashes:[]} as HashTrieResp

      for(let radix of payload.radixList){

        let level = radix.length
        let layerMap = this.shardTrie.layerMaps[level]

        let hashTrieNode = layerMap.get(radix)
        if(hashTrieNode != null){
          for(let childTreeNode of hashTrieNode.children){
            if(childTreeNode != null){
              result.nodeHashes.push({radix:childTreeNode.radix, hash:childTreeNode.hash})
            }
          }

          //result.nodeHashes.push({radix, hash:hashTrieNode.hash})
        }
      }
      await respond(result)
      profilerInstance.scopedProfileSectionEnd('get_trie_hashes')
    })


    //this should be a tell to X..  robust tell? if a node does not get enough it can just query for more.
    Comms.registerInternal('sync_trie_hashes', async (payload: HashTrieSyncTell, respondWrapped, sender, tracker) => {

      profilerInstance.scopedProfileSectionStart('sync_trie_hashes')
      try {
        //TODO use our own definition of current cycle.
        //use playlod cycle to filter out TXs..
        let cycle = payload.cycle

        let hashTrieSyncConsensus = this.hashTrieSyncConsensusByCycle.get(payload.cycle)
        if(hashTrieSyncConsensus == null){
          hashTrieSyncConsensus = {
            cycle:payload.cycle,
            radixHashVotes: new Map(),
            coverageMap: new Map()
          }
          this.hashTrieSyncConsensusByCycle.set(payload.cycle, hashTrieSyncConsensus)

          let shardValues = this.stateManager.shardValuesByCycle.get(payload.cycle)
          if (shardValues == null) {
            nestedCountersInstance.countEvent('accountPatcher', `sync_trie_hashes not ready c:${payload.cycle}`)
            return
          }

          //mark syncing radixes..
          //todo compare to cycle!! only init if from current cycle.
          this.initStoredRadixValues(payload.cycle)
        }

        const node = NodeList.nodes.get(sender)

        for(let nodeHashes of payload.nodeHashes){

          //don't record the vote if we cant use it!
          // easier than filtering it out later on in the stream.
          if(this.isRadixStored(cycle, nodeHashes.radix) === false){
            continue
          }

          //todo: secure that the voter is allowed to vote.
          let hashVote = hashTrieSyncConsensus.radixHashVotes.get(nodeHashes.radix)
          if(hashVote == null){
            hashVote = {allVotes:new Map(), bestHash:nodeHashes.hash, bestVotes:1}
            hashTrieSyncConsensus.radixHashVotes.set(nodeHashes.radix, hashVote)
            hashVote.allVotes.set(nodeHashes.hash, {count:1, voters:[node]})
          } else {
            let voteEntry = hashVote.allVotes.get(nodeHashes.hash)
            if(voteEntry == null){
              hashVote.allVotes.set(nodeHashes.hash, {count:1, voters:[node]})
            } else {
              let voteCount = voteEntry.count + 1
              voteEntry.count = voteCount
              voteEntry.voters.push(node)
              //hashVote.allVotes.set(nodeHashes.hash, votes + 1)
              //will ties be a problem? (not if we need a majority!)
              if(voteCount > hashVote.bestVotes){
                hashVote.bestVotes = voteCount
                hashVote.bestHash = nodeHashes.hash
              }
            }
          }
        }
      } finally {
        profilerInstance.scopedProfileSectionEnd('sync_trie_hashes')
      }
    })

    //get child accountHashes for radix.  //get the hashes and ids so we know what to fix.
    Comms.registerInternal('get_trie_accountHashes', async (payload: HashTrieReq, respond: (arg0: HashTrieAccountsResp) => any) => {
      profilerInstance.scopedProfileSectionStart('get_trie_hashes')
      //nodeChildHashes: {radix:string, childAccounts:{accountID:string, hash:string}[]}[]
      let result = {nodeChildHashes:[]} as HashTrieAccountsResp

      for(let radix of payload.radixList){

        let level = radix.length
        let layerMap = this.shardTrie.layerMaps[level]

        let hashTrieNode = layerMap.get(radix)
        if(hashTrieNode != null && hashTrieNode.accounts != null){
          let childAccounts = []
          result.nodeChildHashes.push({radix, childAccounts})
          for(let account of hashTrieNode.accounts){
            childAccounts.push({accountID:account.accountID, hash: account.hash})
          }
        }
      }
      await respond(result)
      profilerInstance.scopedProfileSectionEnd('get_trie_hashes')
    })

    Comms.registerInternal('get_account_data_by_hashes', async (payload: HashTrieAccountDataRequest, respond: (arg0: HashTrieAccountDataResponse) => any) => {

      profilerInstance.scopedProfileSectionStart('get_account_data_by_hashes')
      nestedCountersInstance.countEvent('accountPatcher', `get_account_data_by_hashes`)
      let result:HashTrieAccountDataResponse = {accounts:[], stateTableData:[]}
      try{

        //nodeChildHashes: {radix:string, childAccounts:{accountID:string, hash:string}[]}[]
        let queryStats = {fix1:0,fix2:0,skip_localHashMismatch:0,skip_requestHashMismatch:0, returned:0, missingResp:false, noResp:false}

        let hashMap = new Map()
        let accountIDs = []

        //should limit on asking side, this is just a precaution
        if(payload.accounts.length > 900){
          payload.accounts = payload.accounts.slice(0,900)
        }

        for(let accountHashEntry of payload.accounts){
          // let radix = accountHashEntry.accountID.substr(0, this.treeMaxDepth)
          // let layerMap = this.shardTrie.layerMaps[this.treeMaxDepth]
          // let hashTrieNode = layerMap.get(radix)
          if(accountHashEntry == null || accountHashEntry.hash == null || accountHashEntry.accountID == null){
            queryStats.fix1++
            continue
          }
          hashMap.set(accountHashEntry.accountID, accountHashEntry.hash)
          accountIDs.push(accountHashEntry.accountID)
        }

        let accountData = await this.app.getAccountDataByList(accountIDs)

        let skippedAccounts:AccountIDAndHash[] = []
        let returnedAccounts:AccountIDAndHash[] = []

        let accountsToGetStateTableDataFor = []
        //only return results that match the requested hash!
        let accountDataFinal: Shardus.WrappedData[] = []
        if (accountData != null) {
          for (let wrappedAccount of accountData) {
            if(wrappedAccount == null || wrappedAccount.stateId == null || wrappedAccount.data == null){
              queryStats.fix2++
              continue
            }

            let { accountId, stateId, data: recordData } = wrappedAccount
            let hash = this.app.calculateAccountHash(recordData)
            if (stateId !== hash) {
              skippedAccounts.push({accountID:accountId, hash:stateId})
              queryStats.skip_localHashMismatch++
              continue
            }

            if(hashMap.get(accountId) === wrappedAccount.stateId){
              accountDataFinal.push(wrappedAccount)
              returnedAccounts.push({accountID:accountId, hash:stateId})
              accountsToGetStateTableDataFor.push(accountId)
              queryStats.returned++
            } else {
              queryStats.skip_requestHashMismatch++
              skippedAccounts.push({accountID:accountId, hash:stateId})
            }

            // let wrappedAccountInQueueRef = wrappedAccount as Shardus.WrappedDataFromQueue
            // wrappedAccountInQueueRef.seenInQueue = false

            // if (this.stateManager.lastSeenAccountsMap != null) {
            //   let queueEntry = this.stateManager.lastSeenAccountsMap[wrappedAccountInQueueRef.accountId]
            //   if (queueEntry != null) {
            //     wrappedAccountInQueueRef.seenInQueue = true
            //   }
            // }
          }
        }
        //PERF could disable this for more perf?
        //this.stateManager.testAccountDataWrapped(accountDataFinal)

        if(queryStats.returned < payload.accounts.length){
          nestedCountersInstance.countEvent('accountPatcher', `get_account_data_by_hashes incomplete`)
          queryStats.missingResp = true
          if(queryStats.returned === 0){
            nestedCountersInstance.countEvent('accountPatcher', `get_account_data_by_hashes no results`)
            queryStats.noResp = true
          }
        }

        if(this.stateManager.accountSync.useStateTable === true){
          if(accountsToGetStateTableDataFor.length > 0){
            result.stateTableData = await this.stateManager.storage.queryAccountStateTableByListNewest(accountsToGetStateTableDataFor)
          }
        }

        this.mainLogger.debug(`get_account_data_by_hashes1 requests[${payload.accounts.length}] :${utils.stringifyReduce(payload.accounts)} `)
        this.mainLogger.debug(`get_account_data_by_hashes2 skippedAccounts:${utils.stringifyReduce(skippedAccounts)} `)
        this.mainLogger.debug(`get_account_data_by_hashes3 returnedAccounts:${utils.stringifyReduce(returnedAccounts)} `)
        this.mainLogger.debug(`get_account_data_by_hashes4 queryStats:${utils.stringifyReduce(queryStats)} `)
        this.mainLogger.debug(`get_account_data_by_hashes4 stateTabledata:${utils.stringifyReduce(result.stateTableData)} `)
        result.accounts = accountDataFinal

      } catch(ex){

        this.statemanager_fatal(`get_account_data_by_hashes-failed`, 'get_account_data_by_hashes:' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
      }
      await respond(result)
      profilerInstance.scopedProfileSectionEnd('get_account_data_by_hashes')
    })


    Context.network.registerExternalGet('debug-patcher-ignore-hash-updates', isDebugModeMiddleware, (req, res) => {
      try{
        this.debug_ignoreUpdates = !this.debug_ignoreUpdates
        res.write(`this.debug_ignoreUpdates: ${this.debug_ignoreUpdates}\n`)
      } catch(e){
        res.write(`${e}\n`)
      }
      res.end()
    })
    Context.network.registerExternalGet('debug-patcher-fail-tx', isDebugModeMiddleware, (req, res) => {
      try{
        //toggle chance to fail TXs in a way that they do not get fixed by the first tier of repair.

        if(this.stateManager.failNoRepairTxChance === 0){
          this.stateManager.failNoRepairTxChance = 1
        } else {
          this.stateManager.failNoRepairTxChance = 0
        }

        res.write(`this.failNoRepairTxChance: ${this.stateManager.failNoRepairTxChance}\n`)
      } catch(e){
        res.write(`${e}\n`)
      }
      res.end()
    })
    Context.network.registerExternalGet('debug-patcher-dumpTree', isDebugModeMiddleware, (req, res) => {
      try{
        this.statemanager_fatal('debug shardTrie',`temp shardTrie ${utils.stringifyReduce(this.shardTrie.layerMaps[0].values().next().value)}`)
        res.write(`${utils.stringifyReduce(this.shardTrie.layerMaps[0].values().next().value)}\n`)
      } catch(e){
        res.write(`${e}\n`)
      }
      res.end()
    })

    Context.network.registerExternalGet('get-tree-last-insync', isDebugModeMiddleware, (req, res) => {
      res.write(`${this.failedLastTrieSync === false}\n`)

      res.end()
    })

    //TODO DEBUG DO NOT USE IN LIVE NETWORK
    Context.network.registerExternalGet('get-tree-last-insync-all', isDebugModeMiddleware, async (req, res) => {
      try {
        //wow, why does Context.p2p not work..
        let oosCount = 0
        let activeNodes = Wrapper.p2p.state.getNodes()
        if (activeNodes) {
          for (let node of activeNodes.values()) {
            let getResp = await this.logger._internalHackGetWithResp(`${node.externalIp}:${node.externalPort}/get-tree-last-insync`)
            if(getResp.body && getResp.body.includes('false')){
              oosCount++
            }
            res.write(`inSync: ${getResp.body ? getResp.body.trim() : 'no data'}  ${node.externalIp}:${node.externalPort} ${getResp.body ? (getResp.body?'':' ***') : ''} \n `)
            //res.write(getResp.body ? getResp.body : 'no data')
          }
        }

        res.write(`this node in sync:${this.failedLastTrieSync === false} totalOOS:${oosCount} \n`)
      } catch (e) {
        res.write(`${e}\n`)
      }

      res.end()
    })


    Context.network.registerExternalGet('trie-repair-dump', isDebugModeMiddleware, (req, res) => {
      res.write(`${utils.stringifyReduce(this.lastRepairInfo)}\n`)
      res.end()
    })

    //
    Context.network.registerExternalGet('get-shard-dump', isDebugModeMiddleware, (req, res) => {
      res.write(`${this.stateManager.lastShardReport}\n`)
      res.end()
    })

    //TODO DEBUG DO NOT USE IN LIVE NETWORK
    Context.network.registerExternalGet('get-shard-dump-all', isDebugModeMiddleware, async (req, res) => {
      try {
        //wow, why does Context.p2p not work..
        res.write(`last shard reports \n`)
        let activeNodes = Wrapper.p2p.state.getNodes()
        if (activeNodes) {
          for (let node of activeNodes.values()) {
            let getResp = await this.logger._internalHackGetWithResp(`${node.externalIp}:${node.externalPort}/get-shard-dump`)
            res.write(`${node.externalIp}:${node.externalPort}; `)
            res.write( getResp.body ? getResp.body : '')
            res.write( '\n')
          }
        }
        //res.write(`this node in sync:${this.failedLastTrieSync} \n`)
      } catch (e) {
        res.write(`${e}\n`)
      }
      res.end()
    })

    Context.network.registerExternalGet('get-shard-report-all', isDebugModeMiddleware, async (req, res) => {
      try {
        //wow, why does Context.p2p not work..
        res.write(`building shard report \n`)
        let activeNodes = Wrapper.p2p.state.getNodes()
        let lines = []
        if (activeNodes) {
          for (let node of activeNodes.values()) {
            let getResp = await this.logger._internalHackGetWithResp(`${node.externalIp}:${node.externalPort}/get-shard-dump`)
            if(getResp.body != null && getResp.body != ''){
              lines.push({raw: getResp.body, file:{owner: `${node.externalIp}:${node.externalPort}`}})
            }
          }
          this.processShardDump(res, lines)
        }
        //res.write(`this node in sync:${this.failedLastTrieSync} \n`)
      } catch (e) {
        res.write(`${e}\n`)
      }
      res.end()
    })

    /**
     *
     *
     * Usage: http://<NODE_IP>:<NODE_EXT_PORT>/account-report?id=<accountID>
     */
    Context.network.registerExternalGet('account-report', isDebugModeMiddleware, async (req, res) => {
      if (req.query.id == null) return
      let id = req.query.id as string
      res.write(`report for: ${id} \n`)
      try {
        if(id.length === 10){
          //short form..
          let found = false
          let prefix = id.substr(0,4)
          let low = prefix + '0'.repeat(60)
          let high = prefix + 'f'.repeat(60)

          let suffix = id.substr(5,5)
          let possibleAccounts = await this.app.getAccountDataByRange(low, high, 0 , Date.now(), 100)

          res.write(`searching ${possibleAccounts.length} accounts \n`)

          for(let account of possibleAccounts ){

            if(account.accountId.endsWith(suffix)){
              res.write(`found full account ${id} => ${account.accountId} \n`)
              id = account.accountId
              found = true

              break
            }

          }

          if(found == false){
            res.write(`could not find account\n`)
            res.end()
            return
          }
        }

        let trieAccount = this.getAccountTreeInfo(id)
        let accountHash = this.stateManager.accountCache.getAccountHash(id)
        let accountHashFull = this.stateManager.accountCache.accountsHashCache3.accountHashMap.get(id)
        let accountData = await this.app.getAccountDataByList([id])

        res.write(`trieAccount: ${JSON.stringify(trieAccount)} \n`)
        res.write(`accountHash: ${JSON.stringify(accountHash)} \n`)
        res.write(`accountHashFull: ${JSON.stringify(accountHashFull)} \n`)
        res.write(`accountData: ${JSON.stringify(accountData)} \n\n`)
        res.write(`tests: \n`)
        if(accountData != null && accountData.length === 1 && accountHash != null ){
          res.write(`accountData hash matches cache ${accountData[0].stateId === accountHash.h } \n`)
        }
        if(accountData != null && accountData.length === 1 && trieAccount != null ){
          res.write(`accountData matches trieAccount ${accountData[0].stateId === trieAccount.hash } \n`)
        }

      } catch (e) {
        res.write(`${e}\n`)
      }
      res.end()
    })


  }


  getAccountTreeInfo(accountID:string) : TrieAccount {

    let radix = accountID.substr(0, this.treeMaxDepth)

    let treeNode = this.shardTrie.layerMaps[this.treeMaxDepth].get(radix)
    if(treeNode == null || treeNode.accountTempMap == null){
      return null
    }
    return treeNode.accountTempMap.get(accountID)
  }



  /***
   *    ##     ## ########     ###    ######## ########  ######  ##     ##    ###    ########  ########  ######## ########  #### ########
   *    ##     ## ##     ##   ## ##      ##    ##       ##    ## ##     ##   ## ##   ##     ## ##     ##    ##    ##     ##  ##  ##
   *    ##     ## ##     ##  ##   ##     ##    ##       ##       ##     ##  ##   ##  ##     ## ##     ##    ##    ##     ##  ##  ##
   *    ##     ## ########  ##     ##    ##    ######    ######  ######### ##     ## ########  ##     ##    ##    ########   ##  ######
   *    ##     ## ##        #########    ##    ##             ## ##     ## ######### ##   ##   ##     ##    ##    ##   ##    ##  ##
   *    ##     ## ##        ##     ##    ##    ##       ##    ## ##     ## ##     ## ##    ##  ##     ##    ##    ##    ##   ##  ##
   *     #######  ##        ##     ##    ##    ########  ######  ##     ## ##     ## ##     ## ########     ##    ##     ## #### ########
   */

  upateShardTrie(cycle:number) : HashTrieUpdateStats {

    //we start with the later of nodes at max depth, and will build upwards one layer at a time
    let currentLayer = this.treeMaxDepth
    let treeNodeQueue: HashTrieNode[] = []

    let updateStats = {
      leafsUpdated: 0,
      leafsCreated: 0,
      updatedNodesPerLevel: new Array(this.treeMaxDepth+1).fill(0),
      hashedChildrenPerLevel: new Array(this.treeMaxDepth+1).fill(0),
      totalHashes: 0,
      //totalObjectsHashed: 0,
      totalNodesHashed: 0,
      totalAccountsHashed: 0,
      totalLeafs: 0,
    }

    //feed account data into lowest layer, generates list of treeNodes
    let currentMap = this.shardTrie.layerMaps[currentLayer]
    if(currentMap == null){
      currentMap = new Map()
      this.shardTrie.layerMaps[currentLayer] = currentMap
    }

    //process accounts that need updating.  Create nodes as needed
    for(let i =0; i< this.accountUpdateQueue.length; i++){
      let tx = this.accountUpdateQueue[i]
      let key = tx.accountID.slice(0,currentLayer)
      let treeNode = currentMap.get(key)
      if(treeNode == null){
        //init a leaf node.
        //leaf nodes will have a list of accounts that share the same radix.
        treeNode = {radix:key, children:[], childHashes:[], accounts:[], hash:'', accountTempMap:new Map(), updated:true, isIncomplete: false, nonSparseChildCount:0} //this map will cause issues with update
        currentMap.set(key, treeNode)
        updateStats.leafsCreated++
        treeNodeQueue.push(treeNode)
      }

      //this can happen if the depth gets smaller after being larger
      if(treeNode.accountTempMap == null){
        treeNode.accountTempMap = new Map()
      }
      if(treeNode.accounts == null){
        treeNode.accounts = []
      }

      if(treeNode.accountTempMap.has(tx.accountID) === false){
        this.totalAccounts++
      }
      treeNode.accountTempMap.set(tx.accountID, tx)
      if(treeNode.updated === false){
        treeNodeQueue.push(treeNode)
        updateStats.leafsUpdated++

      }
      treeNode.updated= true
    }

    let removedAccounts = 0
    let removedAccountsFailed = 0

    if(this.accountRemovalQueue.length > 0){
      //this.statemanager_fatal(`temp accountRemovalQueue`,`accountRemovalQueue c:${cycle} ${utils.stringifyReduce(this.accountRemovalQueue)}`)
      if (logFlags.verbose) this.mainLogger.debug(`remove account from trie tracking c:${cycle} ${utils.stringifyReduce(this.accountRemovalQueue)}`)
    }

    //remove accoutns from the trie.  this happens if our node no longer carries them in storage range.
    for(let i =0; i< this.accountRemovalQueue.length; i++){
      let accountID = this.accountRemovalQueue[i]

      let key = accountID.slice(0,currentLayer)
      let treeNode = currentMap.get(key)
      if(treeNode == null){
        continue //already gone!
      }

      if(treeNode.updated === false){
        treeNodeQueue.push(treeNode)
      }
      treeNode.updated = true

      if(treeNode.accountTempMap == null){
        treeNode.accountTempMap = new Map()
      }
      if(treeNode.accounts == null){
        treeNode.accounts = []
      }
      let removed = treeNode.accountTempMap.delete(accountID)
      if(removed){
        removedAccounts++
      } else {
        removedAccountsFailed++
      }
    }
    if(removedAccounts > 0 ){
      nestedCountersInstance.countEvent(`accountPatcher`, `removedAccounts c:${cycle}`, removedAccounts)
    }
    if(removedAccountsFailed > 0 ){
      nestedCountersInstance.countEvent(`accountPatcher`, `removedAccountsFailed c:${cycle}`, removedAccountsFailed)
    }
    this.accountRemovalQueue = []

    // for(let treeNode of this.incompleteNodes){
    //   treeNodeQueue.push(treeNode)
    // }

    //look at updated leaf nodes.  Sort accounts and update hash values
    for(let i =0; i< treeNodeQueue.length; i++){
      let treeNode = treeNodeQueue[i]

      if( treeNode.updated === true  ){ //treeNode.accountTempMap != null){
        treeNode.accounts = Array.from(treeNode.accountTempMap.values())

        //delete treeNode.accountTempMap ... keeping it for now.
        //sort treeNode.accounts by accountID
        treeNode.accounts.sort(this.sortByAccountID)
        //compute treenode hash of accounts
        treeNode.hash = this.hashObj(treeNode.accounts.map(a=>a.hash))   //todo why is this needed!!!

        treeNode.updated = false

        updateStats.totalHashes++
        updateStats.totalAccountsHashed = updateStats.totalAccountsHashed + treeNode.accounts.length
        updateStats.updatedNodesPerLevel[currentLayer] = updateStats.updatedNodesPerLevel[currentLayer] + 1
      }

    }

    // update the tree one later at a time. start at the max depth and copy values to the parents.
    // Then the parent depth becomes the working depth and we repeat the process
    // a queue is used to efficiently update only the nodes that need it.
    // hashes are efficiently calculated only once after all children have set their hash data in the childHashes
    let parentTreeNodeQueue = []
    //treenode queue has updated treeNodes from each loop, gets fed into next loop
    for(let i = currentLayer-1; i >= 0; i--){
      currentMap = this.shardTrie.layerMaps[i]
      if(currentMap == null){
        currentMap = new Map()
        this.shardTrie.layerMaps[i] = currentMap
      }
      //loop each node in treeNodeQueue (nodes from the previous level down)
      for(let j = 0; j<treeNodeQueue.length; j++){
        let treeNode = treeNodeQueue[j]

        //compute parent nodes.
        let parentKey = treeNode.radix.slice(0, i)
        // fast? 0-15 conversion
        let index = treeNode.radix.charCodeAt(i)
        index = (index < 90)? index - 48: index -87
        //get parent node
        let parentTreeNode = currentMap.get(parentKey)
        if(parentTreeNode == null){
          parentTreeNode = {radix:parentKey, children:new Array(16), childHashes:new Array(16), updated:false, hash:'', isIncomplete: false, nonSparseChildCount:0}
          currentMap.set(parentKey, parentTreeNode)

        }

        //if we have not set this child yet then count it
        if(parentTreeNode.children[index] == null){
          parentTreeNode.nonSparseChildCount++
        }

        parentTreeNode.children[index] = treeNode //assign position
        parentTreeNode.childHashes[index] = treeNode.hash

        //insert new parent nodes if we have not yet, guided by updated flag
        if(parentTreeNode.updated === false ){
          parentTreeNodeQueue.push(parentTreeNode)
          parentTreeNode.updated = true
        }

        if(treeNode.isIncomplete){
          // if(parentTreeNode.isIncomplete === false && parentTreeNode.updated === false ){
          //   parentTreeNode.updated = true
          //   parentTreeNodeQueue.push(parentTreeNode)
          // }
          parentTreeNode.isIncomplete = true
        }

        treeNode.updated = false //finished update of this node.
      }

      updateStats.updatedNodesPerLevel[i] = parentTreeNodeQueue.length

      //when we are one step below the sync depth add in incompete parents for hash updates!
      // if(i === this.treeSyncDepth + 1){
      //   for(let treeNode of this.incompleteNodes){
      //     parentTreeNodeQueue.push(treeNode)
      //   }
      // }

      //loop and compute hashes of parents
      for(let j = 0; j<parentTreeNodeQueue.length; j++){
        let parentTreeNode = parentTreeNodeQueue[j]
        parentTreeNode.hash = this.hashObj(parentTreeNode.childHashes)

        updateStats.totalHashes++
        updateStats.totalNodesHashed = updateStats.totalNodesHashed + parentTreeNode.nonSparseChildCount
        updateStats.hashedChildrenPerLevel[i] = updateStats.hashedChildrenPerLevel[i] + parentTreeNode.nonSparseChildCount
      }
      //set the parents to the treeNodeQueue so we can loop and work on the next layer up
      treeNodeQueue = parentTreeNodeQueue
      parentTreeNodeQueue = []
    }

    updateStats.totalLeafs = this.shardTrie.layerMaps[this.treeMaxDepth].size


    this.accountUpdateQueue = []

    return updateStats
  }

  getNonConsensusRanges(cycle:number): {low:string,high:string}[] {

    let incompleteRanges = []

    //get the min and max non covered area
    let shardValues = this.stateManager.shardValuesByCycle.get(cycle)

    let consensusStartPartition = shardValues.nodeShardData.consensusStartPartition
    let consensusEndPartition = shardValues.nodeShardData.consensusEndPartition

    incompleteRanges = this.getNonParitionRanges(shardValues, consensusStartPartition, consensusEndPartition, this.treeSyncDepth)

    return incompleteRanges
  }

  getNonStoredRanges(cycle:number): {low:string,high:string}[] {

    let incompleteRanges = []

    //get the min and max non covered area
    let shardValues = this.stateManager.shardValuesByCycle.get(cycle)
    if (shardValues) {
      let consensusStartPartition = shardValues.nodeShardData.storedPartitions.partitionStart
      let consensusEndPartition = shardValues.nodeShardData.storedPartitions.partitionEnd

      incompleteRanges = this.getNonParitionRanges(shardValues, consensusStartPartition, consensusEndPartition, this.treeSyncDepth)
    }

    return incompleteRanges
  }

  getSyncTrackerRanges(): {low:string,high:string}[]{
    let incompleteRanges = []

    for(let syncTracker of this.stateManager.accountSync.syncTrackers){
      if(syncTracker.syncFinished === false && syncTracker.isGlobalSyncTracker === false){
        incompleteRanges.push({low:syncTracker.range.low.substr(0,this.treeSyncDepth), high:syncTracker.range.high.substr(0,this.treeSyncDepth)})
      }
    }
    return incompleteRanges
  }

  /**
   * Uses a wrappable start and end partition range as input and figures out the array
   *  of ranges that would not be covered by these partitions.
   *
   * TODO!  consider if the offset used in "partition space" should really be happening on the result address instead!
   *        I think that would be more correct.  getConsensusSnapshotPartitions would need adjustments after this since it
   *        is making this compensation on its own.
   *
   * @param shardValues
   * @param startPartition
   * @param endPartition
   * @param depth How many characters long should the high/low return values be? usually treeSyncDepth
   */
  getNonParitionRanges(shardValues: CycleShardData, startPartition: number, endPartition: number, depth: number): {low:string,high:string}[]{
    let incompleteRanges = []

    let shardGlobals = shardValues.shardGlobals as StateManagerTypes.shardFunctionTypes.ShardGlobals
    let numPartitions = shardGlobals.numPartitions

    if(startPartition === 0 && endPartition === numPartitions - 1){
      //nothing to mark incomplete our node covers the whole range with its consensus
      return incompleteRanges
    }

    //let incompeteAddresses = []
    if(startPartition > endPartition){
      //consensus range like this  <CCCC---------CCC>
      //incompletePartition:            1       2

      //we may have two ranges to mark
      let incompletePartition1 = endPartition + 1 // get the start of this
      let incompletePartition2 = startPartition - 1 //get the end of this

      let partition1 = shardValues.parititionShardDataMap.get(incompletePartition1)
      let partition2 = shardValues.parititionShardDataMap.get(incompletePartition2)

      let incompleteRange = {
        low:partition1.homeRange.low.substr(0,depth),
        high:partition2.homeRange.high.substr(0,depth)
      }
      incompleteRanges.push(incompleteRange)
      return incompleteRanges

    } else if(endPartition > startPartition) {
      //consensus range like this  <-----CCCCC------> or <-----------CCCCC> or <CCCCC----------->
      //incompletePartition:            1     2           2         1                2         1
      //   not needed:                                    x                                    x

      //we may have two ranges to mark
      let incompletePartition1 = startPartition - 1 //get the end of this
      let incompletePartition2 = endPartition + 1 // get the start of this

      //<CCCCC----------->
      //      2         1
      if(startPartition === 0){
        // = numPartitions - 1 //special case, we stil want the start
        incompletePartition1 = numPartitions - 1

        let partition1 = shardValues.parititionShardDataMap.get(incompletePartition2)
        let partition2 = shardValues.parititionShardDataMap.get(incompletePartition1)

        let incompleteRange = {
          low:partition1.homeRange.low.substr(0,depth),
          high:partition2.homeRange.high.substr(0,depth)
        }
        incompleteRanges.push(incompleteRange)
        return incompleteRanges
      }
      //<-----------CCCCC>
      // 2         1
      if(endPartition === numPartitions - 1){
        //incompletePartition2 = 0 //special case, we stil want the start
        incompletePartition2 = 0

        let partition1 = shardValues.parititionShardDataMap.get(incompletePartition2)
        let partition2 = shardValues.parititionShardDataMap.get(incompletePartition1)

        let incompleteRange = {
          low:partition1.homeRange.low.substr(0,depth),
          high:partition2.homeRange.high.substr(0,depth)
        }
        incompleteRanges.push(incompleteRange)
        return incompleteRanges
      }

      //<-----CCCCC------>
      // 0   1     2    n-1
      let partition1 = shardValues.parititionShardDataMap.get(0)
      let partition2 = shardValues.parititionShardDataMap.get(incompletePartition1)
      let incompleteRange = {
        low:partition1.homeRange.low.substr(0,depth),
        high:partition2.homeRange.high.substr(0,depth)
      }

      let partition1b = shardValues.parititionShardDataMap.get(incompletePartition2)
      let partition2b = shardValues.parititionShardDataMap.get(numPartitions - 1)
      let incompleteRangeB= {
        low:partition1b.homeRange.low.substr(0,depth),
        high:partition2b.homeRange.high.substr(0,depth)
      }

      incompleteRanges.push(incompleteRange)
      incompleteRanges.push(incompleteRangeB)
      return incompleteRanges
    }

  }

  initStoredRadixValues(cycle){

    // //mark these here , call this where we first create the vote structure for the cycle (could be two locations)
    // nonStoredRanges: {low:string,high:string}[]
    // radixIsStored: Map<string, boolean>

    this.nonStoredRanges = this.getNonStoredRanges(cycle)
    this.radixIsStored.clear()
  }

  isRadixStored(cycle:number, radix:string){

    if(this.radixIsStored.has(radix)){
      return this.radixIsStored.get(radix)
    }

    let isNotStored = false
    for(let range of this.nonStoredRanges){
      if(radix >= range.low && radix <= range.high){
        isNotStored = true
        continue
      }
    }
    let isStored = !isNotStored
    this.radixIsStored.set(radix, isStored)
    return isStored
  }

  /***
   *    ########  #### ######## ########  ######   #######  ##    ##  ######  ######## ##    ## ##     ##  ######
   *    ##     ##  ##  ##       ##       ##    ## ##     ## ###   ## ##    ## ##       ###   ## ##     ## ##    ##
   *    ##     ##  ##  ##       ##       ##       ##     ## ####  ## ##       ##       ####  ## ##     ## ##
   *    ##     ##  ##  ######   ######   ##       ##     ## ## ## ##  ######  ######   ## ## ## ##     ##  ######
   *    ##     ##  ##  ##       ##       ##       ##     ## ##  ####       ## ##       ##  #### ##     ##       ##
   *    ##     ##  ##  ##       ##       ##    ## ##     ## ##   ### ##    ## ##       ##   ### ##     ## ##    ##
   *    ########  #### ##       ##        ######   #######  ##    ##  ######  ######## ##    ##  #######   ######
   */


  /**
   * diffConsenus
   * get a list where mapB does not have entries that match consensusArray.
   * Note this only works one way.  we do not find cases where mapB has an entry that consensusArray does not.
   *  //   (TODO, compute this and at least start logging it.(if in debug mode))
   * @param consensusArray the list of radix and hash values that have been voted on by the majority
   * @param mapB a map of our hashTrie nodes to compare to the consensus
   */
  diffConsenus(consensusArray:RadixAndHash[], mapB: Map<string, HashTrieNode>) : {radix:string, hash:string}[] {

    if(consensusArray == null){
      this.statemanager_fatal('diffConsenus: consensusArray == null', 'diffConsenus: consensusArray == null')
      return []
    }

    //map
    let toFix = []
    for(let value of consensusArray){
      if(mapB == null){
        toFix.push(value)
        continue
      }

      let valueB =  mapB.get(value.radix)
      if(valueB == null){
        //missing
        toFix.push(value)
        continue
      }
      if(valueB.hash !== value.hash){
        //different hash
        toFix.push(value)
      }
    }
    return toFix
  }

  /***
   *     ######   #######  ##     ## ########  ##     ## ######## ########  ######   #######  ##     ## ######## ########     ###     ######   ########
   *    ##    ## ##     ## ###   ### ##     ## ##     ##    ##    ##       ##    ## ##     ## ##     ## ##       ##     ##   ## ##   ##    ##  ##
   *    ##       ##     ## #### #### ##     ## ##     ##    ##    ##       ##       ##     ## ##     ## ##       ##     ##  ##   ##  ##        ##
   *    ##       ##     ## ## ### ## ########  ##     ##    ##    ######   ##       ##     ## ##     ## ######   ########  ##     ## ##   #### ######
   *    ##       ##     ## ##     ## ##        ##     ##    ##    ##       ##       ##     ##  ##   ##  ##       ##   ##   ######### ##    ##  ##
   *    ##    ## ##     ## ##     ## ##        ##     ##    ##    ##       ##    ## ##     ##   ## ##   ##       ##    ##  ##     ## ##    ##  ##
   *     ######   #######  ##     ## ##         #######     ##    ########  ######   #######     ###    ######## ##     ## ##     ##  ######   ########
   */
  /**
   * computeCoverage
   *
   * Take a look at the winning votes and build of lists of which nodes we can ask for information
   * this happens once per cycle then getNodeForQuery() can be used to cleanly figure out what node to ask for a query given
   * a certain radix value.
   *
   * @param cycle
   */
  computeCoverage(cycle:number){
    let hashTrieSyncConsensus = this.hashTrieSyncConsensusByCycle.get(cycle)

    let coverageMap:Map<string, HashTrieRadixCoverage> = new Map() //map of sync radix to n

    hashTrieSyncConsensus.coverageMap = coverageMap

    //let nodeUsage = new Map()
    for(let radixHash of hashTrieSyncConsensus.radixHashVotes.keys() ){
      let coverage = coverageMap.get(radixHash)
      if(coverage == null){
        let votes = hashTrieSyncConsensus.radixHashVotes.get(radixHash)
        let bestVote = votes.allVotes.get(votes.bestHash)
        let potentialNodes = bestVote.voters
        //shuffle array of potential helpers
        //utils.shuffleArray(potentialNodes) //leaving non random to catch issues in testing.
        let node = potentialNodes[0]
        coverageMap.set(radixHash, {firstChoice:node, fullList: potentialNodes, refuted:new Set()})
        //let count = nodeUsage.get(node.id)
      }
    }


    //todo a pass to use as few nodes as possible

    //todo this new list can be acced with fn and give bakup nods/
    //  have fallback optoins
  }


  /***
   *     ######   ######## ######## ##    ##  #######  ########  ######## ########  #######  ########   #######  ##     ## ######## ########  ##    ##
   *    ##    ##  ##          ##    ###   ## ##     ## ##     ## ##       ##       ##     ## ##     ## ##     ## ##     ## ##       ##     ##  ##  ##
   *    ##        ##          ##    ####  ## ##     ## ##     ## ##       ##       ##     ## ##     ## ##     ## ##     ## ##       ##     ##   ####
   *    ##   #### ######      ##    ## ## ## ##     ## ##     ## ######   ######   ##     ## ########  ##     ## ##     ## ######   ########     ##
   *    ##    ##  ##          ##    ##  #### ##     ## ##     ## ##       ##       ##     ## ##   ##   ##  ## ## ##     ## ##       ##   ##      ##
   *    ##    ##  ##          ##    ##   ### ##     ## ##     ## ##       ##       ##     ## ##    ##  ##    ##  ##     ## ##       ##    ##     ##
   *     ######   ########    ##    ##    ##  #######  ########  ######## ##        #######  ##     ##  ##### ##  #######  ######## ##     ##    ##
   */
  //error handling.. what if we cand find a node or run out?
  /**
   * getNodeForQuery
   * Figure out what node we can ask for a query related to the given radix.
   * this will node that has given us a winning vote for the given radix
   * @param radix
   * @param cycle
   * @param nextNode pass true to start asking the next node in the list for data.
   */
  getNodeForQuery(radix:string, cycle:number, nextNode:boolean = false){
    let hashTrieSyncConsensus = this.hashTrieSyncConsensusByCycle.get(cycle)
    let parentRadix = radix.substr(0, this.treeSyncDepth)

    let coverageEntry = hashTrieSyncConsensus.coverageMap.get(parentRadix)

    if(coverageEntry == null || coverageEntry.firstChoice == null){
      this.fatalLogger(`getNodeForQuery null ${coverageEntry == null} ${coverageEntry?.firstChoice == null}`,`getNodeForQuery null ${coverageEntry == null} ${coverageEntry?.firstChoice == null}`)
    }

    if(nextNode === true){
      coverageEntry.refuted.add(coverageEntry.firstChoice.id)
      for(let i=0; i<coverageEntry.fullList.length; i++){
        let node = coverageEntry.fullList[i]
        if(node == null || coverageEntry.refuted.has(node.id)){
          continue
        }
        coverageEntry.firstChoice = node
        return coverageEntry.firstChoice
      }

    } else {
      return coverageEntry.firstChoice
    }
    return null
  }

  /**
   * getChildrenOf
   * ask nodes for the child node information of the given list of radix values
   * TODO convert to allSettled?, but support a timeout?
   * @param radixHashEntries
   * @param cycle
   */
  async getChildrenOf(radixHashEntries:RadixAndHash[], cycle:number) : Promise<RadixAndHash[]> {
    let result:HashTrieResp
    let nodeHashes: RadixAndHash[] = []
    let requestMap:Map<Shardus.Node, HashTrieReq> = new Map()
    for(let radixHash of radixHashEntries ){
      let node = this.getNodeForQuery(radixHash.radix, cycle)
      let existingRequest = requestMap.get(node)
      if(existingRequest == null){
        existingRequest = {radixList:[]}
        requestMap.set(node, existingRequest)
      }
      if(node == null){
        this.statemanager_fatal('getChildrenOf node null', 'getChildrenOf node null')
        continue
      }
      existingRequest.radixList.push(radixHash.radix)
    }
    // for(let [key, value] of requestMap){
    //   try{
    //     result = await this.p2p.ask(key, 'get_trie_hashes', value)
    //     if(result != null && result.nodeHashes != null){
    //       nodeHashes = nodeHashes.concat(result.nodeHashes)
    //     } //else retry?
    //   } catch (error) {
    //     this.statemanager_fatal('getChildrenOf failed', `getChildrenOf failed: ` + error.name + ': ' + error.message + ' at ' + error.stack)
    //   }
    // }

    let promises = []
    for(let [key, value] of requestMap){
      try{
        let promise = this.p2p.ask(key, 'get_trie_hashes', value)
        promises.push(promise)
      } catch (error) {
        this.statemanager_fatal('getChildrenOf failed', `getChildrenOf failed: ` + error.name + ': ' + error.message + ' at ' + error.stack)
      }
    }

    try{
      //TODO should we convert to Promise.allSettled?
      let results = await Promise.all(promises)
      for(let result of results){
        if(result != null && result.nodeHashes != null){
          nodeHashes = nodeHashes.concat(result.nodeHashes)
        }
      }
    } catch (error) {
      this.statemanager_fatal('getChildrenOf failed', `getChildrenOf failed: ` + error.name + ': ' + error.message + ' at ' + error.stack)
    }

    if(nodeHashes.length > 0){
      nestedCountersInstance.countEvent(`accountPatcher`, `got nodeHashes`, nodeHashes.length)
    }

    return nodeHashes
  }

  /**
   * getChildAccountHashes
   * requests account hashes from one or more nodes.
   * TODO convert to allSettled?, but support a timeout?
   * @param radixHashEntries
   * @param cycle
   */
  async getChildAccountHashes(radixHashEntries:RadixAndHash[], cycle:number) : Promise<RadixAndChildHashes[]> {
    let result:HashTrieAccountsResp
    let nodeChildHashes: RadixAndChildHashes[] = []
    let allHashes: AccountIDAndHash[] = []
    let requestMap:Map<Shardus.Node, HashTrieReq> = new Map()
    for(let radixHash of radixHashEntries ){
      let node = this.getNodeForQuery(radixHash.radix, cycle)
      let existingRequest = requestMap.get(node)
      if(existingRequest == null){
        existingRequest = {radixList:[]}
        requestMap.set(node, existingRequest)
      }
      if(node == null){
        this.statemanager_fatal('getChildAccountHashes node null', 'getChildAccountHashes node null ')
        continue
      }
      existingRequest.radixList.push(radixHash.radix)
    }
    // for(let [key, value] of requestMap){
    //   try{
    //     result = await this.p2p.ask(key, 'get_trie_accountHashes', value)
    //     if(result != null && result.nodeChildHashes != null){
    //       nodeChildHashes = nodeChildHashes.concat(result.nodeChildHashes)
    //       // for(let childHashes of result.nodeChildHashes){
    //       //   allHashes = allHashes.concat(childHashes.childAccounts)
    //       // }
    //     } //else retry?
    //   } catch (error) {
    //     this.statemanager_fatal('getChildAccountHashes failed', `getChildAccountHashes failed: ` + error.name + ': ' + error.message + ' at ' + error.stack)

    //   }
    // }


    let promises = []
    for(let [key, value] of requestMap){
      try{
        let promise = this.p2p.ask(key, 'get_trie_accountHashes', value)
        promises.push(promise)
      } catch (error) {
        this.statemanager_fatal('getChildAccountHashes failed', `getChildAccountHashes failed: ` + error.name + ': ' + error.message + ' at ' + error.stack)
      }
    }

    try{
      //TODO should we convert to Promise.allSettled?
      let results = await Promise.all(promises)
      for(let result of results){
        if(result != null && result.nodeChildHashes != null){
          nodeChildHashes = nodeChildHashes.concat(result.nodeChildHashes)
          // for(let childHashes of result.nodeChildHashes){
          //   allHashes = allHashes.concat(childHashes.childAccounts)
          // }
        }
      }
    } catch (error) {
      this.statemanager_fatal('getChildAccountHashes failed', `getChildAccountHashes failed: ` + error.name + ': ' + error.message + ' at ' + error.stack)
    }

    if(nodeChildHashes.length > 0){
      nestedCountersInstance.countEvent(`accountPatcher`, `got nodeChildHashes`, nodeChildHashes.length)
    }

    return nodeChildHashes
  }

  /***
   *    ####  ######  #### ##    ##  ######  ##    ## ##    ##  ######
   *     ##  ##    ##  ##  ###   ## ##    ##  ##  ##  ###   ## ##    ##
   *     ##  ##        ##  ####  ## ##         ####   ####  ## ##
   *     ##   ######   ##  ## ## ##  ######     ##    ## ## ## ##
   *     ##        ##  ##  ##  ####       ##    ##    ##  #### ##
   *     ##  ##    ##  ##  ##   ### ##    ##    ##    ##   ### ##    ##
   *    ####  ######  #### ##    ##  ######     ##    ##    ##  ######
   */
  /**
   * isInSync
   *
   * looks at sync level hashes to figure out if any are out of matching.
   * there are cases where this is false but we dig into accounts an realize we do not
   * or can't yet repair something.
   *
   * @param cycle
   */
  isInSync(cycle){
    let hashTrieSyncConsensus = this.hashTrieSyncConsensusByCycle.get(cycle)

    if(hashTrieSyncConsensus == null){
      return true
    }

    // let nonStoredRanges = this.getNonStoredRanges(cycle)
    // let hasNonStorageRange = false
    // let oosRadix = []
    // get our list of covered radix values for cycle X!!!
    // let inSync = true

    for(let radix of hashTrieSyncConsensus.radixHashVotes.keys()){
      let votesMap = hashTrieSyncConsensus.radixHashVotes.get(radix)
      let ourTrieNode = this.shardTrie.layerMaps[this.treeSyncDepth].get(radix)

      //if we dont have the node we may have missed an account completely!
      if(ourTrieNode == null){
        return false
      }

      // hasNonStorageRange = false
      // //does our stored or consensus data actualy cover this range?
      // for(let range of nonStoredRanges){
      //   if(radix >= range.low && radix <= range.high){
      //     hasNonStorageRange = true
      //     continue
      //   }
      // }
      // if(hasNonStorageRange){
      //   //we dont store the full data needed by this radix so we cant repair it
      //   continue
      // }

      //TODO should not have to re compute this here!!
      ourTrieNode.hash = this.crypto.hash(ourTrieNode.childHashes)

      if(ourTrieNode.hash != votesMap.bestHash){
        //inSync = false
        //oosRadix.push()
        return false
      }
    }
    //todo what about situation where we do not have enough votes??
    //todo?? more utility / get list of oos radix
    return true// {inSync, }
  }


  /***
   *    ######## #### ##    ## ########  ########     ###    ########     ###     ######   ######   #######  ##     ## ##    ## ########  ######
   *    ##        ##  ###   ## ##     ## ##     ##   ## ##   ##     ##   ## ##   ##    ## ##    ## ##     ## ##     ## ###   ##    ##    ##    ##
   *    ##        ##  ####  ## ##     ## ##     ##  ##   ##  ##     ##  ##   ##  ##       ##       ##     ## ##     ## ####  ##    ##    ##
   *    ######    ##  ## ## ## ##     ## ########  ##     ## ##     ## ##     ## ##       ##       ##     ## ##     ## ## ## ##    ##     ######
   *    ##        ##  ##  #### ##     ## ##     ## ######### ##     ## ######### ##       ##       ##     ## ##     ## ##  ####    ##          ##
   *    ##        ##  ##   ### ##     ## ##     ## ##     ## ##     ## ##     ## ##    ## ##    ## ##     ## ##     ## ##   ###    ##    ##    ##
   *    ##       #### ##    ## ########  ########  ##     ## ########  ##     ##  ######   ######   #######   #######  ##    ##    ##     ######
   */
  /**
   * findBadAccounts
   *
   * starts at the sync level hashes that dont match and queries for child nodes to get more details about
   * what accounts could possibly be bad.  At the lowest level gets a list of accounts and hashes
   * We double check out cache values before returning a list of bad accounts that need repairs.
   *
   * @param cycle
   */
  async findBadAccounts(cycle:number){
    let badAccounts:AccountIDAndHash[] = []
    let hashesPerLevel = Array(this.treeMaxDepth+1).fill(0)
    let checkedKeysPerLevel = Array(this.treeMaxDepth)
    let badHashesPerLevel = Array(this.treeMaxDepth+1).fill(0)
    let requestedKeysPerLevel = Array(this.treeMaxDepth+1).fill(0)

    let level = this.treeSyncDepth
    let badLayerMap = this.shardTrie.layerMaps[level]
    let syncTrackerRanges = this.getSyncTrackerRanges()

    let stats = {
      testedSyncRadix: 0,
      skippedSyncRadix : 0,
      badSyncRadix: 0,
      ok_noTrieAcc : 0,
      ok_trieHashBad: 0,
      fixLastSeen: 0,
      needsVotes: 0,
    }

    let minVotes = this.stateManager.currentCycleShardData.shardGlobals.consensusRadius
    minVotes = Math.min(minVotes, this.stateManager.currentCycleShardData.activeNodes.length - 1)
    minVotes = Math.max(1, minVotes)

    let goodVotes:RadixAndHash[] = []
    let hashTrieSyncConsensus = this.hashTrieSyncConsensusByCycle.get(cycle)
    for(let radix of hashTrieSyncConsensus.radixHashVotes.keys()){
      let votesMap = hashTrieSyncConsensus.radixHashVotes.get(radix)
      let isSyncingRadix = false

      if(votesMap.bestVotes < minVotes){
        stats.needsVotes++
        continue
      }

      //do we need to filter out a vote?
      for(let range of syncTrackerRanges){
        if(radix >= range.low && radix <= range.high){
          isSyncingRadix = true
          break
        }
      }
      if(isSyncingRadix === true){
        stats.skippedSyncRadix++
        continue
      }
      stats.testedSyncRadix++
      goodVotes.push({radix, hash: votesMap.bestHash})
    }

    let toFix = this.diffConsenus(goodVotes, badLayerMap)

    stats.badSyncRadix = toFix.length

    if(logFlags.debug){
      toFix.sort(this.sortByRadix)
      this.statemanager_fatal('debug findBadAccounts',`debug findBadAccounts ${cycle}: ${utils.stringifyReduce(toFix)}`)
    }

    //record some debug info
    badHashesPerLevel[level] = toFix.length
    checkedKeysPerLevel[level] = toFix.map(x => x.radix)
    requestedKeysPerLevel[level] = goodVotes.length
    hashesPerLevel[level] = goodVotes.length

    this.computeCoverage(cycle)

    //refine our query until we get to the lowest level
    while(level < this.treeMaxDepth && toFix.length > 0){
      level++
      badLayerMap = this.shardTrie.layerMaps[level]
      let childrenToDiff = await this.getChildrenOf(toFix, cycle)

      toFix = this.diffConsenus(childrenToDiff, badLayerMap)
      //record some debug info
      badHashesPerLevel[level] = toFix.length
      checkedKeysPerLevel[level] = toFix.map(x => x.radix)
      requestedKeysPerLevel[level] = childrenToDiff.length
      hashesPerLevel[level] = childrenToDiff.length // badLayerMap.size ...badLayerMap could be null!
    }

    //get bad accounts
    let radixAndChildHashes = await this.getChildAccountHashes(toFix, cycle)

    let accountHashesChecked = 0
    for(let radixAndChildHash of radixAndChildHashes){
      accountHashesChecked += radixAndChildHash.childAccounts.length

      let badTreeNode = badLayerMap.get(radixAndChildHash.radix)
      if(badTreeNode != null){
        let accMap = new Map()
        if(badTreeNode.accounts != null){
          for(let i=0; i<badTreeNode.accounts.length; i++ ){
            accMap.set(badTreeNode.accounts[i].accountID,badTreeNode.accounts[i])
          }
        }
        for(let i=0; i<radixAndChildHash.childAccounts.length; i++ ){
          let potentalGoodAcc = radixAndChildHash.childAccounts[i]
          let potentalBadAcc = accMap.get(potentalGoodAcc.accountID)

          //check if our cache value has matching hash already.  The trie can lag behind.
          //  todo would be nice to find a way to reduce this, possibly by better control of syncing ranges.
          //   (we are not supposed to test syncing ranges , but maybe that is out of phase?)
          let accountMemData: AccountHashCache = this.stateManager.accountCache.getAccountHash(potentalGoodAcc.accountID)
          if(accountMemData != null && accountMemData.h === potentalGoodAcc.hash){
            if(potentalBadAcc != null){
              if(potentalBadAcc.hash != potentalGoodAcc.hash){
                stats.ok_trieHashBad++
              }
            } else {
              stats.ok_noTrieAcc++
            }

            //this was in cache, but stale so we can reinstate the cache since it still matches the group consensus
            let accountHashCacheHistory: AccountHashCacheHistory = this.stateManager.accountCache.accountsHashCache3.accountHashMap.get(potentalGoodAcc.accountID)
            if(accountHashCacheHistory != null && accountHashCacheHistory.lastStaleCycle >= accountHashCacheHistory.lastSeenCycle ){
              stats.fixLastSeen++
              accountHashCacheHistory.lastSeenCycle = cycle
            }
            continue
          }

          //is the account missing or wrong hash?
          if(potentalBadAcc != null){
            if(potentalBadAcc.hash != potentalGoodAcc.hash){
              badAccounts.push(potentalGoodAcc)
            }
          } else {
            badAccounts.push(potentalGoodAcc)
          }
        }
      } else {
        badAccounts = badAccounts.concat(radixAndChildHash.childAccounts)
      }
    }
    return {badAccounts, hashesPerLevel, checkedKeysPerLevel, requestedKeysPerLevel, badHashesPerLevel, accountHashesChecked, stats}
  }

  //big todo .. be able to test changes on a temp tree and validate the hashed before we commit updates
  //also need to actually update the full account data and not just our tree!!

  /***
   *    ##     ## ########  ########     ###    ######## ########    ###     ######   ######   #######  ##     ## ##    ## ######## ##     ##    ###     ######  ##     ##
   *    ##     ## ##     ## ##     ##   ## ##      ##    ##         ## ##   ##    ## ##    ## ##     ## ##     ## ###   ##    ##    ##     ##   ## ##   ##    ## ##     ##
   *    ##     ## ##     ## ##     ##  ##   ##     ##    ##        ##   ##  ##       ##       ##     ## ##     ## ####  ##    ##    ##     ##  ##   ##  ##       ##     ##
   *    ##     ## ########  ##     ## ##     ##    ##    ######   ##     ## ##       ##       ##     ## ##     ## ## ## ##    ##    ######### ##     ##  ######  #########
   *    ##     ## ##        ##     ## #########    ##    ##       ######### ##       ##       ##     ## ##     ## ##  ####    ##    ##     ## #########       ## ##     ##
   *    ##     ## ##        ##     ## ##     ##    ##    ##       ##     ## ##    ## ##    ## ##     ## ##     ## ##   ###    ##    ##     ## ##     ## ##    ## ##     ##
   *     #######  ##        ########  ##     ##    ##    ######## ##     ##  ######   ######   #######   #######  ##    ##    ##    ##     ## ##     ##  ######  ##     ##
   */
  /**
   * updateAccountHash
   * This is the main function called externally to tell the hash trie what the hash value is for a given accountID
   *
   * @param accountID
   * @param hash
   *
   */
  updateAccountHash(accountID:string, hash:string){

    //todo do we need to look at cycle or timestamp and have a future vs. next queue?
    if(this.debug_ignoreUpdates){
      this.statemanager_fatal( `patcher ignored: tx`, `patcher ignored: ${accountID} hash:${hash}`)
      return
    }

    let accountData = {accountID, hash}
    this.accountUpdateQueue.push(accountData)
  }


  removeAccountHash(accountID:string){

    this.accountRemovalQueue.push(accountID)
  }
  // applyRepair(accountsToFix:AccountIDAndHash[]){
  //   //todo do we need to look at cycle or timestamp and have a future vs. next queue?
  //   for(let account of accountsToFix){
  //     //need proper tx injestion.
  //     //this.txCommit(node, account)
  //     this.updateAccountHash(account.accountID, account.hash)
  //   }
  // }


  //test if radix is covered by our node.. that is tricky...
  //need isincomplete logic integrated with trie generation.
  //will be 1 or 2 values only

  // type HashTrieSyncTell = {
  //   cycle: number
  //   nodeHashes: {radix:string, hash:string}[]
  // }


  /***
   *    ########  ########   #######     ###    ########   ######     ###     ######  ########  ######  ##    ## ##    ##  ######  ##     ##    ###     ######  ##     ## ########  ######
   *    ##     ## ##     ## ##     ##   ## ##   ##     ## ##    ##   ## ##   ##    ##    ##    ##    ##  ##  ##  ###   ## ##    ## ##     ##   ## ##   ##    ## ##     ## ##       ##    ##
   *    ##     ## ##     ## ##     ##  ##   ##  ##     ## ##        ##   ##  ##          ##    ##         ####   ####  ## ##       ##     ##  ##   ##  ##       ##     ## ##       ##
   *    ########  ########  ##     ## ##     ## ##     ## ##       ##     ##  ######     ##     ######     ##    ## ## ## ##       ######### ##     ##  ######  ######### ######    ######
   *    ##     ## ##   ##   ##     ## ######### ##     ## ##       #########       ##    ##          ##    ##    ##  #### ##       ##     ## #########       ## ##     ## ##             ##
   *    ##     ## ##    ##  ##     ## ##     ## ##     ## ##    ## ##     ## ##    ##    ##    ##    ##    ##    ##   ### ##    ## ##     ## ##     ## ##    ## ##     ## ##       ##    ##
   *    ########  ##     ##  #######  ##     ## ########   ######  ##     ##  ######     ##     ######     ##    ##    ##  ######  ##     ## ##     ##  ######  ##     ## ########  ######
   */
  /**
   * broadcastSyncHashes
   * after each tree computation we figure out what radix + hash values we can send out
   * these will be nodes at the treeSyncDepth (which is higher up than our leafs, and is efficient, but also adjusts to support sharding)
   * there are important conditions about when we can send a value for a given radix and who we can send it to.
   *
   * @param cycle
   */
  async broadcastSyncHashes(cycle){
    let syncLayer = this.shardTrie.layerMaps[this.treeSyncDepth]

    let shardGlobals = this.stateManager.currentCycleShardData.shardGlobals

    let messageToNodeMap:Map<string, {node: Shardus.Node, message: HashTrieSyncTell}> = new Map()

    let radixUsed: Map<string, Set<string>> = new Map()

    let nonConsensusRanges = this.getNonConsensusRanges(cycle)
    let nonStoredRanges = this.getNonStoredRanges(cycle)
    let syncTrackerRanges = this.getSyncTrackerRanges()
    let hasNonConsensusRange = false
    let lastCycleNonConsensus = false
    let hasNonStorageRange = false
    let inSyncTrackerRange = false

    let stats = {
      broadcastSkip:0
    }
    for(let treeNode of syncLayer.values()){

      hasNonConsensusRange = false
      lastCycleNonConsensus = false
      hasNonStorageRange = false
      inSyncTrackerRange = false

      //There are several conditions below when we do not qualify to send out a hash for a given radix.
      //In general we send hashes for nodes that are fully covered in our consensus range.
      //Due to network shifting if we were consenus last cycle but still fully stored range we can send a hash.
      //Syncing operation will prevent us from sending a hash (because in theory we dont have complete account data)

      for(let range of this.lastCycleNonConsensusRanges){
        if(treeNode.radix >= range.low && treeNode.radix <= range.high){
          lastCycleNonConsensus = true
        }
      }
      for(let range of nonStoredRanges){
        if(treeNode.radix >= range.low && treeNode.radix <= range.high){
          hasNonStorageRange = true
        }
      }
      for(let range of nonConsensusRanges){
        if(treeNode.radix >= range.low && treeNode.radix <= range.high){
          hasNonConsensusRange = true
        }
      }

      //do we need to adjust what cycle we are looking at for syncing?
      for(let range of syncTrackerRanges){
        if(treeNode.radix >= range.low && treeNode.radix <= range.high){
          inSyncTrackerRange = true

        }
      }
      if(inSyncTrackerRange){
        stats.broadcastSkip++
        continue
      }

      if(hasNonConsensusRange){
        if(lastCycleNonConsensus === false && hasNonStorageRange === false){
          //we can share this data, may be a pain for nodes to verify..
          //todo include last cycle syncing..
        } else{
          //we cant send this data
          continue
        }
      }

      //figure out who to send a hash to
      //build up a map of messages
      let partitionRange = ShardFunctions.getPartitionRangeFromRadix(shardGlobals, treeNode.radix)
      for(let i=partitionRange.low; i<=partitionRange.high; i++){
        let shardInfo = this.stateManager.currentCycleShardData.parititionShardDataMap.get(i)

        let sendToMap = shardInfo.coveredBy
        if(this.sendHashesToEdgeNodes){
          sendToMap = shardInfo.storedBy
        }

        for(let [key, value] of Object.entries(sendToMap)){
          let messagePair = messageToNodeMap.get(value.id)
          if(messagePair == null){
            messagePair = {node: value, message: {cycle, nodeHashes: []}}
            messageToNodeMap.set(value.id, messagePair)
          }
          // todo done send duplicate node hashes to the same node?

          let radixSeenSet = radixUsed.get(value.id)
          if(radixSeenSet == null){
            radixSeenSet = new Set()
            radixUsed.set(value.id, radixSeenSet)
          }
          if(radixSeenSet.has(treeNode.radix) === false){
            //extra safety step! todo remove for perf.
            treeNode.hash = this.hashObj(treeNode.childHashes)
            messagePair.message.nodeHashes.push({radix:treeNode.radix, hash: treeNode.hash})
            radixSeenSet.add(treeNode.radix)
          }
        }
      }
    }

    if(stats.broadcastSkip > 0){
      nestedCountersInstance.countEvent(`accountPatcher`, `broadcast skip syncing`, stats.broadcastSkip)
    }

    //send the messages we have built up.  (parallel waiting with promise.all)
    let promises = []
    for(let messageEntry of messageToNodeMap.values()){
      let promise = this.p2p.tell([messageEntry.node], 'sync_trie_hashes', messageEntry.message)
      promises.push(promise)
    }
    await Promise.all(promises)
  }



  /***
   *    ##     ## ########  ########     ###    ######## ######## ######## ########  #### ########    ###    ##    ## ########  ########  ########   #######     ###    ########   ######     ###     ######  ########
   *    ##     ## ##     ## ##     ##   ## ##      ##    ##          ##    ##     ##  ##  ##         ## ##   ###   ## ##     ## ##     ## ##     ## ##     ##   ## ##   ##     ## ##    ##   ## ##   ##    ##    ##
   *    ##     ## ##     ## ##     ##  ##   ##     ##    ##          ##    ##     ##  ##  ##        ##   ##  ####  ## ##     ## ##     ## ##     ## ##     ##  ##   ##  ##     ## ##        ##   ##  ##          ##
   *    ##     ## ########  ##     ## ##     ##    ##    ######      ##    ########   ##  ######   ##     ## ## ## ## ##     ## ########  ########  ##     ## ##     ## ##     ## ##       ##     ##  ######     ##
   *    ##     ## ##        ##     ## #########    ##    ##          ##    ##   ##    ##  ##       ######### ##  #### ##     ## ##     ## ##   ##   ##     ## ######### ##     ## ##       #########       ##    ##
   *    ##     ## ##        ##     ## ##     ##    ##    ##          ##    ##    ##   ##  ##       ##     ## ##   ### ##     ## ##     ## ##    ##  ##     ## ##     ## ##     ## ##    ## ##     ## ##    ##    ##
   *     #######  ##        ########  ##     ##    ##    ########    ##    ##     ## #### ######## ##     ## ##    ## ########  ########  ##     ##  #######  ##     ## ########   ######  ##     ##  ######     ##
   */
  /**
   * updateTrieAndBroadCast
   * calculates what our tree leaf(max) depth and sync depths are.
   *   if there is a change we have to do some partition work to send old leaf data to new leafs.
   * Then calls upateShardTrie() and broadcastSyncHashes()
   *
   * @param cycle
   */
  async updateTrieAndBroadCast(cycle){

    //calculate sync levels!!
    let shardValues = this.stateManager.shardValuesByCycle.get(cycle)
    let shardGlobals = shardValues.shardGlobals as StateManagerTypes.shardFunctionTypes.ShardGlobals

    let minHashesPerRange = 4
    // y = floor(log16((minHashesPerRange * max(1, x/consensusRange   ))))
    let syncDepthRaw = Math.log(minHashesPerRange * Math.max(1, shardGlobals.numPartitions / (shardGlobals.consensusRadius * 2 + 1))) / Math.log(16)
    syncDepthRaw = Math.max(1, syncDepthRaw) // at least 1
    let newSyncDepth = Math.ceil(syncDepthRaw)

    //This only happens when the depth of our tree change (based on num nodes above)
    //We have to partition the leaf node data into leafs of the correct level and rebuild the tree
    if(this.treeSyncDepth != newSyncDepth){ //todo add this in to prevent size flipflop..(better: some deadspace)  && newSyncDepth > this.treeSyncDepth){
      let resizeStats = {
        nodesWithAccounts:0,
        nodesWithoutAccounts:0
      }
      let newMaxDepth = newSyncDepth + 3  //todo the "+3" should be based on total number of stored accounts pre node (in a consensed way, needs to be on cycle chain)
      //add more maps if needed  (+1 because we have a map level 0)
      while(this.shardTrie.layerMaps.length < newMaxDepth + 1){
        this.shardTrie.layerMaps.push(new Map())
      }

      //detach all accounts.
      let currentLeafMap = this.shardTrie.layerMaps[this.treeMaxDepth]

      //put all accounts into queue to rebuild Tree!
      for(let treeNode of currentLeafMap.values()){
        if(treeNode.accounts != null){
          for(let account of treeNode.accounts){
            //this.updateAccountHash(account.accountID, account.hash)

            //need to unshift these, becasue they could be older than what is alread in the queue!!
            this.accountUpdateQueue.unshift(account)
          }
          // //clear out leaf node only properties:
          // treeNode.accounts = null
          // treeNode.accountTempMap = null

          // //have to init these nodes to work as parents
          // treeNode.children = Array(16)
          // treeNode.childHashes = Array(16)

          //nestedCountersInstance.countEvent(`accountPatcher`, `updateTrieAndBroadCast: ok account list?`)
          resizeStats.nodesWithAccounts++
        } else{
          //nestedCountersInstance.countEvent(`accountPatcher`, `updateTrieAndBroadCast: null account list?`)
          resizeStats.nodesWithoutAccounts++
        }
      }

      //better to just wipe out old parent nodes!
      for(let idx = 0; idx < newMaxDepth; idx++ ) {
        this.shardTrie.layerMaps[idx].clear()
      }

      if(newMaxDepth < this.treeMaxDepth){
        //cant get here, but consider deleting layers out of the map
        nestedCountersInstance.countEvent(`accountPatcher`, `max depth decrease oldMaxDepth:${this.treeMaxDepth} maxDepth :${newMaxDepth} stats:${utils.stringifyReduce(resizeStats)}`)
      } else {
        nestedCountersInstance.countEvent(`accountPatcher`, `max depth increase oldMaxDepth:${this.treeMaxDepth} maxDepth :${newMaxDepth} stats:${utils.stringifyReduce(resizeStats)}`)
      }

      this.treeSyncDepth = newSyncDepth
      this.treeMaxDepth =  newMaxDepth

    }

    nestedCountersInstance.countEvent(`accountPatcher`, ` syncDepth:${this.treeSyncDepth} maxDepth :${this.treeMaxDepth}`)

    let updateStats = this.upateShardTrie(cycle)

    nestedCountersInstance.countEvent(`accountPatcher`, `totalAccountsHashed`, updateStats.totalAccountsHashed)

    //broadcast sync
    await this.broadcastSyncHashes(cycle)
  }

  /***
   *    ######## ########  ######  ########    ###    ##    ## ########  ########     ###    ########  ######  ##     ##    ###     ######   ######   #######  ##     ## ##    ## ########  ######
   *       ##    ##       ##    ##    ##      ## ##   ###   ## ##     ## ##     ##   ## ##      ##    ##    ## ##     ##   ## ##   ##    ## ##    ## ##     ## ##     ## ###   ##    ##    ##    ##
   *       ##    ##       ##          ##     ##   ##  ####  ## ##     ## ##     ##  ##   ##     ##    ##       ##     ##  ##   ##  ##       ##       ##     ## ##     ## ####  ##    ##    ##
   *       ##    ######    ######     ##    ##     ## ## ## ## ##     ## ########  ##     ##    ##    ##       ######### ##     ## ##       ##       ##     ## ##     ## ## ## ##    ##     ######
   *       ##    ##             ##    ##    ######### ##  #### ##     ## ##        #########    ##    ##       ##     ## ######### ##       ##       ##     ## ##     ## ##  ####    ##          ##
   *       ##    ##       ##    ##    ##    ##     ## ##   ### ##     ## ##        ##     ##    ##    ##    ## ##     ## ##     ## ##    ## ##    ## ##     ## ##     ## ##   ###    ##    ##    ##
   *       ##    ########  ######     ##    ##     ## ##    ## ########  ##        ##     ##    ##     ######  ##     ## ##     ##  ######   ######   #######   #######  ##    ##    ##     ######
   */
  /**
   * testAndPatchAccounts
   * does a quick check to see if we are isInSync() with the sync level votes we have been given.
   * if we are out of sync it uses findBadAccounts to recursively find what accounts need repair.
   * we then query nodes for the account data we need to do a repair with
   * finally we check the repair data and use it to repair out accounts.
   *
   * @param cycle
   */
  async testAndPatchAccounts(cycle){
    // let updateStats = this.upateShardTrie(cycle)
    // nestedCountersInstance.countEvent(`accountPatcher`, `totalAccountsHashed`, updateStats.totalAccountsHashed)

    let lastFail = this.failedLastTrieSync

    this.failedLastTrieSync = false

    let trieRepairDump = {
      cycle,
      stats:null,
      z_accountSummary: null}

    if(logFlags.debug){
      let hashTrieSyncConsensus = this.hashTrieSyncConsensusByCycle.get(cycle)
      let debug = []
      if (hashTrieSyncConsensus && hashTrieSyncConsensus.radixHashVotes) {
        for(let [key,value] of hashTrieSyncConsensus.radixHashVotes){
          debug.push({radix:key , hash: value.bestHash, votes: value.bestVotes})
        }
      }
      debug.sort(this.sortByRadix)
      this.statemanager_fatal('debug shardTrie',`temp shardTrie votes c:${cycle}: ${utils.stringifyReduce(debug)}`)
    }

    if(this.isInSync(cycle) === false){
      let failHistoryObject
      if(lastFail === false){
        this.failStartCycle = cycle
        this.failEndCycle = -1
        this.failRepairsCounter = 0
        failHistoryObject = {s:this.failStartCycle, e:this.failEndCycle, cycles: 1, repaired: this.failRepairsCounter}
        this.syncFailHistory.push(failHistoryObject)
      } else {
        failHistoryObject = this.syncFailHistory[this.syncFailHistory.length -1]
      }


      let results = await this.findBadAccounts(cycle)
      nestedCountersInstance.countEvent(`accountPatcher`, `badAccounts c:${cycle} `, results.badAccounts.length)
      nestedCountersInstance.countEvent(`accountPatcher`, `accountHashesChecked c:${cycle}`, results.accountHashesChecked)

      this.stateManager.cycleDebugNotes.badAccounts = results.badAccounts.length //per cycle debug info
      //TODO figure out if the possible repairs will fully repair a given hash for a radix.
      // This could add some security but my concern is that it could create a situation where something unexpected prevents
      // repairing some of the data.
      let preTestResults = this.simulateRepairs(cycle, results.badAccounts )

      //request data for the list of bad accounts then update.
      let {wrappedDataList, stateTableDataMap, stats:getAccountStats} = await this.getAccountRepairData(cycle, results.badAccounts )

      //we need filter our list of possible account data to use for corrections.
      //it is possible the majority voters could send us account data that is older than what we have.
      //todo must sort out if we can go backwards...  (I had dropped some pre validation earlier, but need to rethink that)
      let wrappedDataListFiltered:Shardus.WrappedData[] = []
      let noChange = new Set()
      let updateTooOld = new Set()
      let filterStats = {
        accepted:0,
        tooOld:0,
        sameTS:0,
        sameTSFix:0,
      }

      // build a list of data that is good to use in this repair operation
      // Also, there is a section where cache accountHashCacheHistory.lastSeenCycle may get repaired.
      for(let wrappedData of wrappedDataList){
        if (this.stateManager.accountCache.hasAccount(wrappedData.accountId)) {
          let accountMemData: AccountHashCache = this.stateManager.accountCache.getAccountHash(wrappedData.accountId)
          // dont allow an older timestamp to overwrite a newer copy of data we have.
          // we may need to do more work to make sure this can not cause an un repairable situation
          if (wrappedData.timestamp < accountMemData.t) {
            updateTooOld.add(wrappedData.accountId)
            // nestedCountersInstance.countEvent('accountPatcher', `checkAndSetAccountData updateTooOld c:${cycle}`)
            this.statemanager_fatal('checkAndSetAccountData updateTooOld',`checkAndSetAccountData updateTooOld ${cycle}: acc:${utils.stringifyReduce(wrappedData.accountId)} updateTS:${wrappedData.timestamp} updateHash:${utils.stringifyReduce(wrappedData.stateId)}  cacheTS:${accountMemData.t} cacheHash:${utils.stringifyReduce(accountMemData.h)}`)
            filterStats.tooOld++
            continue
          }
          //This is less likely to be hit here now that similar logic checking the hash happens upstream in findBadAccounts()
          if(wrappedData.timestamp === accountMemData.t) {
            // if we got here make sure to update the last seen cycle in case the cache needs to know it has current enough data
            let accountHashCacheHistory: AccountHashCacheHistory = this.stateManager.accountCache.accountsHashCache3.accountHashMap.get(wrappedData.accountId)
            if(accountHashCacheHistory != null && accountHashCacheHistory.lastStaleCycle >= accountHashCacheHistory.lastSeenCycle ){
              // nestedCountersInstance.countEvent('accountPatcher', `checkAndSetAccountData updateSameTS update lastSeenCycle c:${cycle}`)
              filterStats.sameTSFix++
              accountHashCacheHistory.lastSeenCycle = cycle
            }

            noChange.add(wrappedData.accountId)
            // nestedCountersInstance.countEvent('accountPatcher', `checkAndSetAccountData updateSameTS c:${cycle}`)
            filterStats.sameTS++
            continue
          }
          filterStats.accepted++
          //we can proceed with the update
          wrappedDataListFiltered.push(wrappedData)
        } else {
          filterStats.accepted++
          //this good account data to repair with
          wrappedDataListFiltered.push(wrappedData)
        }
      }

      let updatedAccounts:string[] = []
      //save the account data.  note this will make sure account hashes match the wrappers and return failed hashes  that dont match
      let failedHashes = await this.stateManager.checkAndSetAccountData(wrappedDataListFiltered, `testAndPatchAccounts`, true, updatedAccounts)

      if(failedHashes.length != 0){
        nestedCountersInstance.countEvent('accountPatcher', 'checkAndSetAccountData failed hashes', failedHashes.length)
        this.statemanager_fatal('isInSync = false, failed hashes',`isInSync = false cycle:${cycle}:  failed hashes:${failedHashes.length}`)
      }
      let appliedFixes = Math.max(0,wrappedDataListFiltered.length - failedHashes.length)
      nestedCountersInstance.countEvent('accountPatcher', 'writeCombinedAccountDataToBackups', Math.max(0,wrappedDataListFiltered.length - failedHashes.length))
      nestedCountersInstance.countEvent('accountPatcher', `p.repair applied c:${cycle} bad:${results.badAccounts.length} received:${wrappedDataList.length} failedH: ${failedHashes.length} filtered:${utils.stringifyReduce(filterStats)} stats:${utils.stringifyReduce(results.stats)} getAccountStats: ${utils.stringifyReduce(getAccountStats)}`, appliedFixes)

      this.stateManager.cycleDebugNotes.patchedAccounts = appliedFixes //per cycle debug info

      let logLimit = 3000000
      if(logFlags.verbose === false){
        logLimit = 2000
      }

      let repairedAccountSummary = utils.stringifyReduceLimit(wrappedDataListFiltered.map((account) => { return {a:account.accountId, h:account.stateId } } ), logLimit)
      this.statemanager_fatal('isInSync = false',`bad accounts cycle:${cycle} bad:${results.badAccounts.length} received:${wrappedDataList.length} failedH: ${failedHashes.length} filtered:${utils.stringifyReduce(filterStats)} stats:${utils.stringifyReduce(results.stats)} getAccountStats: ${utils.stringifyReduce(getAccountStats)} details: ${utils.stringifyReduceLimit(results.badAccounts, logLimit)}`)
      this.statemanager_fatal('isInSync = false',`isInSync = false ${cycle}: fixed:${appliedFixes}  repaired: ${repairedAccountSummary}`)

      trieRepairDump.stats = {badAcc:results.badAccounts.length,received:wrappedDataList.length, filterStats, getAccountStats, findBadAccountStats: results.stats }

      trieRepairDump.z_accountSummary = repairedAccountSummary
      //This extracts accounts that have failed hashes but I forgot writeCombinedAccountDataToBackups does that already
      //let failedHashesSet = new Set(failedHashes)
      // let wrappedDataUpdated = []
      // for(let wrappedData of wrappedDataListFiltered){
      //   if(failedHashesSet.has(wrappedData.accountId )){
      //     continue
      //   }
      //   wrappedDataUpdated.push(wrappedData)
      // }

      let combinedAccountStateData:Shardus.StateTableObject[] = []
      let updatedSet = new Set()
      for(let updated of updatedAccounts){
        updatedSet.add(updated)
      }
      for(let wrappedData of wrappedDataListFiltered){
        if(updatedSet.has(wrappedData.accountId )){

          let stateTableData = stateTableDataMap.get(wrappedData.stateId)
          if(stateTableData != null){
            combinedAccountStateData.push(stateTableData)
          }
        }
      }
      if(combinedAccountStateData.length > 0){
        await this.stateManager.storage.addAccountStates(combinedAccountStateData)
        nestedCountersInstance.countEvent('accountPatcher', `p.repair stateTable c:${cycle} acc:#${updatedAccounts.length} st#:${combinedAccountStateData.length} missed#${combinedAccountStateData.length-updatedAccounts.length}`, combinedAccountStateData.length)
      }

      if(wrappedDataListFiltered.length > 0){
        await this.stateManager.writeCombinedAccountDataToBackups(wrappedDataListFiltered, failedHashes)
      }

      //apply repair account data and update shard trie

      // get list of accounts that were fixed. (should happen for free by account cache system)
      // for(let wrappedData of wrappedDataList){
      //   if(failedHashesSet.has(wrappedData.accountId) === false){

      //     //need good way to update trie..  just insert and let it happen next round!
      //     this.updateAccountHash(wrappedData.accountId, wrappedData.stateId)
      //   }
      // }
      //check again if we are in sync

      this.lastRepairInfo = trieRepairDump

      //update the repair count
      failHistoryObject.repaired += appliedFixes

      //This is something that can be checked with debug endpoints get-tree-last-insync-all / get-tree-last-insync
      this.failedLastTrieSync = true
    } else {
      nestedCountersInstance.countEvent(`accountPatcher`, `inSync`)

      if(lastFail === true){
        let failHistoryObject = this.syncFailHistory[this.syncFailHistory.length -1]
        this.failEndCycle = cycle
        failHistoryObject.e = this.failEndCycle
        failHistoryObject.cycles = this.failEndCycle - this.failStartCycle

        nestedCountersInstance.countEvent(`accountPatcher`, `inSync again. ${JSON.stringify(this.syncFailHistory[this.syncFailHistory.length -1])}`)

        //this is not really a fatal log so should be removed eventually. is is somewhat usefull context though when debugging.
        this.statemanager_fatal(`inSync again`,  JSON.stringify(this.syncFailHistory))
      }


    }

  }

  /**
   * simulateRepairs
   * incomplete.  the idea was to see if potential repairs can even solve our current sync issue.
   * not sure this is worth the perf/complexity/effort.
   *
   * if we miss something, the patcher can just try again next cycle.
   *
   * @param cycle
   * @param badAccounts
   */
  simulateRepairs(cycle:number, badAccounts:AccountIDAndHash[] ) : AccountPreTest[] {
    let results = []

    for(let badAccount of badAccounts){

      let preTestResult = {
        accountID:badAccount.accountID,
        hash:badAccount.hash,
        preTestStatus: 1 /*PreTestStatus.Valid*/
      }
      results.push(preTestResult)

      //todo run test that can change the pretestStatus value!
    }
    return results
  }




  /***
   *     ######   ######## ########    ###     ######   ######   #######  ##     ## ##    ## ######## ########  ######## ########     ###    #### ########  ########     ###    ########    ###
   *    ##    ##  ##          ##      ## ##   ##    ## ##    ## ##     ## ##     ## ###   ##    ##    ##     ## ##       ##     ##   ## ##    ##  ##     ## ##     ##   ## ##      ##      ## ##
   *    ##        ##          ##     ##   ##  ##       ##       ##     ## ##     ## ####  ##    ##    ##     ## ##       ##     ##  ##   ##   ##  ##     ## ##     ##  ##   ##     ##     ##   ##
   *    ##   #### ######      ##    ##     ## ##       ##       ##     ## ##     ## ## ## ##    ##    ########  ######   ########  ##     ##  ##  ########  ##     ## ##     ##    ##    ##     ##
   *    ##    ##  ##          ##    ######### ##       ##       ##     ## ##     ## ##  ####    ##    ##   ##   ##       ##        #########  ##  ##   ##   ##     ## #########    ##    #########
   *    ##    ##  ##          ##    ##     ## ##    ## ##    ## ##     ## ##     ## ##   ###    ##    ##    ##  ##       ##        ##     ##  ##  ##    ##  ##     ## ##     ##    ##    ##     ##
   *     ######   ########    ##    ##     ##  ######   ######   #######   #######  ##    ##    ##    ##     ## ######## ##        ##     ## #### ##     ## ########  ##     ##    ##    ##     ##
   */
  //todo test the tree to see if repairs will work.   not simple to do efficiently
  //todo robust query the hashes?  technically if we repair to bad data it will just get detected and fixed again!!!

  /**
   * getAccountRepairData
   * take a list of bad accounts and figures out which nodes we can ask to get the data.
   * makes one or more data requests in parallel
   * organizes and returns the results.
   * @param cycle
   * @param badAccounts
   */
  async getAccountRepairData(cycle:number, badAccounts:AccountIDAndHash[] ): Promise<{wrappedDataList:Shardus.WrappedData[], stateTableDataMap:Map<string, Shardus.StateTableObject>, stats:any}> {
    //pick which nodes to ask! /    //build up requests
    let nodesBySyncRadix:Map<string, {node:Shardus.Node, request:{cycle, accounts:AccountIDAndHash[]} }> = new Map()
    let accountHashMap = new Map()

    let stats= {
      skipping:0,
      multiRequests:0,
      requested:0,
      //alreadyOKHash:0
    }

    for(let accountEntry of badAccounts){
      let syncRadix = accountEntry.accountID.substr(0, this.treeSyncDepth)
      let requestEntry = nodesBySyncRadix.get(syncRadix)

      // let accountMemData: AccountHashCache = this.stateManager.accountCache.getAccountHash(accountEntry.accountID)
      // if(accountMemData != null && accountMemData.h === accountEntry.hash){
      //   stats.alreadyOKHash++
      //   continue
      // }

      accountHashMap.set(accountEntry.accountID, accountEntry.hash)
      if(requestEntry == null){
        //minor layer of security, we will ask a different node for the account than the one that gave us the hash
        let nodeToAsk = this.getNodeForQuery(accountEntry.accountID, cycle, true)
        if(nodeToAsk == null){
          this.statemanager_fatal('getAccountRepairData no node avail',`getAccountRepairData no node avail ${cycle}`)
          continue
        }
        requestEntry = {node:nodeToAsk, request:{cycle, accounts:[]}}
        nodesBySyncRadix.set(syncRadix, requestEntry)
      }
      requestEntry.request.accounts.push(accountEntry)
    }


    let promises = []
    for(let requestEntry of nodesBySyncRadix.values()){
      if(requestEntry.request.accounts.length > 900){
        let offset = 0
        let allAccounts = requestEntry.request.accounts
        let maxAskCount = 5000
        let thisAskCount = 0
        while(offset < allAccounts.length && Math.min(offset + 900, allAccounts.length) < maxAskCount){
          requestEntry.request.accounts = allAccounts.slice(offset, offset + 900)
          let promise = this.p2p.ask(requestEntry.node, 'get_account_data_by_hashes', requestEntry.request)
          promises.push(promise)
          offset = offset + 900
          stats.multiRequests++
          thisAskCount = requestEntry.request.accounts.length
        }

        stats.skipping += Math.max(0,allAccounts.length - thisAskCount)
        stats.requested += thisAskCount

        //would it be better to resync if we have a high number of errors?  not easy to answer this.

      } else {
        let promise = this.p2p.ask(requestEntry.node, 'get_account_data_by_hashes', requestEntry.request)
        promises.push(promise)
        stats.requested = requestEntry.request.accounts.length
      }
    }

    let wrappedDataList:Shardus.WrappedData[] = []
    //let stateTableDataList:Shardus.StateTableObject[] = []

    let stateTableDataMap:Map<string, Shardus.StateTableObject> = new Map()

    let results = await Promise.all(promises) as HashTrieAccountDataResponse[]
    for(let result of results){
      //HashTrieAccountDataResponse
      if(result != null && result.accounts != null && result.accounts.length > 0){

        if(result.stateTableData != null && result.stateTableData.length > 0){
          for(let stateTableData of result.stateTableData){
            stateTableDataMap.set(stateTableData.stateAfter, stateTableData)

          }
        }

        //wrappedDataList = wrappedDataList.concat(result.accounts)
        for(let wrappedAccount of result.accounts){
          let desiredHash = accountHashMap.get(wrappedAccount.accountId)
          if(desiredHash != wrappedAccount.stateId){
            //got account back but has the wrong stateID
            //nestedCountersInstance.countEvent('accountPatcher', 'getAccountRepairData wrong hash')
            this.statemanager_fatal('getAccountRepairData wrong hash',`getAccountRepairData wrong hash ${utils.stringifyReduce(wrappedAccount.accountId)}`)
            continue
          }
          wrappedDataList.push(wrappedAccount)

          // let stateDataFound = stateTableDataMap.get(wrappedAccount.accountId)
          // if(stateDataFound != null){
          //   //todo filtering
          //   if(stateDataFound.stateAfter === desiredHash){
          //     stateTableDataList.push(stateDataFound)
          //   }
          // }
        }
      }
    }
    return {wrappedDataList, stateTableDataMap, stats}
  }

  /***
   *    ########  ########   #######   ######  ########  ######   ######   ######  ##     ##    ###    ########  ########  ########  ##     ## ##     ## ########
   *    ##     ## ##     ## ##     ## ##    ## ##       ##    ## ##    ## ##    ## ##     ##   ## ##   ##     ## ##     ## ##     ## ##     ## ###   ### ##     ##
   *    ##     ## ##     ## ##     ## ##       ##       ##       ##       ##       ##     ##  ##   ##  ##     ## ##     ## ##     ## ##     ## #### #### ##     ##
   *    ########  ########  ##     ## ##       ######    ######   ######   ######  ######### ##     ## ########  ##     ## ##     ## ##     ## ## ### ## ########
   *    ##        ##   ##   ##     ## ##       ##             ##       ##       ## ##     ## ######### ##   ##   ##     ## ##     ## ##     ## ##     ## ##
   *    ##        ##    ##  ##     ## ##    ## ##       ##    ## ##    ## ##    ## ##     ## ##     ## ##    ##  ##     ## ##     ## ##     ## ##     ## ##
   *    ##        ##     ##  #######   ######  ########  ######   ######   ######  ##     ## ##     ## ##     ## ########  ########   #######  ##     ## ##
   */

  /**
   * processShardDump
   * debug only code to create a shard report.
   * @param stream
   * @param lines
   */
  processShardDump (stream, lines) {

    let dataByParition = new Map()

    let rangesCovered = []
    let nodesListsCovered = []
    let nodeLists = []
    let numNodes = 0
    let newestCycle = -1
    let partitionObjects = []
    for (let line of lines) {
      let index = line.raw.indexOf('{"allNodeIds')
      if (index >= 0) {
        let string = line.raw.slice(index)
        //this.generalLog(string)
        let partitionObj = JSON.parse(string)

        if(newestCycle > 0 &&  partitionObj.cycle != newestCycle){
          stream.write(`wrong cycle for node: ${line.file.owner} reportCycle:${newestCycle} thisNode:${partitionObj.cycle} \n`)
          continue
        }
        partitionObjects.push(partitionObj)

        if (partitionObj.cycle > newestCycle) {
          newestCycle = partitionObj.cycle
        }
        partitionObj.owner = line.file.owner //line.raw.slice(0, index)
      }
    }

    for (let partitionObj of partitionObjects) {
      // we only want data for nodes that were active in the latest cycle.
      if (partitionObj.cycle === newestCycle) {
        for (let partition of partitionObj.partitions) {
          let results = dataByParition.get(partition.parititionID)
          if (results == null) {
            results = []
            dataByParition.set(partition.parititionID, results)
          }
          results.push({
            owner: partitionObj.owner,
            accounts: partition.accounts,
            ownerId: partitionObj.rangesCovered.id,
            accounts2: partition.accounts2,
            partitionHash2: partition.partitionHash2 })
        }
        rangesCovered.push(partitionObj.rangesCovered)
        nodesListsCovered.push(partitionObj.nodesCovered)
        nodeLists.push(partitionObj.allNodeIds)
        numNodes = partitionObj.allNodeIds.length
      }
    }

    // need to only count stuff from the newestCycle.

    // /////////////////////////////////////////////////
    // compare partition data: old system with data manual queried from app
    let allPassed = true
    // let uniqueVotesByPartition = new Array(numNodes).fill(0)
    for (var [key, value] of dataByParition) {
      let results = value
      let votes = {}
      for (let entry of results) {
        if (entry.accounts.length === 0) {
          // new settings allow for not using accounts from sql
          continue
        }
        entry.accounts.sort(function (a, b) { return a.id === b.id ? 0 : a.id < b.id ? -1 : 1 })
        let string = utils.stringifyReduce(entry.accounts)
        let voteEntry = votes[string]
        if (voteEntry == null) {
          voteEntry = {}
          voteEntry.voteCount = 0
          voteEntry.ownerIds = []
          votes[string] = voteEntry
        }
        voteEntry.voteCount++
        votes[string] = voteEntry

        voteEntry.ownerIds.push(entry.ownerId)
      }
      for (let key2 of Object.keys(votes)) {
        let voteEntry = votes[key2]
        let voters = ''
        if (key2 !== '[]') {
          voters = `---voters:${JSON.stringify(voteEntry.ownerIds)}`
        }

        stream.write(`partition: ${key}  votes: ${voteEntry.voteCount} values: ${key2} \t\t\t${voters}\n`)
        // stream.write(`            ---voters: ${JSON.stringify(voteEntry.ownerIds)}\n`)
      }
      let numUniqueVotes = Object.keys(votes).length
      if (numUniqueVotes > 2 || (numUniqueVotes > 1 && (votes['[]'] == null))) {
        allPassed = false
        stream.write(`partition: ${key} failed.  Too many different version of data: ${numUniqueVotes} \n`)
      }
    }
    stream.write(`partition tests all passed: ${allPassed}\n`)
    // rangesCovered

    // /////////////////////////////////////////////////
    // compare partition data 2: new system using the state manager cache
    let allPassed2 = true
    // let uniqueVotesByPartition = new Array(numNodes).fill(0)
    for ([key, value] of dataByParition) {
      let results = value
      let votes = {}
      for (let entry of results) {
        // no account sort, we expect this to have a time sort!
        // entry.accounts.sort(function (a, b) { return a.id === b.id ? 0 : a.id < b.id ? -1 : 1 })
        let fullString = utils.stringifyReduce(entry.accounts2)
        let string = entry.partitionHash2
        if (string === undefined) {
          string = '[]'
        }

        let voteEntry = votes[string]
        if (voteEntry == null) {
          voteEntry = {}
          voteEntry.voteCount = 0
          voteEntry.ownerIds = []
          voteEntry.fullString = fullString
          votes[string] = voteEntry
        }
        voteEntry.voteCount++
        votes[string] = voteEntry

        voteEntry.ownerIds.push(entry.ownerId)
      }
      for (let key2 of Object.keys(votes)) {
        let voteEntry = votes[key2]
        let voters = ''
        if (key2 !== '[]') {
          voters = `---voters:${JSON.stringify(voteEntry.ownerIds)}`
        }

        stream.write(`partition: ${key}  votes: ${voteEntry.voteCount} values: ${key2} \t\t\t${voters}\t -details:${voteEntry.fullString}   \n`)
        // stream.write(`            ---voters: ${JSON.stringify(voteEntry.ownerIds)}\n`)
      }
      let numUniqueVotes = Object.keys(votes).length
      if (numUniqueVotes > 2 || (numUniqueVotes > 1 && (votes['[]'] == null))) {
        allPassed2 = false
        stream.write(`partition: ${key} failed.  Too many different version of data: ${numUniqueVotes} \n`)
      }
    }

    stream.write(`partition tests all passed: ${allPassed2}\n`)

    rangesCovered.sort(function (a, b) { return a.id === b.id ? 0 : a.id < b.id ? -1 : 1 })

    let isStored = function (i, rangeCovered) {
      let key = i
      let minP = rangeCovered.stMin
      let maxP = rangeCovered.stMax
      if (minP === maxP) {
        if (i !== minP) {
          return false
        }
      } else if (maxP > minP) {
        // are we outside the min to max range
        if (key < minP || key > maxP) {
          return false
        }
      } else {
        // are we inside the min to max range (since the covered rage is inverted)
        if (key > maxP && key < minP) {
          return false
        }
      }
      return true
    }
    let isConsensus = function (i, rangeCovered) {
      let key = i
      let minP = rangeCovered.cMin
      let maxP = rangeCovered.cMax
      if (minP === maxP) {
        if (i !== minP) {
          return false
        }
      } else if (maxP > minP) {
        // are we outside the min to max range
        if (key < minP || key > maxP) {
          return false
        }
      } else {
        // are we inside the min to max range (since the covered rage is inverted)
        if (key > maxP && key < minP) {
          return false
        }
      }
      return true
    }

    for (let range of rangesCovered) {
      let partitionGraph = ''
      for (let i = 0; i < range.numP; i++) {
        let isC = isConsensus(i, range)
        let isSt = isStored(i, range)

        if (i === range.hP) {
          partitionGraph += 'H'
        } else if (isC && isSt) {
          partitionGraph += 'C'
        } else if (isC) {
          partitionGraph += '!'
        } else if (isSt) {
          partitionGraph += 'e'
        } else {
          partitionGraph += '_'
        }
      }

      stream.write(`node: ${range.id} ${range.ipPort}\tgraph: ${partitionGraph}\thome: ${range.hP}   data:${JSON.stringify(range)}\n`)
    }
    stream.write(`\n\n`)
    nodesListsCovered.sort(function (a, b) { return a.id === b.id ? 0 : a.id < b.id ? -1 : 1 })
    for (let nodesCovered of nodesListsCovered) {
      let partitionGraph = ''
      let consensusMap = {}
      let storedMap = {}
      for (let entry of nodesCovered.consensus) {
        consensusMap[entry.idx] = { hp: entry.hp }
      }
      for (let entry of nodesCovered.stored) {
        storedMap[entry.idx] = { hp: entry.hp }
      }

      for (let i = 0; i < nodesCovered.numP; i++) {
        let isC = consensusMap[i] != null
        let isSt = storedMap[i] != null
        if (i === nodesCovered.idx) {
          partitionGraph += 'O'
        } else if (isC && isSt) {
          partitionGraph += 'C'
        } else if (isC) {
          partitionGraph += '!'
        } else if (isSt) {
          partitionGraph += 'e'
        } else {
          partitionGraph += '_'
        }
      }

      stream.write(`node: ${nodesCovered.id} ${nodesCovered.ipPort}\tgraph: ${partitionGraph}\thome: ${nodesCovered.hP} data:${JSON.stringify(nodesCovered)}\n`)
    }
    stream.write(`\n\n`)
    for (let list of nodeLists) {
      stream.write(`${JSON.stringify(list)} \n`)
    }

    return { allPassed, allPassed2 }
  }





}

export default AccountPatcher
