import { VectorBufferStream } from '../utils/serialization/VectorBufferStream';
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum';

export interface LostReportReq {
  target: string;
  checker: string;
  reporter: string;
  cycle: number;
  timestamp: number;
  requestId: string;
  sign: {
    owner: string;
    sig: string;
  };
  killother?: boolean;
}

const cLostReportReqVersion = 1;

export function serializeLostReportReq(stream: VectorBufferStream, obj: LostReportReq, root = false): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cLostReportReq);
  }
  stream.writeUInt8(cLostReportReqVersion);
  stream.writeString(obj.target);
  stream.writeString(obj.checker);
  stream.writeString(obj.reporter);
  stream.writeUInt32(obj.cycle);
  stream.writeBigUInt64(BigInt(obj.timestamp));
  stream.writeString(obj.requestId);
  stream.writeString(obj.sign.owner);
  stream.writeString(obj.sign.sig);
  if (obj.killother) {
    stream.writeUInt8(1);
    stream.writeUInt8(obj.killother ? 1 : 0);
  } else stream.writeUInt8(0);
}

export function deserializeLostReportReq(stream: VectorBufferStream): LostReportReq {
  const version = stream.readUInt8();
  if (version > cLostReportReqVersion) {
    throw new Error('cLostReportReq version mismatch');
  }

  const obj: LostReportReq = {
    target: stream.readString(),
    checker: stream.readString(),
    reporter: stream.readString(),
    cycle: stream.readUInt32(),
    timestamp: Number(stream.readBigUInt64()),
    requestId: stream.readString(),
    sign: {
      owner: stream.readString(),
      sig: stream.readString(),
    },
  };
  if (stream.readUInt8() === 1) {
    // Check if killother is present
    obj.killother = stream.readUInt8() === 1;
  }
  return obj;
}
