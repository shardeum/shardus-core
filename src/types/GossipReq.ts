import { safeJsonParse, safeStringify } from '@shardus/types/build/src/utils/functions/stringify'
import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'

export interface GossipReqBinary {
  type: string
  data: unknown
}

const cGossipReqVersion = 1

export function serializeGossipReq(stream: VectorBufferStream, obj: GossipReqBinary, root = false): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cGossipReq)
  }
  stream.writeUInt8(cGossipReqVersion)
  stream.writeString(obj.type)
  stream.writeString(safeStringify(obj.data))
}

export function deserializeGossipReq(stream: VectorBufferStream): GossipReqBinary {
  const version = stream.readUInt8()
  if (version > cGossipReqVersion) {
    throw new Error('GossipReq version mismatch')
  }
  const type = stream.readString()
  const data = safeJsonParse(stream.readString()) as unknown
  return { type, data }
}
