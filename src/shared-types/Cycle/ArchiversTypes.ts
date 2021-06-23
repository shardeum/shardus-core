import {
  NamesToTypes,
  StateMetaData,
  TypeIndex,
  TypeName,
  TypeNames,
  ValidTypes
} from '../Cycle/SnapshotTypes'
import { SignedObject } from '../P2PTypes'
import { CycleRecord as Cycle } from './CycleCreatorTypes'

/** TYPES */

export enum RequestTypes {
  JOIN = 'JOIN',
  LEAVE = 'LEAVE',
}

export interface DataRequest<T extends ValidTypes> {
  type: TypeName<T>
  lastData: TypeIndex<T>
}

export interface DataResponse {
  publicKey: string
  responses: {
    [T in TypeNames]?: NamesToTypes[T][]
  }
  recipient: string
}
export interface DataRecipient {
  nodeInfo: JoinedArchiver
  dataRequests: DataRequest<Cycle | StateMetaData>[]
  curvePk: string
}

export interface JoinedArchiver {
  publicKey: string
  ip: string
  port: number
  curvePk: string
}

export interface Request extends SignedObject {
  nodeInfo: JoinedArchiver
  requestType: string
}
export interface Txs {
  archivers: Request[]
}

export interface Record {
  joinedArchivers: JoinedArchiver[]
  leavingArchivers: JoinedArchiver[]
}
