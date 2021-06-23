import * as NodeList from '../../p2p/NodeList'
import * as Archivers from './ArchiversTypes'

/** TYPES */

export interface Txs {}

export interface Record {
  refreshedArchivers: Archivers.JoinedArchiver[]
  refreshedConsensors: NodeList.Node[]
}
