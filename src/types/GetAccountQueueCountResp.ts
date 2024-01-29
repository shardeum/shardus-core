import { VectorBufferStream } from "../utils/serialization/VectorBufferStream";
import { TypeIdentifierEnum } from "./enum/TypeIdentifierEnum";

export type GetAccountQueueCountRespSerialized = {
  counts: number[]
  committingAppData: Buffer[]
  accounts: Buffer[]
} | false;

export const cGetAccountQueueCountRespVersion = 1;

export function serializeGetAccountQueueCountResp(
  stream: VectorBufferStream, 
  obj: GetAccountQueueCountRespSerialized,
  root = false
): void {
  
    if (root) {
      stream.writeUInt16(TypeIdentifierEnum.cGetAccountQueueCountResp);
    }


    stream.writeUInt8(cGetAccountQueueCountRespVersion);

    stream.writeUInt8(obj ? 1 : 0);

    if (!obj) {
      return;
    }

    stream.writeUInt32(obj.counts.length || 0 );
    for (let i = 0; i < obj.counts.length; i++) {
      stream.writeUInt32(obj.counts[i]);
    };
    stream.writeUInt32(obj.committingAppData.length || 0 );
    for (let i = 0; i < obj.committingAppData.length; i++) {
      stream.writeBuffer(obj.committingAppData[i]);
    };
    stream.writeUInt32(obj.accounts.length || 0 );
    for (let i = 0; i < obj.accounts.length; i++) {
      stream.writeBuffer(obj.accounts[i]);
    };

}

export function deserializeGetAccountQueueCountResp(
  stream: VectorBufferStream
): GetAccountQueueCountRespSerialized {

  const obj: GetAccountQueueCountRespSerialized = {
    counts: [],
    committingAppData: [],
    accounts: [],
  };

  const version = stream.readUInt8();
  if (version !== cGetAccountQueueCountRespVersion) {
    throw new Error(
      `GetAccountQueueCountResp version mismatch, expected: ${cGetAccountQueueCountRespVersion} got: ${version}`
    );
  }

  const hasValue = stream.readUInt8();
  if (!hasValue) {
    return false;
  }

  const countCount = stream.readUInt32();
  for (let i = 0; i < countCount; i++) {
    obj.counts.push(stream.readUInt32());
  }
  const committingAppDataCount = stream.readUInt32();
  for (let i = 0; i < committingAppDataCount; i++) {
    obj.committingAppData.push(stream.readBuffer());
  }
  const accountsCount = stream.readUInt32();
  for (let i = 0; i < accountsCount; i++) {
    obj.accounts.push(stream.readBuffer());
  }

  return obj;

}
