import { Logger } from 'log4js'
import { crypto, logger, stateManager } from './Context'
import { hexstring, P2P } from '@shardus/types'
import { nodes } from './NodeList'
import { nestedCountersInstance } from '../utils/nestedCounters'
import { logFlags } from '../logger'
import { shardusGetTime } from '../network'

/** STATE */

let p2pLogger: Logger

export let cycles: P2P.CycleCreatorTypes.CycleRecord[] // [OLD, ..., NEW]
export let cyclesByMarker: { [marker: string]: P2P.CycleCreatorTypes.CycleRecord }

export let oldest: P2P.CycleCreatorTypes.CycleRecord
export let newest: P2P.CycleCreatorTypes.CycleRecord

let currentCycleMarker: hexstring

reset()

/** FUNCTIONS */

export function init() {
  p2pLogger = logger.getLogger('p2p')
}

export function reset() {
  cycles = []
  cyclesByMarker = {}
  oldest = null
  newest = null
  currentCycleMarker = null
}

export function getNewest() {
  return newest
}

export function append(cycle: P2P.CycleCreatorTypes.CycleRecord) {
  const marker = computeCycleMarker(cycle)
  if (!cyclesByMarker[marker]) {
    cycles.push(cycle)
    cyclesByMarker[marker] = cycle
    newest = cycle
    currentCycleMarker = marker
    if (!oldest) oldest = cycle
  }
}
export function prepend(cycle: P2P.CycleCreatorTypes.CycleRecord) {
  const marker = computeCycleMarker(cycle)
  if (!cyclesByMarker[marker]) {
    cycles.unshift(cycle)
    cyclesByMarker[marker] = cycle
    oldest = cycle

    // this will happen only once in the lifetime of a node. we never set newest to null
    if (newest == null){
      newest = cycle
    }

    // if our cycle is newer than the newest lets update newest and current cycle marker
    // this should only be happening before we have started digesting cycles.
    // but this check will make the actions correct.
    if(cycle.counter > newest.counter){
      newest = cycle
      currentCycleMarker = marker
    }
  }
}
export function validate(
  prev: P2P.CycleCreatorTypes.CycleRecord,
  next: P2P.CycleCreatorTypes.CycleRecord
): boolean {
  p2pLogger.info('CycleChain.validate: inside')
  const prevMarker = computeCycleMarker(prev)

  p2pLogger.info('CycleChain.validate: prevMarker', prevMarker)
  p2pLogger.info('CycleChain.validate: next.previous', next.previous)

  p2pLogger.info('CycleChain.validate: prev.standbylist', prev.standbyNodeListHash)
  p2pLogger.info('CycleChain.validate: next.standbylist', next.standbyNodeListHash)

  if (next.previous !== prevMarker) {
    p2pLogger.info('CycleChain.validate: ERROR: next.previous !== prevMarker')
    return false
  }
  // [TODO] More validation
  return true
}

export function getCycleChain(start, end = start + 100) {
  // Limit how many are returned
  if (end - start > 100) end = start + 100

  if (!oldest) return []
  if (end < oldest.counter) return []
  if (start < oldest.counter) start = oldest.counter
  if (start > end) return []

  const offset = oldest.counter
  const relStart = start - offset
  const relEnd = end - offset

  return cycles.slice(relStart, relEnd + 1)
}

/**
 * Find a stored cycle with a timestamp.
 * This will fail if a timestamp is newer or older than cycles stored on this node
 * getCycleNumberFromTimestamp() will allow for predictions about future or past cycles.
 * @param timestamp
 */
export function getStoredCycleByTimestamp(timestamp) {
  let secondsTs = Math.floor(timestamp * 0.001)
  // search from end, to improve normal case perf
  for (let i = cycles.length - 1; i >= 0; i--) {
    let cycle = cycles[i]
    if (cycle.start < secondsTs && cycle.start + cycle.duration >= secondsTs) {
      return cycle
    }
  }
  if(cycles.length > 0 && timestamp === cycles[0].start){
    nestedCountersInstance.countEvent('getCycleNumberFromTimestamp', `getStoredCycleByTimestamp edge case 0`)
    return cycles[0]
  }
  return null
}

/**
 * Get a cycle from a timestamp.
 * Future timestamps are allowed. Timestamps for cycles older than stored are allow if the allowOlder flag is set
 * @param timestamp timestamp of the TX.  NOTE by default the sync settle time will be added.  set addSyncSettleTime = false to avoid this
 * @param allowOlder this allows calculating a cycle number for a cycle that is not stored.
 * @param addSyncSettleTime add in the sync settle time to the request.
 */
export function getCycleNumberFromTimestamp(
  timestamp: number,
  allowOlder: boolean = true,
  addSyncSettleTime: boolean = true
) {
  let currentCycleShardData = stateManager.getCurrentCycleShardData()

  let offsetTimestamp = timestamp

  if (addSyncSettleTime) {
    offsetTimestamp = timestamp + stateManager.syncSettleTime
  }

  if (timestamp < 1 || timestamp == null) {
    let stack = new Error().stack
    /* prettier-ignore */ stateManager.statemanager_fatal(`getCycleNumberFromTimestamp ${timestamp}`, `getCycleNumberFromTimestamp ${timestamp} ,  ${stack}`)
  }

  //currentCycleShardData
  if (
    currentCycleShardData.timestamp < offsetTimestamp &&
    offsetTimestamp <= currentCycleShardData.timestampEndCycle
  ) {
    if (currentCycleShardData.cycleNumber == null) {
      /* prettier-ignore */ stateManager.statemanager_fatal('getCycleNumberFromTimestamp failed. cycleNumber == null', 'currentCycleShardData.cycleNumber == null')
      /* prettier-ignore */ nestedCountersInstance.countEvent('getCycleNumberFromTimestamp', 'currentCycleShardData.cycleNumber fail')
      const cycle = getStoredCycleByTimestamp(offsetTimestamp)
      console.log('CycleChain.getCycleNumberFromTimestamp getStoredCycleByTimestamp', cycle, timestamp)
      if (cycle != null) {
        /* prettier-ignore */ stateManager.statemanager_fatal('getCycleNumberFromTimestamp failed fatal redeemed', 'currentCycleShardData.cycleNumber == null, fatal redeemed')
        /* prettier-ignore */ nestedCountersInstance.countEvent('getCycleNumberFromTimestamp', 'currentCycleShardData.cycleNumber redeemed')
        return cycle.counter
      } else {
        //debug only!!!
        let cycle2 = getStoredCycleByTimestamp(offsetTimestamp)
        /* prettier-ignore */ stateManager.statemanager_fatal('getCycleNumberFromTimestamp failed fatal not redeemed', 'getStoredCycleByTimestamp cycleNumber == null not redeemed')
        /* prettier-ignore */ nestedCountersInstance.countEvent('getCycleNumberFromTimestamp', 'currentCycleShardData.cycleNumber failed to redeem')
      }
    } else {
      nestedCountersInstance.countEvent('getCycleNumberFromTimestamp', `current cycle`)
      if(currentCycleShardData.timestamp === offsetTimestamp){
        nestedCountersInstance.countEvent('getCycleNumberFromTimestamp', `exact curent upper boundary`)
      }
      return currentCycleShardData.cycleNumber
    }
  }

  if (currentCycleShardData.cycleNumber == null) {
    /* prettier-ignore */ nestedCountersInstance.countEvent('getCycleNumberFromTimestamp', 'currentCycleShardData.cycleNumber == null')
    /* prettier-ignore */ stateManager.statemanager_fatal('getCycleNumberFromTimestamp: currentCycleShardData.cycleNumber == null',`getCycleNumberFromTimestamp: currentCycleShardData.cycleNumber == null ${currentCycleShardData.cycleNumber} timestamp:${timestamp}`)
  }

  //is it in the future
  if (offsetTimestamp > currentCycleShardData.timestampEndCycle) {
    let cycle: P2P.CycleCreatorTypes.CycleRecord = getNewest()
    let timePastCurrentCycle = offsetTimestamp - currentCycleShardData.timestampEndCycle
    
    const cyclesAheadNotAdjusted = timePastCurrentCycle / (cycle.duration * 1000)
    let cyclesAhead = Math.ceil(cyclesAheadNotAdjusted) 
    //If we land on an exact boundary this would have been broken under past logic
    if(cyclesAhead === cyclesAheadNotAdjusted){
      nestedCountersInstance.countEvent('getCycleNumberFromTimestamp', `exact future boundary`)
    }

    nestedCountersInstance.countEvent('getCycleNumberFromTimestamp', `+${cyclesAhead}`)

    return currentCycleShardData.cycleNumber + cyclesAhead
  }
  if (allowOlder === true) {
    //cycle is in the past, by process of elimination
    // let offsetSeconds = Math.floor(offsetTimestamp * 0.001)
    const cycle = getStoredCycleByTimestamp(offsetTimestamp)
    if (cycle != null) {
      if (cycle.counter == null) {
        /* prettier-ignore */ stateManager.statemanager_fatal('getCycleNumberFromTimestamp  unexpected cycle.cycleNumber == null', 'getCycleNumberFromTimestamp unexpected cycle.cycleNumber == null')
        /* prettier-ignore */ nestedCountersInstance.countEvent('getCycleNumberFromTimestamp', `getCycleNumberFromTimestamp unexpected cycle.cycleNumber == null  ${timestamp}`)
      }
      const cyclesBehind = currentCycleShardData.cycleNumber - cycle.counter
      nestedCountersInstance.countEvent('getCycleNumberFromTimestamp', `-${cyclesBehind}`)
      return cycle.counter
    } else {
      //nestedCountersInstance.countEvent('getCycleNumberFromTimestamp', 'p2p lookup fail -estimate cycle')
      //debug only!!!
      //let cycle2 = CycleChain.getCycleByTimestamp(offsetTimestamp)
      //stateManager.statemanager_fatal('getCycleNumberFromTimestamp getCycleByTimestamp failed', 'getCycleByTimestamp getCycleByTimestamp failed')
      let cycle: P2P.CycleCreatorTypes.CycleRecord = getNewest()
      let cycleEstimate =
        currentCycleShardData.cycleNumber -
        Math.ceil((currentCycleShardData.timestampEndCycle - offsetTimestamp) / (cycle.duration * 1000))
      if (cycleEstimate < 1) {
        cycleEstimate = 1
      }
      if (logFlags.verbose)
        /* prettier-ignore */ nestedCountersInstance.countEvent('getCycleNumberFromTimestamp', 'p2p lookup fail -estimate cycle: ' + cycleEstimate)
      return cycleEstimate
    }
  }

  //failed to match, return -1
  /* prettier-ignore */ stateManager.statemanager_fatal('getCycleNumberFromTimestamp failed final', `getCycleNumberFromTimestamp failed final ${timestamp}`)
  return -1
}

export function prune(keep: number) {
  const drop = cycles.length - keep
  if (drop <= 0) return
  cycles.splice(0, drop)
  oldest = cycles[0]
}

/** HELPER FUNCTIONS */

export function computeCycleMarker(fields) {
  const cycleMarker = crypto.hash(fields)
  return cycleMarker
}

const idToIpPort: { [id: string]: string } = {}

export function getDebug() {
  const chain = cycles.map((record) => {
    const ctr = record.counter
    const prev = record.previous.slice(0, 4)
    const rhash = crypto.hash(record).slice(0, 4)
    const actv = record.active
    const exp = record.expired
    const desr = record.desired
    const joind = record.joinedConsensors.map((c) => `${c.externalIp}:${c.externalPort}`)
    const actvd = record.activated.map((id) => {
      if (idToIpPort[id]) return idToIpPort[id]
      const node = nodes.get(id)
      if (node && node.externalIp && node.externalPort) {
        idToIpPort[id] = `${node.externalIp}:${node.externalPort}`
        return idToIpPort[id]
      } else {
        return `missing-${id.substring(0, 5)}`
      }
    })
    //    const rmvd = record.removed.map(id => idToPort[id])
    const rmvd =
      record.removed[0] !== 'all'
        ? record.removed.map((id) => (idToIpPort[id] ? idToIpPort[id] : 'x' + id.slice(0, 3)))
        : record.removed
    const lost = record.lost.map((id) => (idToIpPort[id] ? idToIpPort[id] : 'x' + id.slice(0, 3)))
    const refu = record.refuted.map((id) => (idToIpPort[id] ? idToIpPort[id] : 'x' + id.slice(0, 3)))
    const apopd = record.apoptosized.map((id) => (idToIpPort[id] ? idToIpPort[id] : 'x' + id.slice(0, 3)))
    const rfshd = record.refreshedConsensors.map(
      (c) => `${c.externalIp}:${c.externalPort}-${c.counterRefreshed}`
    )

    const str = `      ${ctr}:${prev}:${rhash} { actv:${actv}, exp:${exp}, desr:${desr}, joind:[${joind.join()}], actvd:[${actvd.join()}], lost:[${lost.join()}] refu:[${refu.join()}] apop:[${apopd.join()}] rmvd:[${
      record.removed[0] !== 'all' ? rmvd.join() : rmvd
    }], rfshd:[${rfshd.join()}] }`

    return str
  })

  const output = `
    DIGESTED:   ${newest ? newest.counter : newest}
    CHAIN:
  ${chain.join('\n')}`

  return output
}

/** Returns the last appended cycle's marker. */
export function getCurrentCycleMarker(): hexstring {
  return currentCycleMarker
}

/**
 * this gets the most recently finished cycle and puts it in a logs str wth message and time
 * this cycle is never the most current one as we start working on the next as soon as we update
 * newest
 * @param msg
 * @returns
 */
export function getNewestCycleInfoLogStr(msg: string): string {
  let cycleNumber = newest ? newest.counter : -1
  const res = `Cycle: ${cycleNumber} Time:${shardusGetTime()} ${msg}`
  return res
}
