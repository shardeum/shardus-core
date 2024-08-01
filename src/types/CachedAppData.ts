import { stateManager } from '../p2p/Context'
import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { verifyPayload } from './ajv/Helpers'
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

  const errors = verifyPayload(AppObjEnum.CachedAppData, { cycle, appData, dataID })
  if(errors && errors.length > 0) {
    throw new Error('AJV: CachedAppData validation failed')
  }

  return {
    cycle,
    appData,
    dataID,
  }
}
