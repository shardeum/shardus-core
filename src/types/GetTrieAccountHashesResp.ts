import { VectorBufferStream } from '../utils/serialization/VectorBufferStream';
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum';

export const cGetTrieAccountHashesRespVersion = 1;
export const cRadixAndChildHashesVersion = 1;

export type GetTrieAccountHashesResp = {
  nodeChildHashes: RadixAndChildHashes[];
  stats: {
    matched: number;
    visisted: number;
    empty: number;
    childCount: number;
  };
};

export type RadixAndChildHashes = {
  radix: string;
  childAccounts: AccountIDAndHash[];
};

export type AccountIDAndHash = {
  accountID: string;
  hash: string;
};

export function serializeGetTrieAccountHashesResp(
  stream: VectorBufferStream,
  req: GetTrieAccountHashesResp,
  root = false
): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cGetAccountTrieHashesResp);
  }
  stream.writeUInt8(cGetTrieAccountHashesRespVersion);
  stream.writeUInt16(req.nodeChildHashes.length);
  for (let i = 0; i < req.nodeChildHashes.length; i++) {
    // eslint-disable-next-line security/detect-object-injection
    serializeRadixAndChildHashes(stream, req.nodeChildHashes[i]);
  }
  stream.writeUInt32(req.stats.matched);
  stream.writeUInt32(req.stats.visisted);
  stream.writeUInt32(req.stats.empty);
  stream.writeUInt32(req.stats.childCount);
}

export function deserializeGetTrieAccountHashesResp(stream: VectorBufferStream): GetTrieAccountHashesResp {
  const version = stream.readUInt8();
  if (version !== cGetTrieAccountHashesRespVersion) {
    throw new Error(`Unsupported version for GetAccountTrieHashesResp: ${version}`);
  }
  const nodeChildHashesLength = stream.readUInt16();
  const nodeChildHashes: RadixAndChildHashes[] = [];
  for (let i = 0; i < nodeChildHashesLength; i++) {
    nodeChildHashes.push(deserializeRadixAndChildHashes(stream));
  }
  return {
    nodeChildHashes,
    stats: {
      matched: stream.readUInt32(),
      visisted: stream.readUInt32(),
      empty: stream.readUInt32(),
      childCount: stream.readUInt32(),
    },
  };
}

export function serializeRadixAndChildHashes(
  stream: VectorBufferStream,
  req: RadixAndChildHashes,
  root = false
): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cRadixAndChildHashes);
  }
  stream.writeUInt8(cRadixAndChildHashesVersion);
  stream.writeString(req.radix);
  stream.writeUInt16(req.childAccounts.length);
  for (let i = 0; i < req.childAccounts.length; i++) {
    // eslint-disable-next-line security/detect-object-injection
    stream.writeString(req.childAccounts[i].accountID);
    // eslint-disable-next-line security/detect-object-injection
    stream.writeString(req.childAccounts[i].hash);
  }
}

export function deserializeRadixAndChildHashes(stream: VectorBufferStream): RadixAndChildHashes {
  const version = stream.readUInt8();
  if (version !== cRadixAndChildHashesVersion) {
    throw new Error(`Unsupported version for RadixAndChildHashes: ${version}`);
  }
  const radix = stream.readString();
  const childAccountsLength = stream.readUInt16();
  const childAccounts: AccountIDAndHash[] = [];
  for (let i = 0; i < childAccountsLength; i++) {
    childAccounts.push({
      accountID: stream.readString(),
      hash: stream.readString(),
    });
  }
  return {
    radix,
    childAccounts,
  };
}
