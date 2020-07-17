import deepmerge from 'deepmerge'
import { Logger } from 'log4js'
import * as utils from '../utils'
// don't forget to add new modules here
import * as Active from './Active'
import * as Apoptosis from './Apoptosis'
import * as Archivers from './Archivers'
import * as Comms from './Comms'
import { config, crypto, logger, storage } from './Context'
import * as CycleChain from './CycleChain'
import * as Join from './Join'
import * as Lost from './Lost'
import * as NodeList from './NodeList'
import * as Refresh from './Refresh'
import * as Rotation from './Rotation'
import * as SafetyMode from './SafetyMode'
import * as Self from './Self'
import * as Sync from './Sync'
import { GossipHandler, InternalHandler, SignedObject } from './Types'
import { compareQuery, Comparison } from './Utils'

/** TYPES */

export type CycleMarker = string

export interface CycleCert extends SignedObject {
  marker: CycleMarker
  score?: number
}

interface BaseRecord {
  networkId: string
  counter: number
  previous: string
  start: number
  duration: number
}

// don't forget to add new modules here
export type CycleTxs = SafetyMode.Txs &
  Refresh.Txs &
  Archivers.Txs &
  Join.Txs &
  Active.Txs &
  Apoptosis.Txs &
  Lost.Txs &
  Rotation.Txs

// don't forget to add new modules here
export type CycleRecord = BaseRecord &
  SafetyMode.Record &
  Refresh.Record &
  Archivers.Record &
  Join.Record &
  Active.Record &
  Apoptosis.Record &
  Lost.Record &
  Rotation.Record & {
    joined: string[]
    returned: string[]
    lost: string[]
    refuted: string[]
    apoptosized: string[]
  }

export type CycleData = CycleRecord & {
  marker: CycleMarker
  certificate: CycleCert
}

/** CONSTANTS */

const SECOND = 1000
const BEST_CERTS_WANTED = 2
const DESIRED_CERT_MATCHES = 2
const DESIRED_MARKER_MATCHES = 2

/** STATE */

let p2pLogger: Logger
let cycleLogger: Logger

// don't forget to add new modules here
//   need to keep the Lost module after the Apoptosis module
export const submodules = [
  Archivers,
  Join,
  Active,
  Rotation,
  Refresh,
  Apoptosis,
  Lost,
  SafetyMode,
]

export let currentQuarter = -1 // means we have not started creating cycles
export let currentCycle = 0
export let nextQ1Start = 0

let madeCycle = false // True if we successfully created the last cycle record, otherwise false
// not used anymore
//let madeCert = false // set to True after we make our own cert and try to gossip it

let txs: CycleTxs
let record: CycleRecord
let marker: CycleMarker
let cert: CycleCert

let bestRecord: CycleRecord
let bestMarker: CycleMarker
let bestCycleCert: Map<CycleMarker, CycleCert[]>
let bestCertScore: Map<CycleMarker, number>

const timers = {}

// Keeps track of the last saved record in the DB in order to update it
let lastSavedData: CycleRecord

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
  const req = payload
  respond(compareCycleMarkersEndpoint(req))
}

const compareCertRoute: InternalHandler<
  CompareCertReq,
  CompareCertRes,
  NodeList.Node['id']
> = (payload, respond, sender) => {
  respond(compareCycleCertEndpoint(payload, sender))
}

const gossipCertRoute: GossipHandler<CompareCertReq, NodeList.Node['id']> = (
  payload,
  sender
) => {
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
  // Init submodules
  for (const submodule of submodules) {
    if (submodule.init) submodule.init()
  }

  // Get a handle to write to p2p.log
  p2pLogger = logger.getLogger('p2p')
  cycleLogger = logger.getLogger('cycle')

  // Init state
  reset()

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
  // Reset submodules
  for (const module of submodules) module.reset()

  // Reset CycleCreator
  txs = collectCycleTxs()
  ;({ record, marker, cert } = makeCycleData(
    txs,
    CycleChain.newest || undefined
  ))

  bestRecord = undefined
  bestMarker = undefined
  bestCycleCert = new Map()
  bestCertScore = new Map()
}

/**
 * Entrypoint for cycle record creation. Sets things up then kicks off the
 * scheduler (cycleCreator) to start scheduling the callbacks for cycle record
 * creation.
 */
export async function startCycles() {
  if (Self.isFirst) {
    // If first node, create cycle record 0, set bestRecord to it
    const recordZero = makeRecordZero()
    bestRecord = recordZero
    madeCycle = true

    // Schedule the scheduler to run at cycle zero start
    const { startQ1 } = calcIncomingTimes(recordZero)
    await schedule(cycleCreator, startQ1)

    return
  }

  // Otherwise, set bestRecord to newest record in cycle chain
  bestRecord = CycleChain.newest
  madeCycle = true

  await cycleCreator()
}

/**
 * Schedules itself to run at the start of each cycle, and schedules callbacks
 * to run for every quarter of the cycle.
 */
async function cycleCreator() {
  // Set current quater to 0 while we are setting up the previous record
  //   Routes should use this to not process and just single-forward gossip
  currentQuarter = 0
  info(`C${currentCycle} Q${currentQuarter}`)
  info(`madeCycle: ${madeCycle} bestMarker: ${bestMarker}`)
  // Get the previous record
  //let prevRecord = madeCycle ? bestRecord : await fetchLatestRecord()
  let prevRecord = bestRecord
  if (!prevRecord) {
    prevRecord = await fetchLatestRecord()
  }
  while (!prevRecord) {
    // [TODO] - when there are few nodes in the network, we may not
    //          be able to get a previous record since the number of
    //          matches for robust query may not be met. Maybe we should
    //          count the number of tries and lower the number of matches
    //          needed if the number of tries increases.
    warn(
      'CycleCreator: cycleCreator: Could not get prevRecord. Trying again in 1 sec...'
    )
    await utils.sleep(1 * SECOND)
    prevRecord = await fetchLatestRecord()
  }

  // Apply the previous records changes to the NodeList
  //if (madeCycle) {
  if (!CycleChain.newest || CycleChain.newest.counter < prevRecord.counter)
    Sync.digestCycle(prevRecord)
  //}

  // Save the previous record to the DB
  const marker = makeCycleMarker(prevRecord)
  const certificate = makeCycleCert(marker)
  const data: CycleData = { ...prevRecord, marker, certificate }
  if (lastSavedData) {
    await storage.updateCycle({ networkId: lastSavedData.networkId }, data)
    lastSavedData = data
  } else {
    await storage.addCycles({ ...prevRecord, marker, certificate })
    lastSavedData = data
  }

  Self.emitter.emit('new_cycle_data', data)

  // Print combined cycle log entry
  cycleLogger.info(CycleChain.getDebug() + NodeList.getDebug())

  // Prune the cycle chain
  pruneCycleChain()

  // Send last record to any subscribed archivers
  Archivers.sendData()
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

  nextQ1Start = end

  // Reset cycle marker and cycle certificate creation state
  reset()
  // Omar moved this to before scheduling the quarters; should not make a difference
  madeCycle = false

  schedule(runQ1, startQ1, { runEvenIfLateBy: quarterDuration - 1 * SECOND }) // if there's at least one sec before Q2 starts, we can start Q1 now
  schedule(runQ2, startQ2)
  schedule(runQ3, startQ3)
  schedule(runQ4, startQ4)
  schedule(cycleCreator, end, { runEvenIfLateBy: Infinity })
}

/**
 * Handles cycle record creation tasks for quarter 1
 */
function runQ1() {
  currentQuarter = 1
  Self.emitter.emit('cycle_q1_start')
  info(`C${currentCycle} Q${currentQuarter}`)

  // Tell submodules to sign and send their requests
  info('Triggering submodules to send requests...')
  for (const submodule of submodules) submodule.sendRequests()
}

/**
 * Handles cycle record creation tasks for quarter 2
 */
function runQ2() {
  currentQuarter = 2
  Self.emitter.emit('cycle_q2_start')
  info(`C${currentCycle} Q${currentQuarter}`)
}

/**
 * Handles cycle record creation tasks for quarter 3
 */
/*
[TODO] - might need to change how nodes compare cycle markers in Q3.
  Noticed a problem where if a node is lost in Q2 and all nodes in
  the network try to do a compare with this node, they all slowed down
  and are not able to make a cycle record/marker and thus all try to
  ask others for the missed cycle record, but no one has it, so the
  network progress stops.
  We should just do a robust query for the cycle marker and go with
  the one that was most commonly used, otherwise just use what we
  created, so that a slow node cannot prevent us from making our
  marker. But rather than use cycle marker we should use set of
  txhashes to make it easier to find which txs are being applied.

  During Q1 and Q2 nodes build a list of valid txs they have seen.
  At the start of Q3 they generate a hash of all the txs they have seen.
  The cycle tx_hash is a hash of all the hashes of each valid tx
  the node has seen and validated. If the node is queried for the
  cycle_tx_hash it returns this even if sees and adds new txs to
  the list of txs the node has seen and validated.
  During Q3 the node does a robust query to get the most common
  cycle_tx_hash and queries the node that provided it to get the
  associated txs. The node validates these transactions and if
  any one of the txs is invalid it does not use what it got from
  the query. Otherwise as long as 2 or more nodes provided the
  cycle_tx_hash it switches to using this.
  Once the node has decided on the cycle_tx_hash it generates
  the a cycle_tx_hash_vote by signing the cycle_tx_hash and gossips
  that to other nodes. A node can only sign one cycle_tx_hash. If
  it tries to sign more than one it can be punished and all votes
  it submitted are ignored. The vote value is determined using
  XOR of the node_id hash and the cycle_tx_hash. A cycle_cert is
  created by combining the 3 highest value votes for a cycle_tx_hash.
  A node regossips if the gossip it received improved the value
  of the cert for the given cycle_tx_hash. The node regossips the
  all or up to the 3 best votes it has for the cycle tx_hash.
  The node also uses robust query to compare the best cycle_cert
  it has with other nodes.
*/
async function runQ3() {
  currentQuarter = 3
  Self.emitter.emit('cycle_q3_start')
  info(`C${currentCycle} Q${currentQuarter}`)

  // Get txs and create this cycle's record, marker, and cert
  txs = collectCycleTxs()
  ;({ record, marker, cert } = makeCycleData(txs, CycleChain.newest))

  /*
  info(`
    Original cycle txs: ${JSON.stringify(txs)}
    Original cycle record: ${JSON.stringify(record)}
    Original cycle marker: ${JSON.stringify(marker)}
    Original cycle cert: ${JSON.stringify(cert)}
  `)
  */

  // Compare this cycle's marker with the network
  const myC = currentCycle
  const myQ = currentQuarter

  // Omar - decided that we can get by with not doing a round of compareCycleMarkers
  //     and instead going straight to comparing cycle certificates.
  /*
  const matched = await compareCycleMarkers(myC, myQ, DESIRED_MARKER_MATCHES)
  if (!matched){
    warn(`In Q3 no match from compareCycleMarker with DESIRED_MARKER_MATCHES of ${DESIRED_MARKER_MATCHES}`)
    return
  }
  if (cycleQuarterChanged(myC, myQ)){
    warn(`In Q3 ran out of time waiting for match from compareCycleMarker`)
    return
  }

  info(`
    Compared cycle txs: ${JSON.stringify(txs)}
    Compared cycle record: ${JSON.stringify(record)}
    Compared cycle marker: ${JSON.stringify(marker)}
    Compared cycle cert: ${JSON.stringify(cert)}
  `)
  */

  madeCycle = true

  // Gossip your cert for this cycle with the network
  gossipMyCycleCert()
}

/**
 * Handles cycle record creation tasks for quarter 4
 */
async function runQ4() {
  currentQuarter = 4
  info(`C${currentCycle} Q${currentQuarter}`)

  // Don't do cert comparison if you didn't make the cycle
  // [TODO] - maybe we should still compare if we have bestCert since we may have got it from gossip
  if (madeCycle === false) {
    warn('In Q4 nothing to do since we madeCycle is false.')
    return
  }

  // Compare your cert for this cycle with the network
  const myC = currentCycle
  const myQ = currentQuarter

  let matched
  do {
    matched = await compareCycleCert(myC, myQ, DESIRED_CERT_MATCHES)
    if (!matched) {
      if (cycleQuarterChanged(myC, myQ)) {
        warn(
          `In Q4 ran out of time waiting for compareCycleCert with DESIRED_CERT_MATCHES of ${DESIRED_CERT_MATCHES}`
        )
        return
      }
      await utils.sleep(100)
    }
  } while (!matched)

  info(`
    Certified cycle record: ${JSON.stringify(record)}
    Certified cycle marker: ${JSON.stringify(marker)}
    Certified cycle cert: ${JSON.stringify(cert)}
  `)

  // Dont need this any more since we are not doing anything after this
  // if (cycleQuarterChanged(myC, myQ)) return
}

/** HELPER FUNCTIONS */

export function makeRecordZero(): CycleRecord {
  const txs = collectCycleTxs()
  return makeCycleRecord(txs)
}

function makeCycleData(txs: CycleTxs, prevRecord?: CycleRecord) {
  const record = makeCycleRecord(txs, prevRecord)
  const marker = makeCycleMarker(record)
  const cert = makeCycleCert(marker)
  return { record, marker, cert }
}

function collectCycleTxs(): CycleTxs {
  // Collect cycle txs from all submodules
  const txs = submodules.map((submodule) => submodule.getTxs())
  return Object.assign({}, ...txs)
}

function makeCycleRecord(
  cycleTxs: CycleTxs,
  prevRecord?: CycleRecord
): CycleRecord {
  const baseRecord: BaseRecord = {
    networkId: crypto.hash({ rand: Math.floor(Math.random() * 1000000) }),
    counter: prevRecord ? prevRecord.counter + 1 : 0,
    previous: prevRecord ? makeCycleMarker(prevRecord) : '0'.repeat(64),
    start: prevRecord
      ? prevRecord.start + prevRecord.duration
      : utils.getTime('s'),
    duration: prevRecord ? prevRecord.duration : config.p2p.cycleDuration,
  }

  const cycleRecord = Object.assign(baseRecord, {
    joined: [],
    returned: [],
    lost: [],
    refuted: [],
    apoptosized: [],
  }) as CycleRecord

  submodules.map((submodule) =>
    submodule.updateRecord(cycleTxs, cycleRecord, prevRecord)
  )

  return cycleRecord
}

export function makeCycleMarker(record: CycleRecord) {
  return crypto.hash(record)
}

function makeCycleCert(marker: CycleMarker): CycleCert {
  return crypto.sign({ marker })
}

async function compareCycleMarkers(myC: number, myQ: number, desired: number) {
  info('Comparing cycle markers...')

  // Init vars
  let matches = 0

  // Get random nodes
  // [TODO] Use a randomShifted array
  const nodes = utils.getRandom(NodeList.activeOthersByIdOrder, 2 * desired)

  for (const node of nodes) {
    // Send marker, txs to /compare-marker endpoint of another node
    const req: CompareMarkerReq = { marker, txs }
    const resp: CompareMarkerRes = await Comms.ask(node, 'compare-marker', req)

    /**
     * [IMPORTANT] Don't change things if the awaited call took too long
     */
    if (cycleQuarterChanged(myC, myQ)) return false

    if (resp) {
      if (resp.marker === marker) {
        // Increment our matches if they computed the same marker
        matches++

        // Done if desired matches reached
        if (matches >= desired) {
          return true
        }
      } else if (resp.txs) {
        // Otherwise, Get missed CycleTxs
        const unseen = unseenTxs(txs, resp.txs)
        const validUnseen = dropInvalidTxs(unseen)

        // Update this cycle's txs, record, marker, and cert
        txs = deepmerge(txs, validUnseen)
        ;({ record, marker, cert } = makeCycleData(txs, CycleChain.newest))
      }
    }
  }

  return true
}

// This is not being used anymore. If we decide to use it, be sure to validate the inputs.
function compareCycleMarkersEndpoint(req: CompareMarkerReq): CompareMarkerRes {
  // If your markers matches, just send back a marker
  if (req.marker === marker) {
    return { marker }
  }

  // Get txs they have that you missed
  const unseen = unseenTxs(txs, req.txs)
  const validUnseen = dropInvalidTxs(unseen)
  if (Object.entries(validUnseen).length < 1) {
    // If there are no txs they have that you missed, send back marker + txs
    return { marker, txs }
  }

  // Update this cycle's txs, record, marker, and cert
  txs = deepmerge(txs, validUnseen)
  ;({ record, marker, cert } = makeCycleData(txs, CycleChain.newest))

  // If your newly computed marker matches, just send back a marker
  if (req.marker === marker) {
    return { marker }
  }

  // They had txs you missed, you added them, and markers still don't match
  // Send back your marker + txs (they are probably missing some)
  return { marker, txs }
}

function unseenTxs(ours: CycleTxs, theirs: CycleTxs) {
  const unseen: Partial<CycleTxs> = {}

  for (const field in theirs) {
    if (theirs[field] && ours[field]) {
      if (crypto.hash(theirs[field]) !== crypto.hash(ours[field])) {
        // Go through each tx of theirs and see if ours has it
        const ourTxHashes = new Set(ours[field].map((tx) => crypto.hash(tx)))
        for (const tx of theirs[field]) {
          if (!ourTxHashes.has(crypto.hash(tx))) {
            // If it doesn't, add it to unseen
            if (!unseen[field]) unseen[field] = []
            unseen[field].push(tx)
          }
        }
      }
    } else {
      // Add the whole field from theirs to unseen
      unseen[field] = theirs[field]
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
      warn('CycleCreator: fetchLatestRecord: synced record not newer')
      return null
    }
  } catch (err) {
    warn('CycleCreator: fetchLatestRecord: syncNewCycles failed:', err)
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
export function schedule<T, U extends unknown[]>(
  callback: (...args: U) => T | Promise<T>,
  time: number,
  { runEvenIfLateBy = 0 } = {},
  ...args: U
) {
  return new Promise((resolve) => {
    const now = Date.now()
    if (now >= time) {
      if (now - time <= runEvenIfLateBy) {
        setImmediate(async () => {
          await callback(...args)
          resolve()
        })
      }
      return
    }
    const toWait = time - now
    if (timers[callback.name]) clearTimeout(timers[callback.name])
    timers[callback.name] = setTimeout(async () => {
      await callback(...args)
      resolve()
    }, toWait)
  })
}

export function shutdown() {
  warn('Cycle creator shutdown')
  for (const timer of Object.keys(timers)) {
    warn(`clearing timer ${timer}`)
    clearTimeout(timers[timer])
  }
  warn(`current cycle and quarter is: C${currentCycle} Q${currentQuarter}`)
  currentCycle += 1
  currentQuarter = 0 // to stop functions which check if we are in the same quarter
  warn(`changed cycle and quarter to: C${currentCycle} Q${currentQuarter}`)
}

function cycleQuarterChanged(cycle: number, quarter: number) {
  return cycle !== currentCycle || quarter !== currentQuarter
}

function scoreCert(cert: CycleCert): number {
  try {
    const id = NodeList.byPubKey.get(cert.sign.owner).id // get node id from cert pub key
    const hid = crypto.hash({ id }) // Omar - use hash of id so the cert is not made by nodes that are near based on node id
    const out = utils.XOR(cert.marker, hid)
    return out
  } catch (err) {
    error('scoreCert ERR:', err)
    return 0
  }
}

function validateCertSign(certs: CycleCert[], sender: NodeList.Node['id']) {
  for (const cert of certs) {
    const cleanCert: CycleCert = {
      marker: cert.marker,
      sign: cert.sign,
    }
    if (NodeList.byPubKey.has(cleanCert.sign.owner) === false) {
      warn('validateCertSign: bad owner')
      return false
    }
    if (!crypto.verify(cleanCert)) {
      warn('validateCertSign: bad sig')
      return false
    }
  }
  return true
}

function validateCerts(certs: CycleCert[], record, sender) {
  if (!certs || !Array.isArray(certs) || certs.length <= 0) {
    warn('validateCerts: bad certificate format')
    warn(
      `validateCerts:   sent by: port:${
        NodeList.nodes.get(sender).externalPort
      } id:${JSON.stringify(sender)}`
    )
    return false
  }
  if (!record || record === null || typeof record !== 'object') return false
  //  make sure the cycle counter is what we expect
  if (record.counter !== CycleChain.newest.counter + 1) {
    warn(
      `validateCerts: bad cycle record counter; expected ${
        CycleChain.newest.counter + 1
      } but got ${record.counter}`
    )
    warn(
      `validateCerts:   sent by: port:${
        NodeList.nodes.get(sender).externalPort
      } id:${JSON.stringify(sender)}`
    )
    return false
  }
  // make sure all the certs are for the same cycle marker
  const inpMarker = crypto.hash(record)
  for (let i = 1; i < certs.length; i++) {
    if (inpMarker !== certs[i].marker) {
      warn('validateCerts: certificates marker does not match hash of record')
      warn(
        `validateCerts:   sent by: port:${
          NodeList.nodes.get(sender).externalPort
        } id:${JSON.stringify(sender)}`
      )
      return false
    }
  }
  // make sure that the certs are from different owners and not the same node
  const seen = {}
  for (let i = 0; i < certs.length; i++) {
    if (seen[certs[i].sign.owner]) {
      warn(
        `validateCerts: multiple certificate from same owner ${JSON.stringify(
          certs
        )}`
      )
      warn(
        `validateCerts:   sent by: port:${
          NodeList.nodes.get(sender).externalPort
        } id:${JSON.stringify(sender)}`
      )
      return false
    }
    seen[certs[i].sign.owner] = true
  }
  //  checks signatures; more expensive
  if (!validateCertSign(certs, sender)) {
    warn(
      `validateCerts: certificate has bad sign; certs:${JSON.stringify(certs)}`
    )
    warn(
      `validateCerts:   sent by: port:${
        NodeList.nodes.get(sender).externalPort
      } id:${JSON.stringify(sender)}`
    )
    return false
  }
  return true
}

function validateCertsRecordTypes(inp, caller) {
  let err = utils.validateTypes(inp, { certs: 'a', record: 'o' })
  if (err) {
    warn(caller + ' bad input: ' + err + ' ' + JSON.stringify(inp))
    return false
  }
  for (const cert of inp.certs) {
    err = utils.validateTypes(cert, { marker: 's', score: 'n', sign: 'o' })
    if (err) {
      warn(caller + ' bad input.certs: ' + err)
      return false
    }
    err = utils.validateTypes(cert.sign, { owner: 's', sig: 's' })
    if (err) {
      warn(caller + ' bad input.sign: ' + err)
      return false
    }
  }
  err = utils.validateTypes(inp.record, {
    activated: 'a',
    activatedPublicKeys: 'a',
    active: 'n',
    apoptosized: 'a',
    counter: 'n',
    desired: 'n',
    duration: 'n',
    expired: 'n',
    joined: 'a',
    joinedArchivers: 'a',
    joinedConsensors: 'a',
    lost: 'a',
    previous: 's',
    refreshedArchivers: 'a',
    refreshedConsensors: 'a',
    refuted: 'a',
    removed: 'a',
    start: 'n',
    syncing: 'n',
  })
  if (err) {
    warn(caller + ' bad input.record: ' + err)
    return false
  }
  //  submodules need to validate their part of the record
  for (const submodule of submodules) {
    err = submodule.validateRecordTypes(inp.record)
    if (err) {
      warn(caller + ' bad input.record.* ' + err)
      return false
    }
  }
  return true
}

// Given an array of valid cycle certs, go through them and see if we can improve our best cert
// return true if we improved it
// We assume the certs have already been checked
function improveBestCert(inpCerts: CycleCert[], inpRecord) {
  //  warn(`improveBestCert: certs:${JSON.stringify(certs)}`)
  //  warn(`improveBestCert: record:${JSON.stringify(record)}`)
  let improved = false
  if (inpCerts.length <= 0) {
    return false
  }
  let bscore = 0
  if (bestMarker) {
    if (bestCertScore.get(bestMarker)) {
      bscore = bestCertScore.get(bestMarker)
    }
  }
  //  warn(`improveBestCert: bscore:${JSON.stringify(bscore)}`)
  const bcerts = bestCycleCert.get(inpCerts[0].marker)
  //  warn(`improveBestCert: bcerts:${JSON.stringify(bcerts)}`)
  const have = {}
  if (bcerts) {
    for (const cert of bcerts) {
      have[cert.sign.owner] = true
    }
  }
  //  warn(`improveBestCert: have:${JSON.stringify(have)}`)
  for (const cert of inpCerts) {
    // make sure we don't store more than one cert from the same owner with the same marker
    if (have[cert.sign.owner]) continue
    cert.score = scoreCert(cert)
    if (!bestCycleCert.get(cert.marker)) {
      bestCycleCert.set(cert.marker, [cert])
    } else {
      let added = false
      const bcerts = bestCycleCert.get(cert.marker)
      let i = 0
      for (; i < bcerts.length; i++) {
        if (bcerts[i].score < cert.score) {
          bcerts.splice(i, 0, cert)
          bcerts.splice(BEST_CERTS_WANTED)
          added = true
          break
        }
      }
      if (!added && i < BEST_CERTS_WANTED) {
        bcerts.splice(i, 0, cert)
      }
    }
  }
  for (const cert of inpCerts) {
    let score = 0
    const bcerts = bestCycleCert.get(cert.marker)
    for (const bcert of bcerts) {
      score += bcert.score
    }
    bestCertScore.set(cert.marker, score)
    if (score > bscore) {
      bestMarker = cert.marker
      bestRecord = inpRecord
      improved = true
    }
  }
  //  info(`improveBestCert: bestScore:${bestCertScore.get(bestMarker)}`)
  //  info(`improveBestCert: bestMarker:${bestMarker}`)
  //  info(`improveBestCert: bestCerts:${JSON.stringify(bestCycleCert.get(bestMarker))}`)
  //  info(`improveBestCert: improved:${improved}`)
  return improved
}

function compareCycleCertEndpoint(inp: CompareCertReq, sender) {
  if (bestMarker === undefined) {
    // This should almost never happen since we generate and gossip our
    //   cert at the begining of Q3 and don't start comparing certs until
    //   the begining of Q4.
    warn('compareCycleCertEndpoint - bestMarker is undefined')
    return { certs: [], record: record } // receiving node will igore our response
  }

  if (!validateCertsRecordTypes(inp, 'compareCycleCertEndpoint')) {
    return { certs: bestCycleCert.get(bestMarker), record: bestRecord }
  }
  const { certs: inpCerts, record: inpRecord } = inp
  if (!validateCerts(inpCerts, inpRecord, sender)) {
    return { certs: bestCycleCert.get(bestMarker), record: bestRecord }
  }
  const inpMarker = inpCerts[0].marker
  if (inpMarker !== makeCycleMarker(inpRecord)) {
    return { certs: bestCycleCert.get(bestMarker), record: bestRecord }
  }
  improveBestCert(inpCerts, inpRecord)
  return { certs: bestCycleCert.get(bestMarker), record: bestRecord }
}

async function compareCycleCert(myC: number, myQ: number, matches: number) {
  const queryFn = async (
    node: NodeList.Node
  ): Promise<[CompareCertRes, NodeList.Node]> => {
    const req: CompareCertReq = {
      certs: bestCycleCert.get(bestMarker),
      record: bestRecord,
    }
    const resp: CompareCertRes = await Comms.ask(node, 'compare-cert', req) // NEED to set the route string
    if (!validateCertsRecordTypes(resp, 'compareCycleCert')) return [null, node]
    // [TODO] - submodules need to validate their part of the record
    if (!(resp && resp.certs && resp.certs[0].marker && resp.record)) {
      throw new Error('compareCycleCert: Invalid query response')
    }
    return [resp, node]
  }

  const compareFn = (respArr) => {
    /**
     * [IMPORTANT] Don't change things if the awaited call took too long
     */
    if (cycleQuarterChanged(myC, myQ)) return Comparison.ABORT

    const [resp, node] = respArr
    if (resp === null) return Comparison.WORSE
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

  /**
   * [NOTE] The number of nodesToAsk should be limited based on the amount of
   * time we have in the quarter
   */
  // We shuffle to spread out the network load of cert comparison
  const nodesToAsk = [...NodeList.activeOthersByIdOrder]
  utils.shuffleArray(nodesToAsk)

  // If anything compares better than us, compareQuery starts over
  const errors = await compareQuery<
    NodeList.Node,
    [CompareCertRes, NodeList.Node]
  >(NodeList.activeOthersByIdOrder, queryFn, compareFn, matches)

  if (errors.length > 0) {
    warn(`compareCycleCertEndpoint: errors: ${JSON.stringify(errors)}`)
  }

  // Anything that's not an error, either matched us or compared worse than us
  return NodeList.activeOthersByIdOrder.length - errors.length >= matches
}

async function gossipMyCycleCert() {
  // If we're not active dont gossip, unless we are first
  if (!Self.isActive && !Self.isFirst) return

  // We may have already received certs from other other nodes so gossip only if our cert improves it
  // madeCert = true  // not used
  info('About to improveBestCert with our cert...')
  if (improveBestCert([cert], record)) {
    // don't need the following line anymore since improveBestCert sets bestRecord if it improved
    // bestRecord = record
    info('bestRecord was set to our record')
    await gossipCycleCert()
  }
}

function gossipHandlerCycleCert(
  inp: CompareCertReq,
  sender: NodeList.Node['id']
) {
  if (!validateCertsRecordTypes(inp, 'gossipHandlerCycleCert')) return
  // [TODO] - submodules need to validate their part of the record
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
    certs: bestCycleCert.get(bestMarker),
    record: bestRecord,
  }
  Comms.sendGossip('gossip-cert', certGossip)
}

function pruneCycleChain() {
  // Determine number of cycle records to keep
  const keep = Refresh.cyclesToKeep()
  // Throws away extra cycles
  CycleChain.prune(keep)
}

function info(...msg) {
  const entry = `CycleCreator: ${msg.join(' ')}`
  p2pLogger.info(entry)
}

function warn(...msg) {
  const entry = `CycleCreator: ${msg.join(' ')}`
  p2pLogger.warn(entry)
}

function error(...msg) {
  const entry = `CycleCreator: ${msg.join(' ')}`
  p2pLogger.error(entry)
}
