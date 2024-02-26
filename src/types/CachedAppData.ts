import { stateManager } from '../p2p/Context'
import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { AppObjEnum } from './enum/AppObjEnum'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'

export type CachedAppDataSerializable = {
  cycle: number
  appData: unknown
  dataID: string
}

export function serializeCachedAppData(
  stream: VectorBufferStream,
  obj: CachedAppDataSerializable,
  root = false
): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cCachedAppData)
  }
  stream.writeUInt32(obj.cycle)
  stream.writeBuffer(stateManager.app.binarySerializeObject(AppObjEnum.CachedAppData, obj.appData))
  stream.writeString(obj.dataID)
}

export function deserializeCachedAppData(stream: VectorBufferStream): CachedAppDataSerializable {
  const cycle = stream.readUInt32()
  const appData = stateManager.app.binaryDeserializeObject(AppObjEnum.CachedAppData, stream.readBuffer())
  const dataID = stream.readString()
  return {
    cycle,
    appData,
    dataID,
  }
}
