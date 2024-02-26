import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'

export const cWrappedReqVersion = 1

export interface WrappedReq {
  payload: Buffer
}

export function serializeWrappedReq(stream: VectorBufferStream, obj: WrappedReq, root = false): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cWrappedReq)
  }
  stream.writeUInt8(cWrappedReqVersion)
  stream.writeBuffer(obj.payload)
}

export function deserializeWrappedReq(stream: VectorBufferStream): WrappedReq {
  const version = stream.readUInt8()
  if (version > cWrappedReqVersion) {
    throw new Error('WrappedReq version mismatch')
  }
  const payload = stream.readBuffer()

  const obj: WrappedReq = {
    payload,
  }

  return obj
}
