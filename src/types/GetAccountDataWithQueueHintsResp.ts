import Shardus from "../shardus";
import { VectorBufferStream } from "../utils/serialization/VectorBufferStream";
import { TypeIdentifierEnum } from "./enum/TypeIdentifierEnum";
import { deserializeWrappedDataFromQueue, serializeWrappedDataFromQueue, WrappedDataFromQueueSerialized } from "./WrappedDataFromQueue";

const cGetAccountDataWithQueueHintsRespVersion = 1;

export type GetAccountDataWithQueueHintsRespSerialized = {
  accountData: WrappedDataFromQueueSerialized[] | null;
}

export function serializeGetAccountDataWithQueueHintsResp(
  stream: VectorBufferStream, 
  obj: GetAccountDataWithQueueHintsRespSerialized,
  root = false
): void {

  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cGetAccountDataWithQueueHintsResp);
  }

  stream.writeUInt8(cGetAccountDataWithQueueHintsRespVersion);

  if (obj.accountData === null) {
    stream.writeUInt8(0); // null
  } else {
    stream.writeUInt8(1); // not null
    stream.writeUInt32(obj.accountData.length || 0);
    for (let i = 0; i < obj.accountData.length; i++) {
      serializeWrappedDataFromQueue(stream, obj.accountData[i]);
    };
  }

}

export function deserializeGetAccountDataWithQueueHintsResp(
  stream: VectorBufferStream,
): GetAccountDataWithQueueHintsRespSerialized {
  const obj: GetAccountDataWithQueueHintsRespSerialized = {
    accountData: null,
  };
  const cGetAccountDataWithQueueHintsRespVersion = stream.readUInt8();
  if (cGetAccountDataWithQueueHintsRespVersion !== 1) {
    throw new Error(`Expected version 1. Actual version: ${cGetAccountDataWithQueueHintsRespVersion}`);
  }
  const accountDataNull = stream.readUInt8() === 0;
  if (!accountDataNull) {
    const accountDataLength = stream.readUInt32();
    obj.accountData = [];
    for (let i = 0; i < accountDataLength; i++) {
      obj.accountData.push(deserializeWrappedDataFromQueue(stream));
    };
  }
  return obj;
}

