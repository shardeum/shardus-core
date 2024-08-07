import { VectorBufferStream } from '../utils/serialization/VectorBufferStream';
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum';

export type GlobalAccountReportRespSerializable =
  | {
      ready: boolean;
      combinedHash: string;
      accounts: { id: string; hash: string; timestamp: number }[];
    }
  | { error: string };

const cGlobalAccountReportRespVersion = 1;

export function serializeGlobalAccountReportResp(
  stream: VectorBufferStream,
  obj: GlobalAccountReportRespSerializable,
  root = false
): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cGlobalAccountReportResp);
  }
  stream.writeUInt8(cGlobalAccountReportRespVersion);
  if ('error' in obj) {
    stream.writeUInt8(0); // Error indicator
    stream.writeString(obj.error);
  } else {
    stream.writeUInt8(1); // Success indicator
    stream.writeString(obj.combinedHash);
    stream.writeUInt32(obj.accounts.length);
    obj.accounts.forEach((account) => {
      stream.writeString(account.id);
      stream.writeString(account.hash);
      stream.writeBigUInt64(BigInt(account.timestamp));
    });
    stream.writeUInt8(obj.ready ? 1 : 0);
  }
}

export function deserializeGlobalAccountReportResp(
  stream: VectorBufferStream
): GlobalAccountReportRespSerializable {
  const version = stream.readUInt8();
  if (version > cGlobalAccountReportRespVersion) {
    throw new Error('GlobalAccountReportRespSerializable version mismatch');
  }
  const responseType = stream.readUInt8();
  if (responseType === 0) {
    // Error response
    return { error: stream.readString() };
  } else {
    // Success response
    const combinedHash = stream.readString();
    const accountsLength = stream.readUInt32();
    const accounts = [];
    for (let i = 0; i < accountsLength; i++) {
      accounts.push({
        id: stream.readString(),
        hash: stream.readString(),
        timestamp: Number(stream.readBigUInt64()),
      });
    }
    const ready = stream.readUInt8() === 1;
    return { combinedHash, accounts, ready };
  }
}
