import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { WrappedReq, serializeWrappedReq } from './WrappedReq'
import { WrappedResp, cWrappedResp, deserializeWrappedResp, serializeWrappedResp } from './WrappedResp'

export const responseSerializer = <T>(
  data: T,
  serializerFunc: (stream: VectorBufferStream, obj: T, root?: boolean) => void
): VectorBufferStream => {
  const serializedPayload = new VectorBufferStream(0)
  serializerFunc(serializedPayload, data, true)
  const resp: WrappedResp = {
    payload: serializedPayload.getBuffer(),
  }
  const wrappedRespStream = new VectorBufferStream(0)
  serializeWrappedResp(wrappedRespStream, resp, true)
  return wrappedRespStream
}

export const responseDeserializer = <T>(
  data: VectorBufferStream,
  deserializerFunc: (stream: VectorBufferStream, root?: boolean) => T
): T => {
  data.position = 0
  const responseType = data.readUInt16()
  if (responseType !== cWrappedResp) {
    throw new Error(`Invalid request stream: ${responseType}`)
  }
  const wrappedResp = deserializeWrappedResp(data)
  const payloadStream = VectorBufferStream.fromBuffer(wrappedResp.payload)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const payloadType = payloadStream.readUInt16()
  return deserializerFunc(payloadStream)
}

export const requestSerializer = <T>(
  data: T,
  serializerFunc: (stream: VectorBufferStream, obj: T, root?: boolean) => void
): VectorBufferStream => {
  const serializedPayload = new VectorBufferStream(0)
  serializerFunc(serializedPayload, data, true)
  const req: WrappedReq = {
    payload: serializedPayload.getBuffer(),
  }
  const wrappedReqStream = new VectorBufferStream(0)
  serializeWrappedReq(wrappedReqStream, req, true)
  return wrappedReqStream
}
