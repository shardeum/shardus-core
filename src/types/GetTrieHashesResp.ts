import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'
import { verifyPayload } from './ajv/Helpers'
import { AJVSchemaEnum } from './enum/AJVSchemaEnum'

export type GetTrieHashesResponse = {
  nodeHashes: { radix: string; hash: string }[]
  nodeId?: string
}

const cGetTrieHashesRespVersion = 1

export function serializeGetTrieHashesResp(
  stream: VectorBufferStream,
  response: GetTrieHashesResponse,
  root = false
): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cGetTrieHashesResp)
  }
  stream.writeUInt8(cGetTrieHashesRespVersion)
  stream.writeString(response.nodeId || '')
  stream.writeUInt32(response.nodeHashes.length)
  for (const { radix, hash } of response.nodeHashes) {
    stream.writeString(radix)
    stream.writeString(hash)
  }
}

export function deserializeGetTrieHashesResp(stream: VectorBufferStream): GetTrieHashesResponse {
  const version = stream.readUInt8()
  if (version > cGetTrieHashesRespVersion) {
    throw new Error('Unsupported version in deserializeGetTrieHashesResp')
  }
  const nodeId = stream.readString()
  const length = stream.readUInt32()
  const hashes = []
  for (let i = 0; i < length; i++) {
    const radix = stream.readString()
    const hash = stream.readString()
    hashes.push({ radix, hash })
  }

  const errors = verifyPayload(AJVSchemaEnum.GetTrieHashesResp, { nodeHashes: hashes, nodeId: nodeId || '' })
  if (errors && errors.length > 0) {
    throw new Error('AJV: GetTrieHashesResp validation error')
  }

  return { nodeHashes: hashes, nodeId: nodeId || '' }
}
