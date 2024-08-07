import { VectorBufferStream } from '../utils/serialization/VectorBufferStream';
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum';

const cSyncTrieHashesReqVersion = 1;

export type SyncTrieHashesRequest = {
  cycle: number;
  nodeHashes: { radix: string; hash: string }[];
};

export function serializeSyncTrieHashesReq(
  stream: VectorBufferStream,
  request: SyncTrieHashesRequest,
  root = false
): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cSyncTrieHashesReq);
  }
  stream.writeUInt8(cSyncTrieHashesReqVersion);
  stream.writeBigUInt64(BigInt(request.cycle));
  stream.writeUInt32(request.nodeHashes.length);
  for (const nodeHash of request.nodeHashes) {
    stream.writeString(nodeHash.radix);
    stream.writeString(nodeHash.hash);
  }
}

export function deserializeSyncTrieHashesReq(stream: VectorBufferStream): SyncTrieHashesRequest {
  const version = stream.readUInt8();
  if (version > cSyncTrieHashesReqVersion) {
    throw new Error('SyncTrieHashesRequest version mismatch');
  }
  const cycle = Number(stream.readBigUInt64());
  const nodeHashesLength = stream.readUInt32();
  const nodeHashes = [];
  for (let i = 0; i < nodeHashesLength; i++) {
    const radix = stream.readString();
    const hash = stream.readString();
    nodeHashes.push({ radix, hash });
  }
  return {
    cycle,
    nodeHashes,
  };
}
