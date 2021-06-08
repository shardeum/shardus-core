import * as Archivers from './ArchiversTypes';
import * as NodeList from '../../p2p/NodeList';

/** TYPES */

export interface Txs { }

export interface Record {
  refreshedArchivers: Archivers.JoinedArchiver[];
  refreshedConsensors: NodeList.Node[];
}
