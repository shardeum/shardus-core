import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'
import {
  deserializeWrappedDataFromQueue,
  serializeWrappedDataFromQueue,
  WrappedDataFromQueueSerializable,
} from './WrappedDataFromQueue'

export const cGetAccountDataWithQueueHintsRespVersion = 1

export type GetAccountDataWithQueueHintsRespSerializable = {
  accountData: WrappedDataFromQueueSerializable[] | null
}

export function serializeGetAccountDataWithQueueHintsResp(
  stream: VectorBufferStream,
  obj: GetAccountDataWithQueueHintsRespSerializable,
  root = false
): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cGetAccountDataWithQueueHintsResp)
  }
  stream.writeUInt8(cGetAccountDataWithQueueHintsRespVersion)
  if (obj.accountData !== null) {
    stream.writeUInt8(1)
    stream.writeUInt16(obj.accountData.length)
    for (const item of obj.accountData) {
      serializeWrappedDataFromQueue(stream, item)
    }
  } else {
    stream.writeUInt8(0)
  }
}

export function deserializeGetAccountDataWithQueueHintsResp(
  stream: VectorBufferStream
): GetAccountDataWithQueueHintsRespSerializable {
  const version = stream.readUInt8()
  if (version > cGetAccountDataWithQueueHintsRespVersion) {
    throw new Error('GetAccountDataWithQueueHintsResp version mismatch')
  }
  const accountDataPresent = stream.readUInt8()
  let accountData = null
  if (accountDataPresent === 1) {
    const length = stream.readUInt16()
    accountData = []
    for (let i = 0; i < length; i++) {
      accountData.push(deserializeWrappedDataFromQueue(stream)) // Deserialize each WrappedDataFromQueueBinary
    }
  }
  console.log("The data is: ", accountData)
  return {
    accountData,
  }
}
