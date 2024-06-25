import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { verifyPayload } from './ajv/Helpers'
import { AJVSchemaEnum } from './enum/AJVSchemaEnum'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'

const cGetAppliedVoteReqVersion = 1

export type GetAppliedVoteReq = {
  txId: string
}

export function serializeGetAppliedVoteReq(
  stream: VectorBufferStream,
  obj: GetAppliedVoteReq,
  root = false
): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cGetAppliedVoteReq)
  }
  stream.writeUInt8(cGetAppliedVoteReqVersion)
  stream.writeString(obj.txId)
}

export function deserializeGetAppliedVoteReq(stream: VectorBufferStream): GetAppliedVoteReq {
  const version = stream.readUInt8()
  if (version > cGetAppliedVoteReqVersion) {
    throw new Error('GetAppliedVoteReq version mismatch')
  }
  const result = {
    txId: stream.readString(),
  }
  const errors = verifyPayload(AJVSchemaEnum.GetAppliedVoteReq, result)
  if (errors && errors.length > 0) {
    throw new Error(`AJV: validation error -> ${errors.join(', ')}`)
  }
  return result
}
