import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'

export type CachedAppData = {
  cycle: number
  appData: Buffer
  dataID: string
}

export function serializeCachedAppData(stream: VectorBufferStream, obj: CachedAppData, root = false): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cCachedAppData)
  }
  stream.writeUInt32(obj.cycle)
  stream.writeBuffer(obj.appData)
  stream.writeString(obj.dataID)
}

export function deserializeCachedAppData(stream: VectorBufferStream): CachedAppData {
  const cycle = stream.readUInt32()
  const appData = stream.readBuffer()
  const dataID = stream.readString()
  return {
    cycle,
    appData,
    dataID,
  }
}
