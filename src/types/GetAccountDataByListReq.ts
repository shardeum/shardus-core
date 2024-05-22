import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { verifyPayload } from './ajv/Helpers'
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
  const errors = verifyPayload('GetAccountDataByListReq', obj)
  if (errors && errors.length > 0) {
    throw new Error('Data validation error')
  }
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cGetAccountDataByListReq)
  }
  stream.writeUInt8(cGetAccountDataByListReqVersion)
  stream.writeUInt32(obj.accountIds.length)
  for (const accountId of obj.accountIds) {
    stream.writeString(accountId)
  }
}

export function deserializeGetAccountDataByListReq(stream: VectorBufferStream): GetAccountDataByListReq {
  const version = stream.readUInt8()
  if (version > cGetAccountDataByListReqVersion) {
    throw new Error('GetAccountDataByListReq version mismatch')
  }
  const length = stream.readUInt32()
  const accountIds = []
  for (let i = 0; i < length; i++) {
    accountIds.push(stream.readString())
  }
  const errors = verifyPayload('GetAccountDataByListReq', accountIds)
  if (errors && errors.length > 0) {
    throw new Error('Data validation error')
  }
  return {
    accountIds,
  }
}
