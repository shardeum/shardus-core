import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'

export type GetAccountDataByListReq = {
  accountIds: string[]
}

export const cGetAccountDataByListReqVersion = 1

export function serializeGetAccountDataByListReq(
  stream: VectorBufferStream,
  obj: GetAccountDataByListReq,
  root = false
): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cGetAccountDataByListReq)
  }
  stream.writeUInt16(cGetAccountDataByListReqVersion)
  stream.writeUInt32(obj.accountIds.length)
  for (const accountId of obj.accountIds) {
    stream.writeString(accountId)
  }
}

export function deserializeGetAccountDataByListReq(stream: VectorBufferStream): GetAccountDataByListReq {
  const version = stream.readUInt16()
  if (version > cGetAccountDataByListReqVersion) {
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
