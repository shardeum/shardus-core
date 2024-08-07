import { Signature } from '@shardus/types/build/src/p2p/P2PTypes';
import { VectorBufferStream } from '../utils/serialization/VectorBufferStream';
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum';

export interface LostArchiverInvestigateReq {
  type: 'investigate';
  target: string;
  investigator: string;
  sender: string;
  cycle: string;
  sign: Signature;
}

const cLostArchiverInvestigateReqVersion = 1;

export function serializeLostArchiverInvestigateReq(
  stream: VectorBufferStream,
  obj: LostArchiverInvestigateReq,
  root = false
): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cLostArchiverInvestigateReq);
  }
  stream.writeUInt8(cLostArchiverInvestigateReqVersion);
  stream.writeString(obj.type);
  stream.writeString(obj.target);
  stream.writeString(obj.investigator);
  stream.writeString(obj.sender);
  stream.writeString(obj.cycle);
  stream.writeString(obj.sign.owner);
  stream.writeString(obj.sign.sig);
}

export function deserializeLostArchiverInvestigateReq(
  stream: VectorBufferStream
): LostArchiverInvestigateReq {
  const version = stream.readUInt8();
  if (version > cLostArchiverInvestigateReqVersion) {
    throw new Error('cLostArchiverInvestigateReq version mismatch');
  }
  const type = stream.readString();
  if (type !== 'investigate') {
    throw new Error(`Unexpected type value: ${type}`);
  }
  // eslint-disable-next-line prefer-const
  let obj: LostArchiverInvestigateReq = {
    type: type as 'investigate', // Type assertion to satisfy TypeScript's type system
    target: stream.readString(),
    investigator: stream.readString(),
    sender: stream.readString(),
    cycle: stream.readString(),
    sign: {
      owner: stream.readString(),
      sig: stream.readString(),
    },
  };
  return obj;
}
