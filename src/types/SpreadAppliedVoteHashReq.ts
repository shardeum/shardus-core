import { VectorBufferStream } from '../utils/serialization/VectorBufferStream';
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum';
import { Sign } from '../shardus/shardus-types';

export type SpreadAppliedVoteHashReq = {
  txid: string;
  voteHash: string;
  sign?: Sign;
};

const cSpreadAppliedVoteHashReqVersion = 1;

export function serializeSpreadAppliedVoteHashReq(
  stream: VectorBufferStream,
  obj: SpreadAppliedVoteHashReq,
  root = false
): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cSpreadAppliedVoteHash);
  }
  stream.writeUInt8(cSpreadAppliedVoteHashReqVersion);
  stream.writeString(obj.txid);
  stream.writeString(obj.voteHash);
  if (obj.sign) {
    stream.writeUInt8(1);
    stream.writeString(obj.sign.owner);
    stream.writeString(obj.sign.sig);
  } else {
    stream.writeUInt8(0);
  }
}

export function deserializeSpreadAppliedVoteHashReq(stream: VectorBufferStream): SpreadAppliedVoteHashReq {
  const version = stream.readUInt8();
  if (version > cSpreadAppliedVoteHashReqVersion) {
    throw new Error('Unsupported version');
  }
  const txid = stream.readString();
  const voteHash = stream.readString();
  let sign: Sign | undefined;
  if (stream.readUInt8() === 1) {
    sign = {
      owner: stream.readString(),
      sig: stream.readString(),
    };
    return {
      txid,
      voteHash,
      sign,
    };
  }
  return {
    txid,
    voteHash,
  };
}
