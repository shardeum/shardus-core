import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'

export type GetTrieHashesRequest = {
  radixList: string[]
}

export const cGetTrieHashesReqVersion = 1

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
  return { radixList }
}
