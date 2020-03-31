import { sleep } from '../utils'
import * as CycleChain from './CycleChain'
import { JoinedArchiver, JoinedConsensor } from './Joining'
import * as NodeList from './NodeList'
import * as Sync from './Sync'
import { LooseObject } from './Types'

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

/** CONSTANTS */

const SECOND = 1000

/** STATE */

let currentQuarter = 0
let currentCycle = 0
let madeCycle = false // True if we successfully created the last cycle record, otherwise false

/** ROUTES */

/** CONTROL FUNCTIONS */

/**
 * Entrypoint for cycle record creation. Sets things up then kicks off the
 * scheduler (cycleCreator) to start scheduling the callbacks for cycle record
 * creation.
 */
function startCycles() {
  // start
  cycleCreator()
}

/**
 * Schedules itself to run at the start of each cycle, and schedules callbacks
 * to run for every quarter of the cycle.
 */
async function cycleCreator() {
  let prevRecord = madeCycle ? CycleChain.newest : await fetchLatestRecord()
  while (!prevRecord) {
    console.log(
      'CycleCreator: cycleCreator: Could not get prevRecord. Trying again in 1 sec...'
    )
    await sleep(1 * SECOND)
    prevRecord = await fetchLatestRecord()
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
  console.log(`CycleCreator: C${currentCycle} Q${currentQuarter}`)
}

/**
 * Handles cycle record creation tasks for quarter 2
 */
function runQ2() {
  currentQuarter = 2
  console.log(`CycleCreator: C${currentCycle} Q${currentQuarter}`)
}

/**
 * Handles cycle record creation tasks for quarter 3
 */
function runQ3() {
  currentQuarter = 3
  console.log(`CycleCreator: C${currentCycle} Q${currentQuarter}`)
}

/**
 * Handles cycle record creation tasks for quarter 4
 */
function runQ4() {
  currentQuarter = 4
  console.log(`CycleCreator: C${currentCycle} Q${currentQuarter}`)
  madeCycle = true
}

/** HELPER FUNCTIONS */

/**
 * Syncs the CycleChain to the newest cycle record of the network, and returns
 * the newest cycle record.
 */
async function fetchLatestRecord(): Promise<CycleRecord> {
  try {
    await Sync.syncNewCycles(NodeList.activeByIdOrder)
  } catch (err) {
    console.log('CycleCreator: syncPrevRecord: syncNewCycles failed:', err)
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
