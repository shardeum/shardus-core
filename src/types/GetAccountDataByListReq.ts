import { VectorBufferStream } from "../utils/serialization/VectorBufferStream";
import { TypeIdentifierEnum } from "./enum/TypeIdentifierEnum";
import { GetAccountDataWithQueueHintsReqSerialized } from "./GetAccountDataWithQueueHintsReq";

export type GetAccountDataByListReq = GetAccountDataWithQueueHintsReqSerialized;

export const cGetAccountDataByListReqVersion = 1;


export function serializeGetAccountDataByListReq(
  stream: VectorBufferStream, 
  obj: GetAccountDataByListReq,
  root = false
): void {

  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cGetAccountDataByListReq);
  }

  stream.writeUInt8(cGetAccountDataByListReqVersion);
  stream.writeUInt32(obj.accountIds.length || 0 );
  for (let i = 0; i < obj.accountIds.length; i++) {
    stream.writeString(obj.accountIds[i]);
  };
}

export function deserializeGetAccountDataByListReq(
  stream: VectorBufferStream,
): GetAccountDataByListReq {
  
    const obj: GetAccountDataByListReq = {
      accountIds: [],
    };
  
    const version = stream.readUInt8();
    if (version !== cGetAccountDataByListReqVersion) {
      throw new Error(
        `GetAccountDataByListReq version mismatch, expected: ${cGetAccountDataByListReqVersion} got: ${version}`
      );
    }
  
    const accountIdCount = stream.readUInt32();
    for (let i = 0; i < accountIdCount; i++) {
      obj.accountIds.push(stream.readString());
    }
  
    return obj;
  
  }
