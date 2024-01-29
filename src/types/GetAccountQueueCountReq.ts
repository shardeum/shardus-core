import { VectorBufferStream } from "../utils/serialization/VectorBufferStream";
import { TypeIdentifierEnum } from "./enum/TypeIdentifierEnum";
import { GetAccountDataWithQueueHintsReqSerialized } from "./GetAccountDataWithQueueHintsReq";


export type GetAccountQueueCountReq = GetAccountDataWithQueueHintsReqSerialized;

const cGetAccountQueueCountReqVersion = 1;

export function serializeGetAccountQueueCountReq(
  stream: VectorBufferStream, 
  obj: GetAccountQueueCountReq,
  root = false
): void {

  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cGetAccountQueueCountReq);
  }

  stream.writeUInt8(cGetAccountQueueCountReqVersion);
  stream.writeUInt32(obj.accountIds.length || 0 );
  for (let i = 0; i < obj.accountIds.length; i++) {
    stream.writeString(obj.accountIds[i]);
  };
}


export function deserializeGetAccountQueueCountReq(
  stream: VectorBufferStream,
): GetAccountQueueCountReq {

  const obj: GetAccountQueueCountReq = {
    accountIds: [],
  };

  const version = stream.readUInt8();
  if (version !== cGetAccountQueueCountReqVersion) {
    throw new Error(
      `GetAccountQueueCountReq version mismatch, expected: ${cGetAccountQueueCountReqVersion} got: ${version}`
    );
  }

  const accountIdCount = stream.readUInt32();
  for (let i = 0; i < accountIdCount; i++) {
    obj.accountIds.push(stream.readString());
  }

  return obj;

}
