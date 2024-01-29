import { VectorBufferStream } from "../utils/serialization/VectorBufferStream";
import { TypeIdentifierEnum } from "./enum/TypeIdentifierEnum";

const cGetAccountDataWithQueueHintsReqVersion = 1;

export type GetAccountDataWithQueueHintsReqSerialized = {
  accountIds: string[];
}


export function serializeGetAccountDataWithQueueHintsReq(
  stream: VectorBufferStream, 
  obj: GetAccountDataWithQueueHintsReqSerialized,
  root = false
): void {

  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cGetAccountDataWithQueueHintsReq);
  }

  stream.writeUInt8(cGetAccountDataWithQueueHintsReqVersion);
  stream.writeUInt32(obj.accountIds.length || 0 );
  for (let i = 0; i < obj.accountIds.length; i++) {
    stream.writeString(obj.accountIds[i]);
  };
}


export function deserializeGetAccountDataWithQueueHintsReq(
  stream: VectorBufferStream,
): GetAccountDataWithQueueHintsReqSerialized {


  const obj: GetAccountDataWithQueueHintsReqSerialized = {
    accountIds: [],
  };
  const cGetAccountDataWithQueueHintsReqVersion = stream.readUInt8();
  if (cGetAccountDataWithQueueHintsReqVersion !== 1) {
    throw new Error(`Expected version 1. Actual version: ${cGetAccountDataWithQueueHintsReqVersion}`);
  }
  const accountIdsLength = stream.readUInt32();
  for (let i = 0; i < accountIdsLength; i++) {
    obj.accountIds.push(stream.readString());
  };
  return obj;
}
