import * as CycleCreator from './CycleCreatorTypes'
import * as Types from './P2PTypes'

/**
 * [TODO] [AS] Remove nodes that are taking too long to sync after they've joined.
 * To do this, we probably need to keep track of when they first joined.
 */
/** TYPES */

export interface JoinedConsensor extends Types.P2PNode {
  cycleJoined: CycleCreator.CycleMarker
  counterRefreshed: CycleCreator.CycleRecord['counter']
  id: string
}

export interface JoinRequest {
  nodeInfo: Types.P2PNode
  cycleMarker: CycleCreator.CycleMarker
  proofOfWork: string
  selectionNum: string
  version: string
  sign: Types.Signature
}

export interface Txs {
  join: JoinRequest[]
}

export interface Record {
  syncing: number
  joinedConsensors: JoinedConsensor[]
}
