import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'

const cGetAccountDataWithQueueHintsReqVersion = 1

export type GetAccountDataWithQueueHintsReqSerializable = {
  accountIds: string[]
}

export function serializeGetAccountDataWithQueueHintsReq(
  stream: VectorBufferStream,
  obj: GetAccountDataWithQueueHintsReqSerializable,
  root = false
): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cGetAccountDataWithQueueHintsReq)
  }
  stream.writeUInt8(cGetAccountDataWithQueueHintsReqVersion)
  stream.writeUInt32(obj.accountIds.length)
  for (const accountId of obj.accountIds) {
    stream.writeString(accountId)
  }
}

export function deserializeGetAccountDataWithQueueHintsReq(
  stream: VectorBufferStream
): GetAccountDataWithQueueHintsReqSerializable {
  const version = stream.readUInt8()
  if (version > cGetAccountDataWithQueueHintsReqVersion) {
    throw new Error('GetAccountDataWithQueueHintsReq version mismatch')
  }
  const length = stream.readUInt32()
  const accountIds = []
  for (let i = 0; i < length; i++) {
    accountIds.push(stream.readString())
  }
  return {
    accountIds,
  }
}
