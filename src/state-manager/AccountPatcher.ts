import { ShardusConfiguration } from '../shardus/shardus-types'
import Shardus = require('../shardus/shardus-types')
import { ShardGlobals, ShardInfo, StoredPartition, NodeShardData, AddressRange, HomeNodeSummary, ParititionShardDataMap, NodeShardDataMap, MergeResults, BasicAddressRange } from './shardFunctionTypes'
import * as utils from '../utils'
const stringify = require('fast-stable-stringify')

import Profiler from '../utils/profiler'
import { P2PModuleContext as P2P } from '../p2p/Context'
import Storage from '../storage'
import Crypto from '../crypto'
import Logger, {logFlags} from '../logger'
import ShardFunctions from './shardFunctions.js'
import { time } from 'console'
import StateManager from '.'
import { nestedCountersInstance } from '../utils/nestedCounters'


import * as Comms from '../p2p/Comms'
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

  hashTrieSyncConsensusByCycle: Map<number, HashTrieSyncConsensus>

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
      this.shardTrie.layerMaps.push(new Map)
    }

    this.totalAccounts = 0

    this.hashTrieSyncConsensusByCycle = new Map()
  }

  hashObj(value:any){
    //could replace with a different cheaper hash!!
    return crypto.hash(value)
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
      let result = {nodeHashes:[]} as HashTrieResp

      for(let radix of payload.radixList){

        let level = radix.length
        let layerMap = this.shardTrie.layerMaps[level]

        let hashTrieNode = layerMap.get(radix)
        if(hashTrieNode != null){
          result.nodeHashes.push({radix, hash:hashTrieNode.hash})
        }
      }
      await respond(result)
    })


    //this should be a tell to X..  robust tell? if a node does not get enough it can just query for more.
    Comms.registerInternal('sync_trie_hashes', async (payload: HashTrieSyncTell, sender) => {
      let hashTrieSyncConsensus = this.hashTrieSyncConsensusByCycle.get(payload.cycle)
      if(hashTrieSyncConsensus == null){
        hashTrieSyncConsensus = {
          cycle:payload.cycle,
          radixHashVotes: new Map(),
          coverageMap: new Map()
        }
        this.hashTrieSyncConsensusByCycle.set(payload.cycle, hashTrieSyncConsensus)
      }

      for(let nodeHashes of payload.nodeHashes){

        let hashVote = hashTrieSyncConsensus.radixHashVotes.get(nodeHashes.radix)
        if(hashVote == null){
          hashVote = {allVotes:new Map(), bestHash:nodeHashes.hash, bestVotes:1}
          hashTrieSyncConsensus.radixHashVotes.set(nodeHashes.radix, hashVote)
          hashVote.allVotes.set(nodeHashes.hash, {count:1, voters:[sender]})
        } else {
          let voteEntry = hashVote.allVotes.get(nodeHashes.hash)
          if(voteEntry == null){
            hashVote.allVotes.set(nodeHashes.hash, {count:1, voters:[sender]})
          } else {
            let voteCount = voteEntry.count + 1
            voteEntry.count = voteCount
            voteEntry.voters.push(sender)
            //hashVote.allVotes.set(nodeHashes.hash, votes + 1)
            //will ties be a problem? (not if we need a majority!)
            if(voteCount > hashVote.bestVotes){
              hashVote.bestVotes = voteCount
              hashVote.bestHash = nodeHashes.hash
            }
          }
        }
      }
    })

    //get child accountHashes for radix.  //get the hashes and ids so we know what to fix.
    Comms.registerInternal('get_trie_accountHashes', async (payload: HashTrieReq, respond: (arg0: HashTrieAccountsResp) => any) => {

      //nodeChildHashes: {radix:string, childAccounts:{accountID:string, hash:string}[]}[]
      let result = {nodeChildHashes:[]} as HashTrieAccountsResp

      for(let radix of payload.radixList){

        let level = radix.length
        let layerMap = this.shardTrie.layerMaps[level]

        let hashTrieNode = layerMap.get(radix)
        if(hashTrieNode != null && hashTrieNode.accounts != null){
          let childAccounts = []
          result.nodeChildHashes.push({radix, childAccounts:childAccounts})
          for(let account of hashTrieNode.accounts){
            childAccounts.push({accountID:account.accountID, hash: account.hash})
          }
        }
      }
      await respond(result)
    })

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

  upateShardTrie() : HashTrieUpdateStats {
    let currentLayer = this.treeMaxDepth
    let treeNodeQueue = []  

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

    for(let i =0; i< this.accountUpdateQueue.length; i++){
      let tx = this.accountUpdateQueue[i]
      let key = tx.accountID.slice(0,currentLayer)
      let treeNode = currentMap.get(key)
      if(treeNode == null){
        //init a leaf 
        treeNode = {radix:key, children:[], childHashes:[], accounts:[], hash:'', accountTempMap:new Map(), updated:true, isIncomplete: false, nonSparseChildCount:0} //this map will cause issues with update
        currentMap.set(key, treeNode)
        //treeNodeQueue.push(treeNode)
        updateStats.leafsCreated++

        treeNodeQueue.push(treeNode)
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

    //sort accounts
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
          parentTreeNode = {radix:parentKey, children:Array(16), childHashes:Array(16), updated:false, hash:'', isIncomplete: false, nonSparseChildCount:0}
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
      }

      updateStats.updatedNodesPerLevel[i] = parentTreeNodeQueue.length

      //loop and compute hashes of parents
      for(let j = 0; j<parentTreeNodeQueue.length; j++){
        let parentTreeNode = parentTreeNodeQueue[j]
        parentTreeNode.hash = this.hashObj(parentTreeNode.childHashes)

        updateStats.totalHashes++
        updateStats.totalNodesHashed = updateStats.totalNodesHashed + parentTreeNode.nonSparseChildCount
        updateStats.hashedChildrenPerLevel[i] = updateStats.hashedChildrenPerLevel[i] + parentTreeNode.nonSparseChildCount
      }
      treeNodeQueue = parentTreeNodeQueue
      parentTreeNodeQueue = []
    }

    updateStats.totalLeafs = this.shardTrie.layerMaps[this.treeMaxDepth].size
    

    this.accountUpdateQueue = []

    return updateStats
  }

  diffConsenus(consensusArray, mapB) : {radix:string, hash:string}[] {
    //map 
    let toFix = []
    for(let value of consensusArray){
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


  computeCoverage(cycle:number){
    let hashTrieSyncConsensus = this.hashTrieSyncConsensusByCycle.get(cycle)

    let coverageMap = new Map() //map of sync radix to n

    hashTrieSyncConsensus.coverageMap = coverageMap

    //let nodeUsage = new Map()
    for(let radixHash of hashTrieSyncConsensus.radixHashVotes.keys() ){
      let coverage = coverageMap.get(radixHash)
      if(coverage == null){
        let votes = hashTrieSyncConsensus.radixHashVotes.get(radixHash)
        let bestVote = votes.allVotes.get(votes.bestHash)
        let potentialNodes = bestVote.voters
        let node = potentialNodes[0]
        coverageMap.set(radixHash, {firstChoice:node, fullList: bestVote.voters, refuted:new Set()})
        //let count = nodeUsage.get(node.id)
      } 
    }


    //todo a pass to use as few nodes as possible

    //todo this new list can be acced with fn and give bakup nods/
    //  have fallback optoins
  }

  getNodeForQuery(radix:string, cycle:number, nextNode:boolean = false){
    let hashTrieSyncConsensus = this.hashTrieSyncConsensusByCycle.get(cycle)
    let parentRadix = radix.substr(0, this.treeSyncDepth)

    let coverageEntry = hashTrieSyncConsensus.coverageMap.get(parentRadix)

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
  }

  async getChildrenOf(radixHashEntries:RadixAndHash[], cycle:number) : Promise<RadixAndHash[]> {
    let result:HashTrieResp 
    let nodeHashes: RadixAndHash[]
    let requestMap:Map<any, HashTrieReq> = new Map()
    for(let radixHash of radixHashEntries ){
      let node = this.getNodeForQuery(radixHash.radix, cycle)
      let existingRequest = requestMap.get(node)
      if(existingRequest == null){
        existingRequest = {radixList:[]}
        requestMap.set(node, existingRequest)
      }
      existingRequest.radixList.push(radixHash.radix)
    }
    for(let [key, value] of requestMap){
      try{
        result = await this.p2p.ask(key, 'get_trie_hashes', value)
        if(result != null && result.nodeHashes != null){
          nodeHashes = nodeHashes.concat(result.nodeHashes)
        } //else retry?        
      } catch (error) {

      }
    }
    return nodeHashes
  }

  async getChildAccountHashes(radixHashEntries:RadixAndHash[], cycle:number) : Promise<RadixAndChildHashes[]> {
    let result:HashTrieAccountsResp
    let nodeChildHashes: RadixAndChildHashes[]
    let allHashes: AccountIDAndHash[] = []
    let requestMap:Map<any, HashTrieReq> = new Map()
    for(let radixHash of radixHashEntries ){
      let node = this.getNodeForQuery(radixHash.radix, cycle)
      let existingRequest = requestMap.get(node)
      if(existingRequest == null){
        existingRequest = {radixList:[]}
        requestMap.set(node, existingRequest)
      }
      existingRequest.radixList.push(radixHash.radix)
    }
    for(let [key, value] of requestMap){
      try{
        result = await this.p2p.ask(key, 'get_trie_accountHashes', value) 
        if(result != null && result.nodeChildHashes != null){
          nodeChildHashes = nodeChildHashes.concat(result.nodeChildHashes)
          // for(let childHashes of result.nodeChildHashes){
          //   allHashes = allHashes.concat(childHashes.childAccounts)
          // }
        } //else retry?        
      } catch (error) {

      }
    }
    return nodeChildHashes
  }

  isInSync(cycle){
    let hashTrieSyncConsensus = this.hashTrieSyncConsensusByCycle.get(cycle)

    //let oosRadix = []
    //get our list of covered radix values for cycle X!!!
    //let inSync = true
    for(let radix of hashTrieSyncConsensus.radixHashVotes.keys()){
      let votesMap = hashTrieSyncConsensus.radixHashVotes.get(radix)
      let ourTrieNode = this.shardTrie.layerMaps[this.treeSyncDepth].get(radix)
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
  async findBadAccounts(cycle:number){
    let badAccounts:AccountIDAndHash[] = []
    let hashesPerLevel = Array(this.treeMaxDepth+1).fill(0)
    let checkedKeysPerLevel = Array(this.treeMaxDepth)
    let badHashesPerLevel = Array(this.treeMaxDepth+1).fill(0)
    let requestedKeysPerLevel = Array(this.treeMaxDepth+1).fill(0)

    let level = this.treeSyncDepth

    let badLayerMap = this.shardTrie.layerMaps[level]

    let goodVotes = []
    let hashTrieSyncConsensus = this.hashTrieSyncConsensusByCycle.get(cycle)
    for(let radix of hashTrieSyncConsensus.radixHashVotes.keys()){
      let votesMap = hashTrieSyncConsensus.radixHashVotes.get(radix)
      goodVotes.push({radix, hash: votesMap.bestHash})
    }

    let toFix = this.diffConsenus(goodVotes, badLayerMap)

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
      hashesPerLevel[level] = badLayerMap.size
    }

    //get bad accounts
    let radixAndChildHashes = await this.getChildAccountHashes(toFix, cycle)

    let accountHashesChecked = 0
    for(let radixAndChildHash of radixAndChildHashes){
      accountHashesChecked += radixAndChildHash.childAccounts.length

      let badTreeNode = badLayerMap.get(radixAndChildHash.radix)
      if(badTreeNode != null){
        let accMap = new Map()
        for(let i=0; i<badTreeNode.accounts.length; i++ ){
          accMap.set(badTreeNode.accounts[i].accountID,badTreeNode.accounts[i])
        }

        for(let i=0; i<radixAndChildHash.childAccounts.length; i++ ){
          let potentalGoodAcc = radixAndChildHash.childAccounts[i]
          let potentalBadAcc = accMap.get(potentalGoodAcc.accountID)
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
    return {badAccounts, hashesPerLevel, checkedKeysPerLevel, requestedKeysPerLevel, badHashesPerLevel, accountHashesChecked}
  }

  //big todo .. be able to test changes on a temp tree and validate the hashed before we commit updates
  //also need to actually update the full account data and not just our tree!!


  updateAccountHash(accountID:string, hash:string){

    //todo do we need to look at cycle or timestamp and have a future vs. next queue?

    let accountData = {accountID, hash}
    this.accountUpdateQueue.push(accountData)
  }

  applyRepair(accountsToFix:AccountIDAndHash[]){
    //todo do we need to look at cycle or timestamp and have a future vs. next queue?
    for(let account of accountsToFix){
      //need proper tx injestion.
      //this.txCommit(node, account)
      //updateAccountHash
    }
  }

  //TODO save off last stats and put them on an endpoint for debugging/confirmation
  async update(cycle){

    let updateStats = this.upateShardTrie()

    nestedCountersInstance.countEvent(`accountPatcher`, `totalAccountsHashed`, updateStats.totalAccountsHashed)

    if(this.isInSync(cycle) === false){

      let results = await this.findBadAccounts(cycle)
      nestedCountersInstance.countEvent(`accountPatcher`, `badAccounts ${cycle} `, results.badAccounts.length)
      nestedCountersInstance.countEvent(`accountPatcher`, `accountHashesChecked ${cycle}`, results.accountHashesChecked)

      //Start fixes

      //request data for the list of bad accounts then update. this can live in account repair?

      //apply repair account data and update shard trie

      //check again if we are in sync

    } else {
      nestedCountersInstance.countEvent(`accountPatcher`, `inSync`)
    }

  }

}

export default AccountPatcher
