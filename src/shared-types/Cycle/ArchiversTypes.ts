import { CycleRecord as Cycle } from "./CycleCreatorTypes";
import { StateMetaData, TypeNames, DataRequest } from '../../p2p/StateParser';
import { SignedObject } from '../P2PTypes';

/** TYPES */

export enum RequestTypes {
  JOIN = 'JOIN',
  LEAVE = 'LEAVE'
}
export interface NamesToTypes {
  CYCLE: Cycle;
  STATE_METADATA: StateMetaData;
}
export interface DataResponse {
  publicKey: string;
  responses: {
    [T in TypeNames]?: NamesToTypes[T][];
  };
  recipient: string;
}
export interface DataRecipient {
  nodeInfo: JoinedArchiver;
  dataRequests: DataRequest<Cycle | StateMetaData>[];
  curvePk: string;
}

export interface JoinedArchiver {
  publicKey: string;
  ip: string;
  port: number;
  curvePk: string;
}

export interface Request extends SignedObject {
  nodeInfo: JoinedArchiver;
  requestType: string;
}
export interface Txs {
  archivers: Request[];
}

export interface Record {
  joinedArchivers: JoinedArchiver[];
  leavingArchivers: JoinedArchiver[];
}
