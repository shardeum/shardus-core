import { VectorBufferStream } from '../utils/serialization/VectorBufferStream';
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum';

export const cGetTrieAccountHashesReqVersion = 1;

export type GetTrieAccountHashesReq = {
  radixList: string[];
};

export function serializeGetTrieAccountHashesReq(
  stream: VectorBufferStream,
  req: GetTrieAccountHashesReq,
  root = false
): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cGetAccountTrieHashesReq);
  }
  stream.writeUInt8(cGetTrieAccountHashesReqVersion);
  stream.writeUInt16(req.radixList.length);
  stream.writeString(req.radixList.join(','));
}

export function deserializeGetTrieAccountHashesReq(stream: VectorBufferStream): GetTrieAccountHashesReq {
  const version = stream.readUInt8();
  if (version !== cGetTrieAccountHashesReqVersion) {
    throw new Error(`Unsupported version for GetAccountTrieHashesReq: ${version}`);
  }
  const radixListLength = stream.readUInt16();
  let radixList: string[] = [];
  if (radixListLength > 0) {
    radixList = stream.readString().split(',');
  }
  return {
    radixList,
  };
}
