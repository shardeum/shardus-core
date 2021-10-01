import { Logger } from 'log4js'
import { crypto, logger, stateManager } from './Context'
import { P2P } from 'shardus-types'
import { nodes } from './NodeList'
import { nestedCountersInstance } from '../utils/nestedCounters'

/** STATE */

let p2pLogger: Logger

export let cycles: P2P.CycleCreatorTypes.CycleRecord[] // [OLD, ..., NEW]
export let cyclesByMarker: { [marker: string]: P2P.CycleCreatorTypes.CycleRecord }

export let oldest: P2P.CycleCreatorTypes.CycleRecord
export let newest: P2P.CycleCreatorTypes.CycleRecord

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
    if (!oldest) oldest = cycle
  }
}
export function prepend(cycle: P2P.CycleCreatorTypes.CycleRecord) {
  const marker = computeCycleMarker(cycle)
  if (!cyclesByMarker[marker]) {
    cycles.unshift(cycle)
    cyclesByMarker[marker] = cycle
    oldest = cycle
    if (!newest) newest = cycle
  }
}
export function validate(prev: P2P.CycleCreatorTypes.CycleRecord, next: P2P.CycleCreatorTypes.CycleRecord): boolean {
  const prevMarker = computeCycleMarker(prev)
  if (next.previous !== prevMarker) return false
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
    if (cycle.start <= secondsTs && cycle.start + cycle.duration > secondsTs) {
      return cycle
    }
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
export function getCycleNumberFromTimestamp(timestamp : number, allowOlder: boolean = true, addSyncSettleTime: boolean = true) {
    let currentCycleShardData = stateManager.getCurrentCycleShardData()

    let offsetTimestamp = timestamp

    if(addSyncSettleTime){
      offsetTimestamp = timestamp + stateManager.syncSettleTime
    }

    if(timestamp < 1 || timestamp == null){
      let stack = new Error().stack
      stateManager.statemanager_fatal(`getCycleNumberFromTimestamp ${timestamp}`, `getCycleNumberFromTimestamp ${timestamp} ,  ${stack}`)
    }

    //currentCycleShardData
    if (currentCycleShardData.timestamp <= offsetTimestamp && offsetTimestamp < currentCycleShardData.timestampEndCycle) {
      if(currentCycleShardData.cycleNumber == null){
        stateManager.statemanager_fatal('getCycleNumberFromTimestamp failed. cycleNumber == null', 'currentCycleShardData.cycleNumber == null')
        nestedCountersInstance.countEvent('getCycleNumberFromTimestamp', 'currentCycleShardData.cycleNumber fail')
        const cycle = getStoredCycleByTimestamp(offsetTimestamp)
        console.log("CycleChain.getCycleNumberFromTimestamp getStoredCycleByTimestamp",cycle, timestamp)
        if (cycle != null) {
          stateManager.statemanager_fatal('getCycleNumberFromTimestamp failed fatal redeemed', 'currentCycleShardData.cycleNumber == null, fatal redeemed')
          nestedCountersInstance.countEvent('getCycleNumberFromTimestamp', 'currentCycleShardData.cycleNumber redeemed')
          return cycle.counter
        } else {
          //debug only!!!
          let cycle2 = getStoredCycleByTimestamp(offsetTimestamp)
          stateManager.statemanager_fatal('getCycleNumberFromTimestamp failed fatal not redeemed', 'getStoredCycleByTimestamp cycleNumber == null not redeemed')
          nestedCountersInstance.countEvent('getCycleNumberFromTimestamp', 'currentCycleShardData.cycleNumber failed to redeem')
        }
      } else {
        return currentCycleShardData.cycleNumber
      }
    }

    if(currentCycleShardData.cycleNumber == null){
      nestedCountersInstance.countEvent('getCycleNumberFromTimestamp', 'currentCycleShardData.cycleNumber == null')
      stateManager.statemanager_fatal('getCycleNumberFromTimestamp: currentCycleShardData.cycleNumber == null',`getCycleNumberFromTimestamp: currentCycleShardData.cycleNumber == null ${currentCycleShardData.cycleNumber} timestamp:${timestamp}`)

    }

    //is it in the future
    if (offsetTimestamp >= currentCycleShardData.timestampEndCycle) {
      let cycle: P2P.CycleCreatorTypes.CycleRecord = getNewest()

      let timePastCurrentCycle = offsetTimestamp - currentCycleShardData.timestampEndCycle
      let cyclesAhead = Math.ceil(timePastCurrentCycle / (cycle.duration * 1000))
      nestedCountersInstance.countEvent('getCycleNumberFromTimestamp', `+${cyclesAhead}`)

      return currentCycleShardData.cycleNumber + cyclesAhead
    }
    if (allowOlder === true) {
      //cycle is in the past, by process of elimination
      // let offsetSeconds = Math.floor(offsetTimestamp * 0.001)
      const cycle = getStoredCycleByTimestamp(offsetTimestamp)
      if (cycle != null) {
        nestedCountersInstance.countEvent('getCycleNumberFromTimestamp', 'p2p lookup')
        if(cycle.counter == null){
          stateManager.statemanager_fatal('getCycleNumberFromTimestamp  unexpected cycle.cycleNumber == null', 'getCycleNumberFromTimestamp unexpected cycle.cycleNumber == null')
          nestedCountersInstance.countEvent('getCycleNumberFromTimestamp', `getCycleNumberFromTimestamp unexpected cycle.cycleNumber == null  ${timestamp}`)
        }

        return cycle.counter
      } else {
        //nestedCountersInstance.countEvent('getCycleNumberFromTimestamp', 'p2p lookup fail -estimate cycle')
        //debug only!!!
        //let cycle2 = CycleChain.getCycleByTimestamp(offsetTimestamp)
        //stateManager.statemanager_fatal('getCycleNumberFromTimestamp getCycleByTimestamp failed', 'getCycleByTimestamp getCycleByTimestamp failed')
        let cycle: P2P.CycleCreatorTypes.CycleRecord = getNewest()
        let cycleEstimate = currentCycleShardData.cycleNumber - Math.ceil((currentCycleShardData.timestampEndCycle - offsetTimestamp) / (cycle.duration * 1000))
        if(cycleEstimate < 1){
          cycleEstimate = 1
        }
        nestedCountersInstance.countEvent('getCycleNumberFromTimestamp', 'p2p lookup fail -estimate cycle: ' + cycleEstimate)
        return cycleEstimate
      }
    }

    //failed to match, return -1
    stateManager.statemanager_fatal('getCycleNumberFromTimestamp failed final', `getCycleNumberFromTimestamp failed final ${timestamp}`)
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
    const joind = record.joinedConsensors.map(
      (c) => `${c.externalIp}:${c.externalPort}`
    )
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
    const rmvd = record.removed.map((id) =>
      idToIpPort[id] ? idToIpPort[id] : 'x' + id.slice(0, 3)
    )
    const lost = record.lost.map((id) =>
      idToIpPort[id] ? idToIpPort[id] : 'x' + id.slice(0, 3)
    )
    const refu = record.refuted.map((id) =>
      idToIpPort[id] ? idToIpPort[id] : 'x' + id.slice(0, 3)
    )
    const apopd = record.apoptosized.map((id) =>
      idToIpPort[id] ? idToIpPort[id] : 'x' + id.slice(0, 3)
    )
    const rfshd = record.refreshedConsensors.map(
      (c) => `${c.externalIp}:${c.externalPort}-${c.counterRefreshed}`
    )

    const str = `      ${ctr}:${prev}:${rhash} { actv:${actv}, exp:${exp}, desr:${desr}, joind:[${joind.join()}], actvd:[${actvd.join()}], lost:[${lost.join()}] refu:[${refu.join()}] apop:[${apopd.join()}] rmvd:[${rmvd.join()}], rfshd:[${rfshd.join()}] }`

    return str
  })

  const output = `
    DIGESTED:   ${newest ? newest.counter : newest}
    CHAIN:
  ${chain.join('\n')}`

  return output
}
