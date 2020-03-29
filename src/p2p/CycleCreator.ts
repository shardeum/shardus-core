import * as CycleChain from './CycleChain'
import * as NodeList from './NodeList'
import { Route, GossipHandler, LooseObject } from './Types'
import { log } from 'console'
import { p2p } from './Context'
import { gossipRouteName } from './Apoptosis'
import Logger from '../logger'
import { JoinedArchiver, JoinedConsensor } from './Joining'
import { syncNewCycles, digestCycle } from './Sync'

/** TYPES */

type CycleTx = LooseObject

export type CycleMarker = string

export interface CycleCert extends SignedObject {
  marker: CycleMarker
}

export interface CycleRecord {
  counter: number
  previous: string
  start: number
  duration: number
  active: number
  desired: number
  expired: number
  joined: string[]
  joinedArchivers: JoinedArchiver[]
  joinedConsensors: JoinedConsensor[]
  activated: string[]
  activatedPublicKeys: string[]
  removed: string[]
  returned: string[]
  lost: string[]
  refuted: string[]
  apoptosized: string[]
}

/** STATE */

let currentCycle = 0
let currentQuarter = 0
let cycleTxs: CycleTx[] = [] // array of objects
let cycleRecord: CycleRecord = {} // object
let cycleMarker: CycleMarker = ''
let cycleCert: CycleCert = {} // object: {cycleMarker, {owner, sig}} // the nodeid and score can be computed from owner and cycleMarker
let bestCycleCert: Map<CycleMarker, CycleRecord[]> = new Map() // map of array of objects
let madeCycle = false

const SECOND = 1000
const BEST_CERTS_WANTED = 3
const COMPARE_CYCLE_MARKER = 3
const COMPARE_BEST_CERT = 3

/** ROUTES */

/** FUNCTIONS */

function startCycles() {
  p2p.acceptInternal = true
  cycleCreator()
}

function cycleCreator() {
  currentQuarter = 0 // so that gossip received is regossiped to just one other random node
  const prevRecord = madeCycle ? CycleChain.newest : catchUpCycles(CycleChain.newest)
  if (madeCycle) { applyCycleRecord(prevRecord) }
  [currentCycle, currentQuarter] = calcNextCycleAndQuarter(prevRecord)
  const [timeQ1, timeQ2, timeQ3, timeQ4, timeNextCycle] = calcQuarterTimes(prevRecord)
  if (timeQ2 >= 1 * SECOND) setTimeout(runQ1, 0) // if there at least one sec before Q2 starts, we can start Q1 now
  if (timeQ2 >= 0) setTimeout(runQ2, timeQ2)
  if (timeQ3 >= 0) setTimeout(runQ3, timeQ3)
  if (timeQ4 >= 0) setTimeout(runQ4, timeQ4)
  setTimeout(cycleCreator, timeNextCycle)
  madeCycle = false
  cycleCert = null
}

function runQ1() {
  currentQuarter = 1
  // myQ = currentQuarter
  // myC = currentCycle
}
function runQ2() {
  currentQuarter = 2
  // myQ = currentQuarter
  // myC = currentCycle
}
async function runQ3() {
  currentQuarter = 3
  const myQ = currentQuarter
  const myC = currentCycle
  collectCycleTxs() // cycle transaction modules are expected to provide a getCycleTxs() function
  makeCycleRecord()
  makeCycleMarker()
  await compareCycleMarkers()
  if (! sameQuarter(myC, myQ)) return
  cycleCert = makeCycleCert()
  await gossipCycleCert()
}
async function runQ4() {
  currentQuarter = 4
  const myQ = currentQuarter
  const myC = currentCycle
  if (cycleCert === null) return
  await compareCycleCert()
  if (! sameQuarter(myC, myQ)) return
/* these might not be neded
  finalCycleCert()
  finalCycleRecord()
  saveCycleRecord()
*/  
  madeCycle = true
}

/** Queries the latest cycle records, applys them to the node list, and saves them to the cycle chain */
async function catchUpCycles() {
  syncNewCycles(NodeList.activeByIdOrder)
}

/** Applys the newest cycle record to the node list */
function applyCycleRecord(record: CycleRecord) {
  digestCycle(record)
}

/** Calculates the which cycle and quarter the given cycle record is in as of now */
function calcNextCycleAndQuarter(record: CycleRecord) {
  const duration = record.duration*SECOND
  const end = record.start*SECOND + duration
  const now = Date.now() // this is in milliseconds, but duration and start are in seconds
  const quarter = (Math.floor((now - end) / (duration / 4)) % 4) + 1
  const cycle = record.counter + Math.floor((now - end) / duration) + 1
  // console.log(cycle, quarter)
  return [cycle, quarter]
}

function calcQuarterTimes(record: CycleRecord) {
  const duration = record.duration*SECOND 
  const quarter = duration / 4
  const end = record.start*SECOND + duration
  const now = Date.now()
  const q1 = end + 0*quarter - now
  const q2 = end + 1*quarter - now
  const q3 = end + 2*quarter - now
  const q4 = end + 3*quarter - now
  const next = end + 4*quarter - now
  return [q1, q2, q3, q4, next]
}

function sameQuarter(myC, myQ) {
  return (myC===currentCycle) && (myQ===currentQuarter)
}

function collectCycleTxs() {}
function makeCycleRecord() {}
function makeCycleMarker() {}
function compareCycleMarkers() {}
function makeCycleCert() {
function gossipCycleCert() {}


function compareCycleCert() {}
function finalCycleCert() {}
function finalCycleRecord() {}
function saveCycleRecord() {}
function getMadeCycleRecord() {}
  return CycleChain.newest
}

