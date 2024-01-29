import { VectorBufferStream } from "../utils/serialization/VectorBufferStream";
import { TypeIdentifierEnum } from "./enum/TypeIdentifierEnum";

export const cWrappedDataSyncSerializedVersion = 1;
export interface WrappedDataSyncSerialized {
  /** Account ID */
  accountId: string
  /** hash of the data blob */
  stateId: string
  /** data blob opaqe */
  data: Buffer
  /** Timestamp */
  timestamp: number
  syncData?: Buffer
}

export const cGetAccountDataByListRespVersion = 1;
export type getAccountDataByListRespSerialized = {
  accountData:  WrappedDataSyncSerialized[] | null
};

export function serializeGetAccountDataByListRespSerialized(
  stream: VectorBufferStream, 
  obj: getAccountDataByListRespSerialized,
  root = false
): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cGetAccountDataByListResp);
  }
  stream.writeUInt16(cGetAccountDataByListRespVersion);
  if (obj.accountData === null) {
    stream.writeUInt8(0);
  } else {
    stream.writeUInt8(1);
    stream.writeUInt32(obj.accountData ? obj.accountData.length : 0);
    for (let i = 0; i < obj.accountData.length; i++) {
      serializeWrappedDataSyncSerialized(stream, obj.accountData[i]);
    }
  }
}


export function deserializeGetAccountDataByListRespSerialized(
  stream: VectorBufferStream, 
): getAccountDataByListRespSerialized {
  const obj: any = {};
  const version = stream.readUInt16();
  if (version !== cGetAccountDataByListRespVersion) {
    throw new Error(`invalid version ${version}`);
  }
  if (stream.readUInt8() === 0) {
    obj.accountData = null;
  } else {
    const accountDataLength = stream.readUInt32();
    obj.accountData = [];
    for (let i = 0; i < accountDataLength; i++) {
      obj.accountData.push(deserializeWrappedDataSyncSerialized(stream));
    }
  }
  return obj;
}



export function serializeWrappedDataSyncSerialized(
  stream: VectorBufferStream, 
  obj: WrappedDataSyncSerialized,
  root = false
): void {
  
    if (root) {
      stream.writeUInt16(TypeIdentifierEnum.cWrappedDataSyncSerialized);
    }
    stream.writeUInt16(cWrappedDataSyncSerializedVersion);
    stream.writeString(obj.accountId);
    stream.writeString(obj.stateId);
    stream.writeBuffer(obj.data);
    stream.writeString(obj.timestamp.toString());
    stream.writeUInt8(obj.syncData ? 1 : 0);
    if (obj.syncData) {
      stream.writeBuffer(obj.syncData);
    }
}

export function deserializeWrappedDataSyncSerialized(
  stream: VectorBufferStream, 
): WrappedDataSyncSerialized {
  
    const obj: any = {};
    const version = stream.readUInt16();
    if (version !== cWrappedDataSyncSerializedVersion) {
      throw new Error(`invalid version ${version}`);
    }
    obj.accountId = stream.readString();
    obj.stateId = stream.readString();
    obj.data = stream.readBuffer();
    obj.timestamp = parseInt(stream.readString());
    if (stream.readUInt8() === 1) {
      obj.syncData = stream.readBuffer();
    }
    return obj;
}
