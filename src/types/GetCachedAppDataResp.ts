import { stateManager } from '../p2p/Context'
import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { verifyPayload } from './ajv/Helpers'
import { AJVSchemaEnum } from './enum/AJVSchemaEnum'
import { AppObjEnum } from './enum/AppObjEnum'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'

export type GetCachedAppDataResp = {
  cachedAppData?: {
    dataID: string
    appData: unknown
    cycle: number
  }
}

const cGetCachedAppDataRespVersion = 1

export function serializeGetCachedAppDataResp(
  stream: VectorBufferStream,
  response: GetCachedAppDataResp,
  root = false
): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cGetCachedAppDataResp)
  }
  stream.writeUInt8(cGetCachedAppDataRespVersion)

  if (response.cachedAppData) {
    stream.writeUInt8(1)
    stream.writeString(response.cachedAppData.dataID)
    stream.writeBuffer(
      stateManager.app.binarySerializeObject(AppObjEnum.CachedAppData, response.cachedAppData.appData)
    )
    stream.writeUInt32(response.cachedAppData.cycle)
  } else {
    stream.writeUInt8(0)
  }
}

export function deserializeGetCachedAppDataResp(stream: VectorBufferStream): GetCachedAppDataResp {
  const version = stream.readUInt8()
  if (version > cGetCachedAppDataRespVersion) {
    throw new Error('Unsupported version in deserializeGetCachedAppDataResp')
  }

  let resp = {}

  if (stream.readUInt8() === 1) {
    const dataID = stream.readString()
    const appData = stateManager.app.binaryDeserializeObject(AppObjEnum.CachedAppData, stream.readBuffer())
    const cycle = stream.readUInt32()
    resp = {
      cachedAppData: {
        dataID,
        appData,
        cycle,
      },
    }
  }

  const errors = verifyPayload(AJVSchemaEnum.GetCachedAppDataResp, resp)
  if (errors && errors.length > 0) {
    throw new Error(`AJV: validation error -> ${errors.join(', ')}`)
  }

  return resp
}
