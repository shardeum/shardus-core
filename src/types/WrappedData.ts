import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'

export const cWrappedDataVersion = 1

export interface WrappedData {
  accountCreated: boolean
  isPartial: boolean
  accountId: string
  stateId: string // hash of the data blob
  data: Buffer // data blob opaque
  timestamp: number // timestamp
}

export function serializeWrappedData(stream: VectorBufferStream, obj: WrappedData, root = false): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cWrappedData)
  }
  stream.writeUInt16(cWrappedDataVersion)
  stream.writeUInt8(obj.accountCreated ? 1 : 0)
  stream.writeUInt8(obj.isPartial ? 1 : 0)
  stream.writeString(obj.accountId)
  stream.writeString(obj.stateId)
  stream.writeBuffer(obj.data) // Serialize Buffer
  stream.writeDouble(obj.timestamp)
}

export function deserializeWrappedData(stream: VectorBufferStream): WrappedData {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const version = stream.readUInt16()
  return {
    accountCreated: stream.readUInt8() !== 0,
    isPartial: stream.readUInt8() !== 0,
    accountId: stream.readString(),
    stateId: stream.readString(),
    data: stream.readBuffer(), // Deserialize Buffer
    timestamp: stream.readDouble(),
  }
}
