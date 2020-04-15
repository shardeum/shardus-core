import deepmerge from 'deepmerge'
import { Logger } from 'log4js'
import * as utils from '../utils'
import * as Active from './Active'
import * as Comms from './Comms'
import { config, crypto, logger } from './Context'
import * as CycleChain from './CycleChain'
import * as Join from './Join'
import { JoinedArchiver } from './Join'
import * as NodeList from './NodeList'
import * as Sync from './Sync'
import { GossipHandler, InternalHandler, SignedObject } from './Types'
import { compareQuery, Comparison } from './Utils'
import { Node } from './p2p-state'
import { send } from 'shardus-net/build/src/net'

/** TYPES */

export type CycleMarker = string

export interface CycleCert extends SignedObject {
  marker: CycleMarker
  score?: number
}

interface BaseRecord {
  counter: number
  previous: string
  start: number
  duration: number
}

export type CycleTxs = Join.Txs & Active.Txs

export type CycleRecord = BaseRecord &
  Join.Record &
  Active.Record & {
    desired: number
    expired: number
    joined: string[]
    joinedArchivers: JoinedArchiver[]
    removed: string[]
    returned: string[]
    lost: string[]
    refuted: string[]
    apoptosized: string[]
  }

/** CONSTANTS */

const SECOND = 1000
const BEST_CERTS_WANTED = 2
const DESIRED_CERT_MATCHES = 2
const DESIRED_MARKER_MATCHES = 2

/** STATE */

let mainLogger: Logger
let cycleLogger: Logger

export const submodules = [Join, Active]

let currentQuarter = 0
let currentCycle = 0
let madeCycle = true // True if we successfully created the last cycle record, otherwise false
let madeCert = false // set to True after we make our own cert and try to gossip it

let txs: CycleTxs
let record: CycleRecord
let marker: CycleMarker
let cert: CycleCert
let bestRecord: CycleRecord
let bestMarker: CycleMarker
let bestCycleCert: Map<CycleMarker, CycleCert[]> = new Map()
let bestCertScore: Map<CycleMarker, number> = new Map()

/** ROUTES */

interface CompareMarkerReq {
  marker: CycleMarker
  txs: CycleTxs
}
interface CompareMarkerRes {
  marker: CycleMarker
  txs?: CycleTxs
}

interface CompareCertReq {
  certs: CycleCert[]
  record: CycleRecord
}
interface CompareCertRes {
  certs: CycleCert[]
  record: CycleRecord
}

const compareMarkerRoute: InternalHandler<
  CompareMarkerReq,
  CompareMarkerRes
> = (payload, respond, sender) => {
  // [TODO] validate input
  const req = payload

  // If your markers matches, just send back a marker
  if (req.marker === marker) {
    respond({ marker })
    return
  }

  // Get txs they have that you missed
  const unseen = unseenTxs(txs, req.txs)
  const validUnseen = dropInvalidTxs(unseen)
  if (Object.entries(validUnseen).length < 1) {
    // If there are no txs they have that you missed, send back marker + txs
    respond({ marker, txs })
    return
  }

  // Update this cycle's txs, record, marker, and cert
  txs = deepmerge(txs, validUnseen)
  ;({ record, marker, cert } = makeCycleData(CycleChain.newest))

  // If your newly computed marker matches, just send back a marker
  if (req.marker === marker) {
    respond({ marker })
    return
  }

  // They had txs you missed, you added them, and markers still don't match
  // Send back your marker + txs (they are probably missing some)
  respond({ marker, txs })
}

const compareCertRoute: InternalHandler<CompareCertReq, CompareCertRes, NodeList.Node['id']> = (
  payload,
  respond,
  sender
) => {
  // [TODO] Validate payload
  respond(compareCycleCertEndpoint(payload, sender))
}

const gossipCertRoute: GossipHandler<CompareCertReq, NodeList.Node['id']> = (payload, sender) => {
  gossipHandlerCycleCert(payload, sender)
}

const routes = {
  internal: {
    'compare-marker': compareMarkerRoute,
    'compare-cert': compareCertRoute,
  },
  gossip: {
    'gossip-cert': gossipCertRoute,
  },
}

/** CONTROL FUNCTIONS */

export function init() {
  // Get a handle to write to main.log
  mainLogger = logger.getLogger('main')
  cycleLogger = logger.getLogger('cycle')

  // Register routes
  for (const [name, handler] of Object.entries(routes.internal)) {
    Comms.registerInternal(name, handler)
  }
  for (const [name, handler] of Object.entries(routes.gossip)) {
    Comms.registerGossipHandler(name, handler)
  }
}

// Resets CycleCreator and submodules
function reset() {
  // Reset CycleCreator
  txs = undefined
  record = undefined
  marker = undefined
  cert = undefined

  bestRecord = undefined
  bestMarker = undefined
  bestCycleCert = new Map()
  bestCertScore = new Map()

  // Reset submodules
  for (const module of submodules) module.reset()
}

/**
 * Entrypoint for cycle record creation. Sets things up then kicks off the
 * scheduler (cycleCreator) to start scheduling the callbacks for cycle record
 * creation.
 */
export function startCycles() {
  // start
  cycleCreator()
}

/**
 * Schedules itself to run at the start of each cycle, and schedules callbacks
 * to run for every quarter of the cycle.
 */
async function cycleCreator() {
  // Get the previous record
  let prevRecord = madeCycle ? CycleChain.newest : await fetchLatestRecord()
  while (!prevRecord) {
    warn(
      'CycleCreator: cycleCreator: Could not get prevRecord. Trying again in 1 sec...'
    )
    await utils.sleep(1 * SECOND)
    prevRecord = await fetchLatestRecord()
  }

  // Apply the previous records changes to the NodeList
  if (madeCycle) {
    Sync.digestCycle(prevRecord)
  }

  ;({
    cycle: currentCycle,
    quarter: currentQuarter,
  } = currentCycleQuarterByTime(prevRecord))

  const {
    quarterDuration,
    startQ1,
    startQ2,
    startQ3,
    startQ4,
    end,
  } = calcIncomingTimes(prevRecord)

  // Reset cycle marker and cycle certificate creation state
  reset()

  schedule(runQ1, startQ1, { runEvenIfLateBy: quarterDuration - 1 * SECOND }) // if there's at least one sec before Q2 starts, we can start Q1 now
  schedule(runQ2, startQ2)
  schedule(runQ3, startQ3)
  schedule(runQ4, startQ4)
  schedule(cycleCreator, end, { runEvenIfLateBy: Infinity })

  madeCycle = false
}

/**
 * Handles cycle record creation tasks for quarter 1
 */
function runQ1() {
  currentQuarter = 1
  info(`C${currentCycle} Q${currentQuarter}`)
}

/**
 * Handles cycle record creation tasks for quarter 2
 */
function runQ2() {
  currentQuarter = 2
  info(`C${currentCycle} Q${currentQuarter}`)
}

/**
 * Handles cycle record creation tasks for quarter 3
 */
async function runQ3() {
  currentQuarter = 3
  info(`C${currentCycle} Q${currentQuarter}`)

  // Get txs and create this cycle's record, marker, and cert
  txs = collectCycleTxs()
  ;({ record, marker, cert } = makeCycleData(CycleChain.newest))

  info(`Created cycle record: ${JSON.stringify(record)}`)
  info(`Created cycle marker: ${JSON.stringify(marker)}`)
  info(`Created cycle cert: ${JSON.stringify(cert)}`)

  // Compare this cycle's marker with the network
  const myC = currentCycle
  const myQ = currentQuarter
  const matched = await compareCycleMarkers(DESIRED_MARKER_MATCHES)
  if (!matched) return
  if (cycleQuarterChanged(myC, myQ)) return

  // Gossip your cert for this cycle with the network
  gossipMyCycleCert()
}

/**
 * Handles cycle record creation tasks for quarter 4
 */
async function runQ4() {
  currentQuarter = 4
  info(`C${currentCycle} Q${currentQuarter}`)

  // Compare your cert for this cycle with the network
  const myC = currentCycle
  const myQ = currentQuarter

  let matched
  do {
    matched = await compareCycleCert(DESIRED_CERT_MATCHES)
    if (!matched) {
      if (cycleQuarterChanged(myC, myQ)) return
      await utils.sleep(100)
    }
  } while (!matched)

  if (cycleQuarterChanged(myC, myQ)) return

  // Save this cycle's record to the CycleChain
  CycleChain.append(record)
  madeCycle = true
}

/** HELPER FUNCTIONS */

export function makeRecordZero(): CycleRecord {
  const txs = collectCycleTxs()
  return makeCycleRecord(txs)
}

function makeCycleData(prevRecord: CycleRecord) {
  const txs = collectCycleTxs()
  const record = makeCycleRecord(txs, prevRecord)
  const marker = makeCycleMarker(record)
  const cert = makeCycleCert(marker)
  return { record, marker, cert }
}

function collectCycleTxs(): CycleTxs {
  // Collect cycle txs from all submodules
  const txs = submodules.map(submodule => submodule.getCycleTxs())
  return Object.assign({}, ...txs)
}

function makeCycleRecord(
  cycleTxs: CycleTxs,
  prevRecord?: CycleRecord
): CycleRecord {
  const baseRecord: BaseRecord = {
    counter: prevRecord ? prevRecord.counter + 1 : 0,
    previous: prevRecord ? makeCycleMarker(prevRecord) : '0'.repeat(64),
    start: prevRecord
      ? prevRecord.start + prevRecord.duration
      : utils.getTime('s'),
    duration: prevRecord ? prevRecord.duration : config.p2p.cycleDuration,
  }

  const cycleRecord = Object.assign(baseRecord, {
    desired: 0,
    expired: 0,
    joined: [],
    joinedArchivers: [],
    removed: [],
    returned: [],
    lost: [],
    refuted: [],
    apoptosized: [],
  }) as CycleRecord

  submodules.map(submodule =>
    submodule.updateCycleRecord(cycleTxs, cycleRecord, prevRecord)
  )

  return cycleRecord
}

function makeCycleMarker(record: CycleRecord) {
  return crypto.hash(record)
}

function makeCycleCert(marker: CycleMarker): CycleCert {
  return crypto.sign({ marker })
}

async function compareCycleMarkers(desired) {
  // Init vars
  let matches = 0

  // Get random nodes
  const nodes = utils.getRandom(NodeList.activeOthersByIdOrder, 2 * desired)
  if (nodes.length < 2) return true

  for (const node of nodes) {
    // Send marker, txs to /compare-marker endpoint of another node
    const req: CompareMarkerReq = { marker, txs }
    const resp: CompareMarkerRes = await Comms.ask(node, 'compare-marker', req)
    if (resp) {
      if (resp.marker === marker) {
        // Increment our matches if they computed the same marker
        matches++
        if (matches >= desired) return true
      } else if (resp.txs) {
        // Otherwise, Get missed CycleTxs
        const unseen = unseenTxs(resp.txs, txs)
        const validUnseen = dropInvalidTxs(unseen)

        // Update this cycle's txs, record, marker, and cert
        txs = deepmerge(txs, validUnseen)
        ;({ record, marker, cert } = makeCycleData(CycleChain.newest))
      }
    }
  }

  return true
}

function unseenTxs(txs1: CycleTxs, txs2: CycleTxs) {
  const unseen: Partial<CycleTxs> = {}

  for (const field in txs2) {
    if (txs2[field] && txs1[field]) {
      if (crypto.hash(txs2[field]) !== crypto.hash(txs1[field])) {
        // Go through each tx of txs2 and see if txs1 has it
        const txs1Hashes = new Set(txs1[field].map(tx => crypto.hash(tx)))
        for (const tx of txs2[field]) {
          if (!txs1Hashes.has(crypto.hash(tx))) {
            // If it doesn't, add it to unseen
            if (!unseen[field]) unseen[field] = []
            unseen[field].push(tx)
          }
        }
      }
    } else {
      // Add the whole field from txs2 to unseen
      unseen[field] = txs2[field]
    }
  }

  return unseen
}

function dropInvalidTxs(txs: Partial<CycleTxs>) {
  // [TODO] Call into each module to validate its relevant CycleTxs
  return txs
}

/**
 * Syncs the CycleChain to the newest cycle record of the network, and returns
 * the newest cycle record.
 */
async function fetchLatestRecord(): Promise<CycleRecord> {
  try {
    const oldCounter = CycleChain.newest.counter
    await Sync.syncNewCycles(NodeList.activeOthersByIdOrder)
    if (CycleChain.newest.counter <= oldCounter) {
      // We didn't actually sync
      info('CycleCreator: fetchLatestRecord: synced record not newer')
      return null
    }
  } catch (err) {
    info('CycleCreator: fetchLatestRecord: syncNewCycles failed:', err)
    return null
  }
  return CycleChain.newest
}

/**
 * Returns what the current cycle counter and quarter would be from the given
 * cycle record.
 *
 * @param record CycleRecord
 */
function currentCycleQuarterByTime(record: CycleRecord) {
  const SECOND = 1000
  const cycleDuration = record.duration * SECOND
  const quarterDuration = cycleDuration / 4
  const start = record.start * SECOND + cycleDuration

  const now = Date.now()
  const elapsed = now - start
  const elapsedQuarters = elapsed / quarterDuration

  const cycle = record.counter + 1 + Math.trunc(elapsedQuarters / 4)
  const quarter = Math.abs(Math.ceil(elapsedQuarters % 4))
  return { cycle, quarter }
}

/**
 * Returns the timestamp of each quarter and the timestamp of the end of the
 * cycle record AFTER the given cycle record.
 *
 * @param record CycleRecord
 */
function calcIncomingTimes(record: CycleRecord) {
  const cycleDuration = record.duration * SECOND
  const quarterDuration = cycleDuration / 4
  const start = record.start * SECOND + cycleDuration

  const startQ1 = start
  const startQ2 = start + 1 * quarterDuration
  const startQ3 = start + 2 * quarterDuration
  const startQ4 = start + 3 * quarterDuration
  const end = start + cycleDuration

  return { quarterDuration, startQ1, startQ2, startQ3, startQ4, end }
}

/**
 * Schedules a callback to run at a certain time. It will run the callback even
 * if its time has passed, as long as it has not gone past runEvenIfLateBy ms.
 *
 * @param callback
 * @param time
 * @param opts
 * @param args
 */
function schedule<T, U extends unknown[]>(
  callback: (...args: U) => T,
  time: number,
  { runEvenIfLateBy = 0 } = {},
  ...args: U
) {
  const now = Date.now()
  if (now >= time) {
    if (now - time <= runEvenIfLateBy) callback(...args)
    return
  }
  const toWait = time - now
  setTimeout(callback, toWait)
}

function cycleQuarterChanged(cycle: number, quarter: number) {
  return cycle !== currentCycle || quarter !== currentQuarter
}

// Following added by Omar - needs to be checked

function scoreCert(cert: CycleCert): number {
  try {
    const id = NodeList.byPubKey.get(cert.sign.owner).id // get node id from cert pub key
    const out = utils.XOR(cert.marker, id)
    return out
  } catch (err) {
    return 0
  }
}

function validateCertSign(certs: CycleCert[], sender: NodeList.Node['id']) {
  for (const cert of certs) {
    const cleanCert: CycleCert = {
      marker: cert.marker,
      sign: cert.sign
    }
    if (NodeList.byPubKey.has(cleanCert.sign.owner) === false) {
      console.log('DBG', 'bad owner')
      return false
    }
    if (!crypto.verify(cleanCert)) {
      console.log('DBG', 'bad sig')
      return false
    }
  }
  return true
}

function validateCerts(certs: CycleCert[], record, sender) {
  if (!certs || !Array.isArray(certs) || certs.length <= 0) {
    console.log('bad certificate format')
    return false
  }
  // make sure all the certs are for the same cycle marker
  if (!record || !(typeof record === 'object' && record !== null)) return false
  const inpMarker = crypto.hash(record)
  for (let i = 1; i < certs.length; i++) {
    if (inpMarker !== certs[i].marker) {
      console.log('certificates marker does not match hash of record')
      return false
    }
  }
  //  checks signatures; more expensive
  if (!validateCertSign(certs, sender)) {
    console.log('certificate has bad sign')
    return false
  }
  return true
}

// Given an array of cycle certs, go through them and see if we can improve our best cert
// return true if we improved it
function improveBestCert(certs: CycleCert[], record) {
  let improved = false
  if (certs.length <= 0) {
    return false
  }
  let bscore = 0
  if (bestMarker) {
    if (bestCertScore.get(bestMarker)) {
      bscore = bestCertScore.get(bestMarker)
    }
  }
  for (const cert of certs) {
    cert.score = scoreCert(cert)
    if (!bestCycleCert.get(cert.marker)) {
      bestCycleCert.set(cert.marker, [cert])
    } else {
      const bcerts = bestCycleCert.get(cert.marker)
      let added = false
      let i = 0
      for (; i < bcerts.length; i++) {
        if (bcerts[i].score < cert.score) {
          if (bcerts[i].sign.owner !== cert.sign.owner){ // make sure we don't store more than one cert from the same owner with the same marker
            bcerts.splice(i, 0, cert)
            bcerts.splice(BEST_CERTS_WANTED)
            added = true
            break
          }
        }
      }
      if (!added && i < BEST_CERTS_WANTED) {
        bcerts.splice(i, 0, cert)
      }
    }
  }
  for (const cert of certs) {
    let score = 0
    const bcerts = bestCycleCert.get(cert.marker)
    for (const bcert of bcerts) {
      score += bcert.score
    }
    bestCertScore.set(cert.marker, score)
    if (score > bscore) {
      bestMarker = cert.marker
      bestRecord = record
      improved = true
    }
  }
  return improved
}

function compareCycleCertEndpoint(inp: CompareCertReq, sender) {
  // TODO - need to validate the external input; can be done before calling this function
  const { certs: inpCerts, record: inpRecord } = inp
  if (!validateCerts(inpCerts, inpRecord, sender)) {
    return { certs: bestCycleCert.get(marker), record }
  }
  const inpMarker = inpCerts[0].marker
  if (inpMarker !== makeCycleMarker(inpRecord)) {
    return { certs: bestCycleCert.get(marker), record }
  }
  if (improveBestCert(inpCerts, inpRecord)) {
    // don't need the following line anymore since improveBestCert sets bestRecord if it improved
    // bestRecord = inpRecord
  }
  return { certs: bestCycleCert.get(marker), record }
}

async function compareCycleCert(matches: number) {
  const queryFn = async (node: NodeList.Node): Promise<[CompareCertRes, NodeList.Node]> => {
    const req: CompareCertReq = {
      certs: bestCycleCert.get(bestMarker),
      record: bestRecord,
    }
    const resp: CompareCertRes = await Comms.ask(node, 'compare-cert', req) // NEED to set the route string
    // [TODO] Validate resp
    if (!resp || !resp.certs || !resp.certs[0].marker || !resp.record) {
      throw new Error('compareCycleCert: Invalid query response')
    }
    return [resp, node]
  }

  const compareFn = respArr => {
    const [resp, node] = respArr
    if (resp.certs[0].marker === bestMarker) {
      // Our markers match
      return Comparison.EQUAL
    } else if (!validateCerts(resp.certs, resp.record, node.id)) {
      return Comparison.WORSE
    } else if (improveBestCert(resp.certs, resp.record)) {
      // Their marker is better, change to it and their record
      // don't need the following line anymore since improveBestCert sets bestRecord if it improved
      // bestRecord = resp.record
      return Comparison.BETTER
    } else {
      // Their marker was worse
      return Comparison.WORSE
    }
  }

  // Make sure matches makes sense
  if (matches > NodeList.activeOthersByIdOrder.length) {
    matches = NodeList.activeOthersByIdOrder.length
  }

  // If anything compares better than us, compareQuery starts over
  const errors = await compareQuery<NodeList.Node, [CompareCertRes, NodeList.Node]>(
    NodeList.activeOthersByIdOrder,
    queryFn,
    compareFn,
    matches
  )

  warn(`compareCycleCertEndpoint: errors: ${JSON.stringify(errors)}`)

  // Anything that's not an error, either matched us or compared worse than us
  info(`
    NodeList.activeOthersByIdOrder.length - errors.length >= matches
    ${NodeList.activeOthersByIdOrder.length} - ${errors.length} >= ${matches}
  `)
  return NodeList.activeOthersByIdOrder.length - errors.length >= matches
}

// async function compareCycleCert_ORIG(matches: number) {
//   let match = 0
//   let tries = 0
//   if (NodeList.activeOthersByIdOrder.length < matches) {
//     matches = NodeList.activeOthersByIdOrder.length
//   }
//   while (true) {
//     // Make sure matches makes sense
//     const numActive = NodeList.activeOthersByIdOrder.length
//     if (numActive < 1) return true
//     if (matches > numActive) matches = numActive

//     // Get random nodes
//     const nodes = utils.getRandom(NodeList.activeOthersByIdOrder, 2 * matches)
//     if (nodes.length < 2) return true

//     for (const node of nodes) {
//       const req: CompareCertReq = {
//         certs: bestCycleCert.get(bestMarker),
//         record: bestRecord,
//       }
//       const resp: CompareCertRes = await Comms.ask(node, 'compare-cert', req) // NEED to set the route string
//       if (!resp) continue
//       // TODO - validate resp
//       const { certs: inpCerts, record: inpRecord } = resp
//       if (!validateCerts(inpCerts)) continue

//       // Our markers match
//       const inpMarker = inpCerts[0].marker
//       if (inpMarker === bestMarker) match += 1

//       const bestMarkerPrev = bestMarker
//       if (improveBestCert(inpCerts)) {
//         bestRecord = inpRecord
//         // Their marker is better, change to it, and start over
//         if (bestCertScore.get(bestMarkerPrev) < bestCertScore.get(bestMarker)) {
//           match = 1
//           break
//         }
//       }
//     }

//     // We got desired matches
//     if (match >= matches) return true

//     tries += 1

//     // Looped through all nodes and didn't get enough matches
//     if (tries >= nodes.length) {
//       return false
//     }
//   }
// }

async function gossipMyCycleCert() {
  // We may have already received certs from other other nodes so gossip only if our cert improves it
  madeCert = true
  if (improveBestCert([cert], record)) {
    // don't need the following line anymore since improveBestCert sets bestRecord if it improved
    // bestRecord = record
    await gossipCycleCert()
  }
}

function gossipHandlerCycleCert(inp: CompareCertReq, sender: NodeList.Node['id']) {
  // TODO - need to validate the external input; can be done before calling this function
  const { certs: inpCerts, record: inpRecord } = inp
  if (!validateCerts(inpCerts, inpRecord, sender)) {
    return
  }
  if (improveBestCert(inpCerts, inpRecord)) {
    // don't need the following line anymore since improveBestCert sets bestRecord if it improved
    // bestRecord = inpRecord
    gossipCycleCert()
  }
}

// This gossips the best cert we have
async function gossipCycleCert() {
  const certGossip: CompareCertReq = {
    certs: bestCycleCert.get(marker),
    record,
  }
  Comms.sendGossipIn('gossip-cert', certGossip)
}

function info(...msg) {
  const entry = `CycleCreator: ${msg.join(' ')}`
  // mainLogger.info(entry)
  // cycleLogger.info(entry)
  console.log('INFO: ' + entry)
}

function warn(...msg) {
  const entry = `CycleCreator: ${msg.join(' ')}`
  // mainLogger.warn(entry)
  // cycleLogger.info('WARN: ' + entry)
  console.log('WARN: ' + entry)
}

function error(...msg) {
  const entry = `CycleCreator: ${msg.join(' ')}`
  // mainLogger.error(entry)
  // cycleLogger.info('ERROR: ' + entry)
  console.log('ERROR: ' + entry)
}
