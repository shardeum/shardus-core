// tslint:disable: variable-name

import { EventEmitter } from 'events'
import {
  Dictionary,
  Number,
  Record,
  Static,
  String,
  Union,
  Unknown,
} from 'runtypes'
import P2P from '.'

export type P2PModuleContext = P2P & EventEmitter

export const JoinRequest = Record({
  cycleMarker: String,
  nodeInfo: Record({
    activeTimestamp: Number,
    address: String,
    externalIp: String,
    externalPort: Number,
    internalIp: String,
    internalPort: Number,
    joinRequestTimestamp: Number,
    publicKey: String,
  }),
  proofOfWork: Record({
    compute: Record({
      hash: String,
      nonce: String,
    }),
  }),
  selectionNum: String,
  sign: Record({
    owner: String,
    sig: String,
  }),
})
export type JoinRequest = Static<typeof JoinRequest>

// {"payload":{},"sender":"2365xdb640","tag":"1074xx1140f","tracker":"key_2365xdb640_1581448859447_0"}
export const InternalAsk = Record({
  payload: Union(Record({}), Dictionary(Unknown, 'string')),
  sender: String,
  tag: String,
  tracker: String,
})
export type InternalAsk = Static<typeof InternalAsk>

export interface Node {
  ip: string
  port: number
  publicKey: string
}

export enum NodeStatus {
  ACTIVE = 'active',
  SYNCING = 'syncing',
}

export interface NodeInfo {
  curvePublicKey: string
  externalIp: string
  externalPort: number
  id: string
  internalIp: string
  internalPort: number
  publicKey: string
  status: NodeStatus
}
