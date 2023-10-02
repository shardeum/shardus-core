import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'

export const cWrappedResp = 4
export const cWrappedRespVersion = 1

export interface WrappedResp {
  payload: Buffer
}

export function serializeWrappedResp(stream: VectorBufferStream, obj: WrappedResp, root = false): void {
  if (root) {
    stream.writeUInt16(cWrappedResp)
  }
  stream.writeUInt16(cWrappedRespVersion)
  stream.writeBuffer(obj.payload)
}

export function deserializeWrappedResp(stream: VectorBufferStream): WrappedResp {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const version = stream.readUInt16()
  const payload = stream.readBuffer()

  const obj: WrappedResp = {
    payload,
  }

  return obj
}
