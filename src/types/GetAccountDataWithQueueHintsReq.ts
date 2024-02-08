import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'

const cGetAccountDataWithQueueHintsReqVersion = 1

export type GetAccountDataWithQueueHintsReqBinary = {
  accountIds: string[]
}

export function serializeGetAccountDataWithQueueHintsReq(
  stream: VectorBufferStream,
  obj: GetAccountDataWithQueueHintsReqBinary,
  root = false
): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cGetAccountDataWithQueueHintsReq)
  }
  stream.writeUInt16(cGetAccountDataWithQueueHintsReqVersion)
  stream.writeUInt32(obj.accountIds.length)
  for (const accountId of obj.accountIds) {
    stream.writeString(accountId)
  }
}

export function deserializeGetAccountDataWithQueueHintsReq(
  stream: VectorBufferStream
): GetAccountDataWithQueueHintsReqBinary {
  const version = stream.readUInt16()
  if (version > cGetAccountDataWithQueueHintsReqVersion) {
    throw new Error('Unsupported version')
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
