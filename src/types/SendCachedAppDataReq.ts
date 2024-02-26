import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { CachedAppDataSerializable, deserializeCachedAppData, serializeCachedAppData } from './CachedAppData'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'

const cSendCachedAppDataReqVersion = 1

export type SendCachedAppDataReq = {
  topic: string
  cachedAppData: CachedAppDataSerializable
}

export function serializeSendCachedAppDataReq(
  stream: VectorBufferStream,
  obj: SendCachedAppDataReq,
  root = false
): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cSendCachedAppDataReq)
  }
  stream.writeUInt8(cSendCachedAppDataReqVersion)
  stream.writeString(obj.topic)
  serializeCachedAppData(stream, obj.cachedAppData)
}

export function deserializeSendCachedAppDataReq(stream: VectorBufferStream): SendCachedAppDataReq {
  const version = stream.readUInt8()
  if (version > cSendCachedAppDataReqVersion) {
    throw new Error('SendCachedAppDataReq version mismatch')
  }
  return {
    topic: stream.readString(),
    cachedAppData: deserializeCachedAppData(stream),
  }
}
