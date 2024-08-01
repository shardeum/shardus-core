import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'
import { verifyPayload } from './ajv/Helpers'
import { AJVSchemaEnum } from './enum/AJVSchemaEnum'

export type GetTrieHashesRequest = {
  radixList: string[]
}

const cGetTrieHashesReqVersion = 1

export function serializeGetTrieHashesReq(
  stream: VectorBufferStream,
  request: GetTrieHashesRequest,
  root = false
): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cGetTrieHashesReq)
  }
  stream.writeUInt8(cGetTrieHashesReqVersion)
  stream.writeUInt32(request.radixList.length)
  for (const radix of request.radixList) {
    stream.writeString(radix)
  }
}

export function deserializeGetTrieHashesReq(stream: VectorBufferStream): GetTrieHashesRequest {
  const version = stream.readUInt8()
  if (version > cGetTrieHashesReqVersion) {
    throw new Error('Unsupported version in deserializeGetTrieHashesReq')
  }
  const length = stream.readUInt32()
  const radixList = []
  for (let i = 0; i < length; i++) {
    radixList.push(stream.readString())
  }
  const errors = verifyPayload(AJVSchemaEnum.GetTrieHashesReq, { radixList })
  if (errors && errors.length > 0) {
    throw new Error('AJV: GetTrieHashesReq validation error')
  }
  return { radixList }
}
