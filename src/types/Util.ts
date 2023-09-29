import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'

export const binarySerialize = <T>(
  data: T,
  serializerFunc: (stream: VectorBufferStream, obj: T, root?: boolean) => void
): VectorBufferStream => {
  const serializedPayload = new VectorBufferStream(0)
  serializerFunc(serializedPayload, data, true)
  return serializedPayload
}
