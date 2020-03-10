import { p2p } from './P2PContext'
import { Node } from './NodeList'

/** TYPES */

export interface SignedMarker {
  id: string
  marker: string
  sign: {
    owner: string
    sig: string
  }
}

export type Certificate = SignedMarker[]

export interface JoinedArchiver {
  curvePk: string,
  ip: string,
  port: number,
  publicKey: string
}

// Should eventually become Node type from NodeList
export type JoinedConsensor = Omit<Node, 'status'|'curvePublicKey'>

export interface Cycle {
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

const cycles: Cycle[] = [] // [OLD, ..., NEW]
const cyclesByMarker: { [marker: string]: Cycle } = {}

export let oldest: Cycle = null
export let newest: Cycle = null

/** FUNCTIONS */

export function append(cycle: Cycle) {
  cycles.push(cycle)
  const marker = p2p.state._computeCycleMarker(cycle)
  cyclesByMarker[marker] = cycle
  newest = cycle
  if (!oldest) oldest = cycle
}
export function prepend(cycle: Cycle) {
  cycles.unshift(cycle)
  const marker = p2p.state._computeCycleMarker(cycle)
  cyclesByMarker[marker] = cycle
  oldest = cycle
  if (!newest) newest = cycle
}
export function validate(prev: Cycle, next: Cycle): boolean {
  // [TODO] actually validate
  return true
}

export function getNewest() {
  return 
}
export function getOldest() {}