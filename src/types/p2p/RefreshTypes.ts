import * as Archivers from './ArchiversTypes'
import { Node } from './NodeListTypes'

/** TYPES */

export interface Txs {}

export interface Record {
  refreshedArchivers: Archivers.JoinedArchiver[]
  refreshedConsensors: Node[]
}
