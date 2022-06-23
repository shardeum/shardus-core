/*
Nodes can be lost at anytime without notifiying the network. This is different than Apoptosis where
the node sends a message to peers before exiting. When a node notifies the network that it is exiting,
the peers can remove it from their node list within 2 cycles. If a node does not notifiy the network
before exiting it will take the peers about 3 cycles to remove the node from their node list.
The lost node detection process is described in the "Lost Node Detection" Google doc under Shardus
internal documents.
*/

import { Handler } from 'express'
import * as http from '../http'
import { logFlags } from '../logger'
import { P2P } from '@shardus/types'
import { binarySearch, validateTypes } from '../utils'
import * as Comms from './Comms'
import { crypto, logger, network, config } from './Context'
import { currentCycle, currentQuarter } from './CycleCreator'
import { activeByIdOrder, byIdOrder, nodes } from './NodeList'
import * as Self from './Self'
import { profilerInstance } from '../utils/profiler'
import getCallstack from '../utils/getCallstack'
import * as NodeList from './NodeList'
import { nestedCountersInstance } from '../utils/nestedCounters'
import * as utils from '../utils'
import { isApopMarkedNode } from './Apoptosis'

/** STATE */

// [TODO] - This enables the /kill /killother debug route and should be set to false after testing
const allowKillRoute = true

let p2pLogger

let lost: Map<string, P2P.LostTypes.LostRecord>
export let isDown = {}
let isUp = {}
let isUpTs = {}
let stopReporting = {}
let sendRefute = -1

const CACHE_CYCLES = 10

/** ROUTES */

const killExternalRoute: P2P.P2PTypes.Route<Handler> = {
  method: 'GET',
  name: 'kill',
  handler: (_req, res) => {
    if (allowKillRoute){
      res.json({status: 'left the network without telling any peers'})
      killSelf('Apoptosis being called killExternalRoute()->killSelf()->emitter.emit(`apoptosized`) at src/p2p/Lost.ts')
    }
  },
}

const killOtherExternalRoute: P2P.P2PTypes.Route<Handler> = {
  method: 'GET',
  name: 'killother',
  handler: (_req, res) => {
    if (allowKillRoute){
      res.json({status: 'killing another node'})
      killOther()
    }
  },
}

const lostReportRoute: P2P.P2PTypes.Route<P2P.P2PTypes.InternalHandler<P2P.LostTypes.SignedLostReport>> = {
  name: 'lost-report',
  handler: lostReportHandler
}

const lostDownRoute: P2P.P2PTypes.GossipHandler = (payload:P2P.LostTypes.SignedDownGossipMessage, sender, tracker) => {
  profilerInstance.scopedProfileSectionStart('lost-down')
  try {
    downGossipHandler(payload, sender, tracker)
  } finally {
    profilerInstance.scopedProfileSectionStart('lost-down')
  }
}

const lostUpRoute: P2P.P2PTypes.GossipHandler = (payload:P2P.LostTypes.SignedUpGossipMessage, sender, tracker) => {
  profilerInstance.scopedProfileSectionStart('lost-up')
  try {
    upGossipHandler(payload, sender, tracker)
  } finally {
    profilerInstance.scopedProfileSectionStart('lost-up')
  }
}

const routes = {
  external: [killExternalRoute, killOtherExternalRoute ],
  internal: [lostReportRoute],
  gossip: {
    'lost-down': lostDownRoute,
    'lost-up': lostUpRoute,
  },
}


/** FUNCTIONS */

export function init() {
  // p2pLogger = logger.getLogger('p2p')
  p2pLogger = logger.getLogger('p2p')

  p2pLogger.info('HELLO')

  lost = new Map()

  // Init state
  reset()

  // Register routes
  for (const route of routes.external) {
    // [TODO] - Add Comms.registerExternalGet and Post that pass through to network.*
    //          so that we can always just use Comms.* instead of network.*
    network._registerExternal(route.method, route.name, route.handler)
  }
  for (const route of routes.internal) {
    Comms.registerInternal(route.name, route.handler)
  }
  for (const [name, handler] of Object.entries(routes.gossip)) {
    Comms.registerGossipHandler(name, handler)
  }
}

// This gets called before start of Q1
export function reset() {
  for (const [key, obj] of lost){
    if (obj.cycle < currentCycle-CACHE_CYCLES){ lost.delete(key); continue }  // delete old lost reports
    if (! nodes.get(obj.target)){ lost.delete(key); continue }  // delete once the target is removed from the node list
  }
  pruneIsDown() // prune isUp and isDown status cache
  pruneStopReporting() // prune stopReporting cache
}

// This gets called at the start of Q3
export function getTxs(): P2P.LostTypes.Txs {
  let lostTxs = []
  let refutedTxs = []
  // Check if the node in the lost list is in the apop list; remove it if there is one
  for (const [key, obj] of lost){
    const { target } = obj
    if (isApopMarkedNode(target)) {
      lost.delete(key)
    }
  }
  let seen = {}  // used to make sure we don't add the same node twice
  for (const [key, obj] of lost){
    if (seen[obj.target]) continue
    if (obj.message && obj.message.report && obj.message.cycle === currentCycle){
      lostTxs.push(obj.message)
      seen[obj.target] = true
    }
  }
  seen = {}
  for (const [key, obj] of lost){
    if (seen[obj.target]) continue
    if (obj.message && obj.message.status === 'up' && obj.message.cycle === currentCycle){
      refutedTxs.push(obj.message)
      seen[obj.target] = true
    }
  }
  return {
    lost: [...lostTxs],
    refuted: [...refutedTxs]
  }
}

export function validateRecordTypes(rec: P2P.LostTypes.Record): string{
  let err = validateTypes(rec,{lost:'a',refuted:'a'})
  if (err) return err
  for(const item of rec.lost){
    if (typeof(item) !== 'string') return 'items of lost array must be strings'
  }
  for(const item of rec.refuted){
    if (typeof(item) !== 'string') return 'items of refuted array must be strings'
  }
  return ''
}

// This gets called during Q3 after getTxs
export function dropInvalidTxs(txs: P2P.LostTypes.Txs): P2P.LostTypes.Txs {
  const validLost = txs.lost.filter(request => checkDownMsg(request, currentCycle)[0])
  const validRefuted = txs.refuted.filter(request => checkUpMsg(request, currentCycle)[0])
  return { lost: validLost, refuted: validRefuted }
}

/*
Given the txs and prev cycle record mutate the referenced record
*/
// This gets called during Q3 after dropInvalidTxs
export function updateRecord( txs: P2P.LostTypes.Txs, record: P2P.CycleCreatorTypes.CycleRecord, prev: P2P.CycleCreatorTypes.CycleRecord) {
  const lostNodeIds = []
  const lostSyncingNodeIds = []
  const refutedNodeIds = []
  let seen = {}  // used to make sure we don't add the same node twice
  for (const request of txs.lost) {
    if (seen[request.report.target]) continue
    lostNodeIds.push(request.report.target)
    seen[request.report.target] = true
  }
  seen = {}
  for (const request of txs.refuted) {
    if (seen[request.target]) continue
    refutedNodeIds.push(request.target)
    seen[request.target] = true
  }

  // remove activated nodes from syncing by id order
  for (const nodeId of record.activated) {
    NodeList.removeSyncingNode(nodeId)
  }

  if (config.p2p.detectLostSyncing) {
    const syncingNodes = NodeList.syncingByIdOrder
    const now = Math.floor(Date.now() / 1000)
    for (const syncingNode of syncingNodes) {
      const syncTime = now - syncingNode.joinRequestTimestamp
      console.log('syncTime vs maxSyncTime', syncTime, record.maxSyncTime)
      if (record.maxSyncTime && syncTime > record.maxSyncTime) {
        if (logFlags.p2pNonFatal) {
          info(`Syncing time for node ${syncingNode.id}`, syncTime)
          info(`Max sync time from record`, record.maxSyncTime)
          info(`Sync time is longer than max sync time. Reporting as lost`)
        }
        info('adding node to lost syncing list', syncingNode.id, `${syncTime} > ${record.maxSyncTime}`)
        //todo remove this later after we feel good about the system.. it wont really be that rare, so we dont want to swamp rare counters
        nestedCountersInstance.countRareEvent('lost','sync timeout ' + `${utils.stringifyReduce(syncingNode.id)} ${syncTime} > ${record.maxSyncTime}`)
        lostSyncingNodeIds.push(syncingNode.id)
      }
    }
  }

  record.lost = lostNodeIds.sort()
  record.lostSyncing = lostSyncingNodeIds.sort()
  record.refuted = refutedNodeIds.sort()

  if (prev){
    let apop = prev.lost.filter(id => nodes.has(id))  // remove nodes that are no longer in the network
    let apopSyncing = []
    if (config.p2p.detectLostSyncing) {
      apopSyncing = prev.lostSyncing.filter((id) => nodes.has(id))
    }
    // remove nodes that are no longer in the network
    apop = apop.filter(id => !refutedNodeIds.includes(id))  // remove nodes that refuted
    record.apoptosized = [...apop, ...apopSyncing, ...record.apoptosized ].sort()
  }
}

// This gets called before Q1 when a new cycle is created or fetched
export function parseRecord(record: P2P.CycleCreatorTypes.CycleRecord): P2P.CycleParserTypes.Change {
  // If we see our node in the refute field clear flag to send an 'up' message at start of next cycle
  //   We ndded to do this check before checking the lost field for our node.
  for (const id of record.refuted) {
    if (id === Self.id) sendRefute = -1
  }
  // Once we see any node in the lost field of the cycle record, we should stop
  //   sending lost reports for it to reduce the amount of network messages caused by the lost node
  // If we see our node in the lost field set flag to send an 'up' message at start of next cycle
  for (const id of record.lost) {
    stopReporting[id] = record.counter
    if (id === Self.id) sendRefute = record.counter + 1
  }

  if (record.lostSyncing.includes(Self.id)) {
    // This could happen if we take longer than maxSyncTime to sync
    error(`We got marked for apoptosis even though we didn't ask for it. Being nice and leaving.`)
    Self.emitter.emit(
      'apoptosized',
      getCallstack(),
      'Apoptosis being called at parseRecord() => src/p2p/Apoptosis.ts'
    )
  }

  // We don't actually have to set removed because the Apoptosis module will do it.
  // Make sure the Lost module is listed after Apoptosis in the CycleCreator submodules list
  return {
    added: [],
    removed: [],
    updated: []
  }
}

// This is called once per cycle at the start of Q1 by CycleCreator
export function sendRequests() {
  for (const [key, obj] of lost){
    if (obj.status !== 'down') continue   // TEST
    if (obj.message && obj.message.checker && obj.message.checker === Self.id){
      if (obj.gossiped) continue
      if (obj.status !== 'down') continue
      if (stopReporting[obj.message.target]) continue // TEST // this node already appeared in the lost field of the cycle record, we dont need to keep reporting
      let msg = {report:obj.message, cycle:currentCycle, status:'down'}
      msg = crypto.sign(msg)
      obj.message = msg
      obj.gossiped = true
      if(logFlags.p2pNonFatal) info(`Gossiping node down message: ${JSON.stringify(msg)}`)
      Comms.sendGossip('lost-down', msg, '', null, byIdOrder, true)
    }
  }
// We cannot count on the lost node seeing the gossip and refuting based on that.
//   It has to be based on the lost node seeing it's node id in the lost field of the cycle record.
//   Send refute is set to the cycle counter + 1 of the cycle record where we saw our id in the lost field
//   We cannot create a message which has the down message since we may not have received that gossip
  if (sendRefute>0) {
    if(logFlags.p2pNonFatal) info(`sendRequest 5  sendRefute:${sendRefute}  currentCycle:${currentCycle}`)
  }
  if (sendRefute === currentCycle){
    let msg = {target:Self.id, status:"up", cycle:currentCycle}
    msg = crypto.sign(msg)
    if(logFlags.p2pNonFatal) info(`Gossiping node up message: ${JSON.stringify(msg)}`)
    Comms.sendGossip('lost-up', msg, '', null, byIdOrder, true)
  }
}


/* Module functions */

async function killSelf(message: string) {
  if(logFlags.p2pNonFatal) error(`In killSelf`)
  Self.emitter.emit('apoptosized', getCallstack(), message)
  if(logFlags.p2pNonFatal) error(`I have been killed, will not restart.`)
}

async function killOther() {
  info(`In killOther`)
  let target = activeByIdOrder[0]
  if (target.id === Self.id) target = activeByIdOrder[1]
  reportLost(target, 'killother')
}


// This gets called from Shardus when network module emits timeout or error
export function reportLost(target, reason){
  console.log('Reporting lost', target, reason)
  if (target.id === Self.id) return  // don't report self
  if (stopReporting[target.id]) return // this node already appeared in the lost field of the cycle record, we dont need to keep reporting
// we set isDown cache to the cycle number here; to speed up deciding if a node is down
  isDown[target.id] = currentCycle
  const key = `${target.id}-${currentCycle}`
  const lostRec = lost.get(key)
  if (lostRec) return  // we have already seen this node for this cycle
  let obj = {target:target.id, status:'reported', cycle:currentCycle }
  const checker = getCheckerNode(target.id, currentCycle)
  if ((checker.id === Self.id) && (activeByIdOrder.length >= 3)) return // we cannot be reporter and checker if there is 3 or more nodes in the network
  let msg:P2P.LostTypes.LostReport = {target:target.id, checker:checker.id, reporter:Self.id, cycle:currentCycle}
// [TODO] - remove the following line after testing killother
  if (allowKillRoute && reason === 'killother') msg.killother = true
  if(logFlags.p2pNonFatal) info(`Sending investigate request: reporter:${Self.port} checker:${checker.externalPort} target:${target.externalPort} `+JSON.stringify(msg))
  msg = crypto.sign(msg)
  lost.set(key, obj)
  Comms.tell([checker], 'lost-report', msg)
}

function getCheckerNode(id, cycle){
  const near = crypto.hash({id, cycle})
  function compareNodes(i, r){
    return (i > r.id) ? 1 : (i < r.id) ? -1 : 0
  }
  let idx = binarySearch(activeByIdOrder, near, compareNodes)
  const oidx = idx
  if (idx < 0) idx = (-1 - idx)%activeByIdOrder.length
  if (activeByIdOrder[idx].id === id) idx = (idx+1)%activeByIdOrder.length  // skip to next node if the selected node is target
  if(logFlags.p2pNonFatal) {
    info(`in getCheckerNode oidx:${oidx} idx:${idx} near:${near}  cycle:${cycle}  id:${id}`)
    info(`${JSON.stringify(activeByIdOrder.map(n => n.id))}`)
  }
  return activeByIdOrder[idx]
}

async function lostReportHandler (payload, response, sender) {
  profilerInstance.scopedProfileSectionStart('lost-report')
  try {
    if(logFlags.p2pNonFatal) info(`Got investigate request: ${JSON.stringify(payload)} from ${JSON.stringify(sender)}`)
    let err = ''
    err = validateTypes(payload, {target:'s',reporter:'s',checker:'s',cycle:'n',sign:'o'})
    if (err){ warn('bad input '+err); return }
    err = validateTypes(payload.sign, {owner:'s',sig:'s'})
    if (err){ warn('bad input sign '+err); return }
    if (stopReporting[payload.target]) return // this node already appeared in the lost field of the cycle record, we dont need to keep reporting
    const key = `${payload.target}-${payload.cycle}`
    if (lost.get(key)) return // we have already seen this node for this cycle
    const [valid, reason] = checkReport(payload, currentCycle+1)
    if (!valid){
      warn('Got bad investigate request. Reason: '+reason)
      return
    }
    if (sender !== payload.reporter) return // sender must be same as reporter
    if (payload.checker !== Self.id) return  // the checker should be our node id
    let obj:P2P.LostTypes.LostRecord = {target:payload.target, cycle:payload.cycle, status:'checking', message:payload }
    lost.set(key, obj)
    // check if we already know that this node is down
    if (isDown[payload.target]){obj.status = 'down'; return}
    let result = await isDownCache(nodes.get(payload.target))
    if (allowKillRoute && payload.killother) result = 'down'
    if (obj.status === 'checking') obj.status = result
    if(logFlags.p2pNonFatal) info('Status after checking is '+obj.status)
    // At start of Q1 of the next cycle sendRequests() will start a gossip if the node was found to be down
  } finally {
    profilerInstance.scopedProfileSectionEnd('lost-report')
  }
}

function checkReport(report, expectCycle){
  if (!report || typeof(report) !== 'object') return [false, 'no report given']
  if (!report.reporter || typeof(report.reporter) !== 'string') return [false, 'no reporter field']
  if (!report.checker || typeof(report.checker) !== 'string') return [false, 'no checker field']
  if (!report.target || typeof(report.target) !== 'string') return [false, 'no target field']
  if (!report.cycle || typeof(report.cycle) !== 'number') return [false, 'no cycle field']
  if (!report.sign || typeof(report.sign) !== 'object') return [false, 'no sign field']
  if (report.target == Self.id) return [false, 'target is self']   // Don' accept if target is our node
  const cyclediff = expectCycle - report.cycle
  if (cyclediff < 0) return [false, 'reporter cycle is not as expected; too new']
  if (cyclediff >= 2) return [false, 'reporter cycle is not as expected; too old']
  if (report.target === report.reporter) return [false, 'target cannot be reporter']  // the target should not be the reporter
  if (report.checker === report.target) return [false, 'target cannot be checker']  // the target should not be the reporter
  if (report.checker === report.reporter){
    if (activeByIdOrder.length >= 3) return [false, 'checker cannot be reporter']
  }
  if (!nodes.has(report.target)) return [false, 'target not in network']
  if (!nodes.has(report.reporter)) return [false, 'reporter not in network']
  if (!nodes.has(report.checker)) return [false, 'checker not in network']
  let checkerNode = getCheckerNode(report.target, report.cycle)
  if (checkerNode.id !== report.checker) return [false, `checker node should be ${checkerNode.id} and not ${report.checker}`] // we should be the checker based on our own calculations
  if (!crypto.verify(report, nodes.get(report.reporter).publicKey)) return [false, 'bad sign from reporter'] // the report should be properly signed
  return [true, '']
}

/*
This cache uses two lookup tables: isUp and isDown
The tables map a node id to the cycle counter when the node up/down status was checked
When we check a node and find it to be up we set isUp[node_id] = current_cycle_counter
When we check a node and find it to be down we set isDown[node_id] = current_cycle_counter
At the start of each cycle we delete entries in the tables that are older than 5 cycles.
A conditional check for an entry that is not in the table has a result of false
and a conditional check for a nonzero entry has a result of true.
We export the isDown table so that other modules can easily check if a node is down.
However, if isDown returns false it does not mean that a node is not actually down.
But if it returns true it means that the node was found to be down recently.
Also if isUp returns false it does not mean that a node is actually up, but if it
returns true it means that it was found to be up recently.
*/
async function isDownCache(node){
// First check the isUp isDown caches to see if we already checked this node before
  const id = node.id
  if (isDown[id]) return "down"
  if (isUp[id]) return "up"
  const status = await isDownCheck(node)
  if (status === 'down') isDown[id] = currentCycle
  else isUp[id] = currentCycle
  return status
}

export function setIsUpTs(nodeId:string){
  let timestamp = Date.now()
  isUpTs[nodeId] = timestamp
}

export function isNodeUpRecent(nodeId:string, maxAge:number) : {upRecent:boolean, state:string, age:number} {
  let lastCheck = isUpTs[nodeId]
  let age = Date.now() - lastCheck

  if(isNaN(age)){
    return {upRecent:false, state:'noLastState', age}
  }

  if (age < maxAge) return {upRecent:true, state:'up', age}
  return {upRecent:false, state:'noLastState', age}
}

export function isNodeDown(nodeId:string) : {down:boolean, state:string} {
  // First check the isUp isDown caches to see if we already checked this node before
  if (isDown[nodeId]) return {down:true, state:'down'}
  if (isUp[nodeId]) return {down:false, state:'up'}
  return {down:false, state:'noLastState'}
}

export function isNodeLost(nodeId:string): boolean  {
  // First check the isUp isDown caches to see if we already checked this node before
  const key = `${nodeId}-${currentCycle}`
  const lostRec = lost.get(key)
  if (lostRec != null) {
    return true
  }
  return false
}

// This is called once per cycle by reset
function pruneIsDown(){
  for (const [key, value] of Object.entries(isDown)) {
    if (value < currentCycle-CACHE_CYCLES) delete isDown[key]
  }
  for (const [key, value] of Object.entries(isUp)) {
    if (value < currentCycle-CACHE_CYCLES) delete isUp[key]
  }
}

function pruneStopReporting(){
  for (const [key, value] of Object.entries(stopReporting)) {
    if (value < currentCycle-CACHE_CYCLES) delete stopReporting[key]
  }
}

// Make sure that both the external and internal ports are working
//   if either is not working then the node is considered down.
// If internal and external are both on the same IP then only need to check one.
// This function has some deep knowledge from Sync and Apoptosis APIs
//    and could break if they are changed.
// [TODO] - create our own APIs to test the internal and external connection.
//          Although this could allow a rouge node to more easily fool checks.
async function isDownCheck(node){
// Check the internal route
// The timeout for this is controled by the network.timeout paramater in server.json
  if(logFlags.p2pNonFatal) info(`Checking internal connection for ${node.id}`)
  const res = await Comms.ask(node, 'apoptosize', {id:'bad'})
  try{
    if (typeof(res.s) !== 'string') return 'down'
  }
  catch {
    return 'down'
  }
  if (node.externalIp === node.interalIp) return 'up'
  if(logFlags.p2pNonFatal) info(`Checking external connection for ${node.id}`)
// Check the external route if ip is different than internal
  const queryExt = async (node) => {
    const ip = node.ip ? node.ip : node.externalIp
    const port = node.port ? node.port : node.externalPort
    // the queryFunction must return null if the given node is our own
    // while syncing nodeList we dont have node.id, so use ip and port
    if (ip === Self.ip && port === Self.port) return null
    const resp = await http.get(`${ip}:${port}/sync-newest-cycle`)
    return resp
  }
  const resp = await queryExt(node)  // if the node is down, reportLost() will set status to 'down'
  try{
    if (typeof(resp.newestCycle.counter) !== 'number') return 'down'
  }
  catch{
    return 'down'
  }
  return 'up'
}

function downGossipHandler(payload:P2P.LostTypes.SignedDownGossipMessage, sender, tracker){
  if(logFlags.p2pNonFatal) info(`Got downGossip: ${JSON.stringify(payload)}`)
  let err = ''
  err = validateTypes(payload, {cycle:'n',report:'o',status:'s',sign:'o'})
  if (err){ warn('bad input '+err); return }
  err = validateTypes(payload.report, {target:'s',reporter:'s',checker:'s',cycle:'n',sign:'o'})
  if (err){ warn('bad input report '+err); return }
  err = validateTypes(payload.report.sign, {owner:'s',sig:'s'})
  if (err){ warn('bad input report sign '+err); return }
  err = validateTypes(payload.sign, {owner:'s',sig:'s'})
  if (err){ warn('bad input sign '+err); return }
  const key = `${payload.report.target}-${payload.report.cycle}`
  let rec = lost.get(key)
  if (rec && ['up','down'].includes(rec.status)) return // we have already gossiped this node for this cycle
  let [valid, reason] = checkQuarter(payload.report.checker, sender)
  if (!valid){
    warn(`Bad downGossip message. reason:${reason} message:${JSON.stringify(payload)}`)
    warn(`cycle:${currentCycle} quarter:${currentQuarter} sender:${sender}`)
    return
  }
  [valid, reason] = checkDownMsg(payload, currentCycle)
  if (!valid){
    warn(`Bad downGossip message. reason:${reason}. message:${JSON.stringify(payload)}`)
    warn(`cycle:${currentCycle} quarter:${currentQuarter} sender:${sender}`)
    return
  }
  let obj:P2P.LostTypes.LostRecord = {target:payload.report.target, cycle:payload.report.cycle, status:'down', message:payload }
  lost.set(key, obj)
  Comms.sendGossip('lost-down', payload, tracker, Self.id, byIdOrder, false)
// After message has been gossiped in Q1 and Q2 we wait for getTxs() to be invoked in Q3
}

function checkQuarter(source, sender){
  if (! [1,2].includes(currentQuarter)) return [false, 'not in Q1 or Q2']
  if ((sender === source) && (currentQuarter === 2)) return [false, 'originator cannot gossip in Q2']
  return [true, '']
}

function checkDownMsg(payload:P2P.LostTypes.SignedDownGossipMessage, expectedCycle){
  if (payload.cycle !== expectedCycle) return [false, 'checker cycle is not as expected']
  const [valid, reason] = checkReport(payload.report, expectedCycle-1)
  if (!valid) return [valid, reason]
  if (!crypto.verify(payload, nodes.get(payload.report.checker).publicKey)) return [false, `bad sign from checker.`]
  return [true, '']
}

function upGossipHandler(payload, sender, tracker){
  if(logFlags.p2pNonFatal) info(`Got upGossip: ${JSON.stringify(payload)}`)
  let err = ''
  err = validateTypes(payload, {cycle:'n',target:'s',status:'s',sign:'o'})
  if (err){ warn('bad input '+err); return }
  err = validateTypes(payload.sign, {owner:'s',sig:'s'})
  if (err){ warn('bad input sign '+err); return }
  if (! stopReporting[payload.target]){
    warn('Bad upGossip. We did not see this node in the lost field, but got a up msg from it; ignoring it')
    return
  }
  let [valid, reason] = checkQuarter(payload.target, sender)
  if (!valid){
    warn(`Bad upGossip message. reason:${reason} message:${JSON.stringify(payload)}`)
    return
  }
  const key = `${payload.target}-${payload.cycle}`
  const rec = lost.get(key)
  if (rec && rec.status === 'up') return // we have already gossiped this node for this cycle
  [valid, reason] = checkUpMsg(payload, currentCycle)
  if (!valid){
    warn(`Bad upGossip message. reason:${reason} message:${JSON.stringify(payload)}`)
    return
  }
  let obj = {target:payload.target, status:'up', cycle:payload.cycle, message:payload}
  lost.set(key, obj)
  Comms.sendGossip('lost-up', payload, tracker, Self.id, byIdOrder, false)
// the getTxs() function will loop through the lost object to make txs in Q3 and build the cycle record from them
}

function checkUpMsg(payload:P2P.LostTypes.SignedUpGossipMessage, expectedCycle){
  if (!nodes.has(payload.target)) return [false, `target is not an active node  ${payload.target}  ${JSON.stringify(activeByIdOrder)}`]
  if (!crypto.verify(payload, nodes.get(payload.target).publicKey)) return [false, 'bad sign from target']
  return [true, '']
}

function info(...msg) {
  const entry = `Lost: ${msg.join(' ')}`
  p2pLogger.info(entry)
}

function warn(...msg) {
  const entry = `Lost: ${msg.join(' ')}`
  p2pLogger.warn(entry)
}

function error(...msg) {
  const entry = `Lost: ${msg.join(' ')}`
  p2pLogger.error(entry)
}
