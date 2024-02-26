import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'

export const cWrappedRespVersion = 1

export interface WrappedResp {
  payload: Buffer
}

export function serializeWrappedResp(stream: VectorBufferStream, obj: WrappedResp, root = false): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cWrappedResp)
  }
  stream.writeUInt8(cWrappedRespVersion)
  stream.writeBuffer(obj.payload)
}

export function deserializeWrappedResp(stream: VectorBufferStream): WrappedResp {
  const version = stream.readUInt8()
  if (version > cWrappedRespVersion) {
    throw new Error('WrappedResp version mismatch')
  }
  const payload = stream.readBuffer()

  const obj: WrappedResp = {
    payload,
  }

  return obj
}
