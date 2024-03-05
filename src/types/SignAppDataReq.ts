import { stateManager } from '../p2p/Context'
import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { AppObjEnum } from './enum/AppObjEnum'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'

export const cSignAppDataReqVersion = 1

export type SignAppDataReq = {
  type: string
  nodesToSign: number
  hash: string
  appData: unknown
}

export function serializeSignAppDataReq(stream: VectorBufferStream, obj: SignAppDataReq, root = false): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cSignAppDataReq)
  }
  stream.writeUInt8(cSignAppDataReqVersion)
  stream.writeString(obj.type)
  stream.writeUInt8(obj.nodesToSign)
  stream.writeString(obj.hash)
  stream.writeBuffer(stateManager.app.binarySerializeObject(AppObjEnum.AppData, obj.appData))
}

export function deserializeSignAppDataReq(stream: VectorBufferStream): SignAppDataReq {
  const version = stream.readUInt8()
  if (version > cSignAppDataReqVersion) {
    throw new Error(`SignAppDataReq version mismatch, version: ${version}`)
  }
  return {
    type: stream.readString(),
    nodesToSign: stream.readUInt8(),
    hash: stream.readString(),
    appData: stateManager.app.binaryDeserializeObject(AppObjEnum.AppData, stream.readBuffer()),
  }
}
