import { VectorBufferStream } from '../utils/serialization/VectorBufferStream';
import {
  WrappedDataResponse,
  deserializeWrappedDataResponse,
  serializeWrappedDataResponse,
} from './WrappedDataResponse';
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum';

export const cBroadcastFinalStateReqVersion = 1;

export interface BroadcastFinalStateReq {
  txid: string;
  stateList: WrappedDataResponse[];
}

export function serializeBroadcastFinalStateReq(
  stream: VectorBufferStream,
  obj: BroadcastFinalStateReq,
  root = false
): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cBroadcastFinalStateReq);
  }
  stream.writeUInt8(cBroadcastFinalStateReqVersion);
  stream.writeString(obj.txid);
  stream.writeUInt16(obj.stateList.length); // Serialize array length
  obj.stateList.forEach((item) => serializeWrappedDataResponse(stream, item)); // Serialize each item
}

export function deserializeBroadcastFinalStateReq(stream: VectorBufferStream): BroadcastFinalStateReq {
  const version = stream.readUInt8();
  if (version > cBroadcastFinalStateReqVersion) {
    throw new Error('BroadcastFinalStateReq version mismatch');
  }
  const txid = stream.readString();
  const stateListLength = stream.readUInt16();
  const stateList = Array.from({ length: stateListLength }, () => deserializeWrappedDataResponse(stream));
  return { txid, stateList };
}
