import { WrappedData, serializeWrappedData, deserializeWrappedData } from './WrappedData';
import { VectorBufferStream } from '../utils/serialization/VectorBufferStream';
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum';

export type GetAccountDataRespSerializable = {
  data?: {
    wrappedAccounts: WrappedData[];
    lastUpdateNeeded: boolean;
    wrappedAccounts2: WrappedData[];
    highestTs: number;
    delta: number;
  };
  errors?: string[];
};

const cGetAccountDataRespVersion = 1;

export function serializeGetAccountDataResp(
  stream: VectorBufferStream,
  obj: GetAccountDataRespSerializable,
  root = false
): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cGetAccountDataResp);
  }
  stream.writeUInt8(cGetAccountDataRespVersion);

  if (obj.data) {
    stream.writeUInt8(1);
    stream.writeUInt16(obj.data.wrappedAccounts.length);
    obj.data.wrappedAccounts.forEach((wrappedAccount) => serializeWrappedData(stream, wrappedAccount));
    stream.writeUInt8(obj.data.lastUpdateNeeded ? 1 : 0);
    stream.writeUInt16(obj.data.wrappedAccounts2.length);
    obj.data.wrappedAccounts2.forEach((wrappedAccount) => serializeWrappedData(stream, wrappedAccount));
    stream.writeBigUInt64(BigInt(obj.data.highestTs));
    stream.writeBigUInt64(BigInt(obj.data.delta));
  } else {
    stream.writeUInt8(0);
  }

  if (obj.errors) {
    stream.writeUInt8(1);
    stream.writeUInt16(obj.errors.length);
    obj.errors.forEach((error) => stream.writeString(error));
  } else {
    stream.writeUInt8(0);
  }
}

export function deserializeGetAccountDataResp(stream: VectorBufferStream): GetAccountDataRespSerializable {
  const version = stream.readUInt8();
  if (version > cGetAccountDataRespVersion) {
    throw new Error('GetAccountDataResp version mismatch');
  }
  let data, errors;

  if (stream.readUInt8() === 1) {
    // Check if data is present
    const wrappedAccountsLength = stream.readUInt16();
    const wrappedAccounts = [];
    for (let i = 0; i < wrappedAccountsLength; i++) {
      wrappedAccounts.push(deserializeWrappedData(stream));
    }
    const lastUpdateNeeded = stream.readUInt8() === 1;
    const wrappedAccounts2Length = stream.readUInt16();
    const wrappedAccounts2 = [];
    for (let i = 0; i < wrappedAccounts2Length; i++) {
      wrappedAccounts2.push(deserializeWrappedData(stream));
    }
    const highestTs = Number(stream.readBigUInt64());
    const delta = Number(stream.readBigUInt64());
    data = { wrappedAccounts, lastUpdateNeeded, wrappedAccounts2, highestTs, delta };
  }

  if (stream.readUInt8() === 1) {
    // Check if errors are present
    const errorsLength = stream.readUInt16();
    errors = [];
    for (let i = 0; i < errorsLength; i++) {
      errors.push(stream.readString());
    }
  }

  return {
    ...(data ? { data } : {}),
    ...(errors ? { errors } : {}),
  };
}
