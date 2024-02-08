import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'

export type GetAccountQueueCountReq = {
  accountIds: string[]
}

const cGetAccountQueueCountReqVersion = 1

export function serializeGetAccountQueueCountReq(
  stream: VectorBufferStream,
  obj: GetAccountQueueCountReq,
  root = false
): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cGetAccountQueueCountReq)
  }
  stream.writeUInt16(cGetAccountQueueCountReqVersion)
  stream.writeUInt32(obj.accountIds.length)
  for (const accountId of obj.accountIds) {
    stream.writeString(accountId)
  }
}

export function deserializeGetAccountQueueCountReq(stream: VectorBufferStream): GetAccountQueueCountReq {
  const version = stream.readUInt16()
  if (version > cGetAccountQueueCountReqVersion) {
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
