import * as Types from '../P2PTypes'

/** TYPES */

export interface ActiveRequest {
  nodeId: string
  status: string
  timestamp: number
}

export type SignedActiveRequest = ActiveRequest & Types.SignedObject

export interface Txs {
  active: SignedActiveRequest[]
}

export interface Record {
  active: number
  activated: string[]
  activatedPublicKeys: string[]
}
