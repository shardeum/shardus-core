import { P2P } from '@shardus/types'

let seen: Set<P2P.P2PTypes.Node['publicKey']>
export function getSeen(): Set<string> {
  return seen
}
export function resetSeen(): void {
  seen = new Set()
}

let allowBogon = false
export function setAllowBogon(value: boolean): void {
  allowBogon = value
}
export function getAllowBogon(): boolean {
  return allowBogon
}
