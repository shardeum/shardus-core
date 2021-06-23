import * as Active from './ActiveTypes'
import * as Apoptosis from './ApoptosisTypes'
import * as Archivers from './ArchiversTypes'
import * as CycleAutoScale from './CycleAutoScaleTypes'
import * as Join from './JoinTypes'
import * as Lost from './LostTypes'
import { SignedObject } from './P2PTypes'
import * as Refresh from './RefreshTypes'
import * as Rotation from './RotationTypes'
import * as SafetyMode from './SafetyModeTypes'
import * as Snapshot from './SnapshotTypes'

/** TYPES */

export type CycleMarker = string

export interface CycleCert extends SignedObject {
  marker: CycleMarker
  score?: number
}
export interface BaseRecord {
  networkId: string
  counter: number
  previous: string
  start: number
  duration: number
}
// don't forget to add new modules here

export type CycleTxs = SafetyMode.Txs &
  Refresh.Txs &
  Archivers.Txs &
  Join.Txs &
  Active.Txs &
  Apoptosis.Txs &
  Lost.Txs &
  Rotation.Txs &
  CycleAutoScale.Txs
// don't forget to add new modules here

export type CycleRecord = BaseRecord &
  SafetyMode.Record &
  Refresh.Record &
  Archivers.Record &
  Join.Record &
  Active.Record &
  Apoptosis.Record &
  Lost.Record &
  Rotation.Record & {
    joined: string[]
    returned: string[]
    lost: string[]
    refuted: string[]
    apoptosized: string[]
  } & Snapshot.Record &
  CycleAutoScale.Record

export type CycleData = CycleRecord & {
  marker: CycleMarker
  certificate: CycleCert
}
