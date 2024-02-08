import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { CachedAppData, deserializeCachedAppData, serializeCachedAppData } from './CachedAppData'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'

const cSendCachedAppDataReqVersion = 1

export type SendCachedAppDataReq = {
  topic: string
  cachedAppData: CachedAppData
}

export function serializeSendCachedAppDataReq(
  stream: VectorBufferStream,
  obj: SendCachedAppDataReq,
  root = false
): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cSendCachedAppDataReq)
  }
  stream.writeUInt16(cSendCachedAppDataReqVersion)
  stream.writeString(obj.topic)
  serializeCachedAppData(stream, obj.cachedAppData)
}

export function deserializeSendCachedAppDataReq(stream: VectorBufferStream): SendCachedAppDataReq {
  const version = stream.readUInt16()
  if (version > cSendCachedAppDataReqVersion) {
    throw new Error('Unsupported version')
  }
  return {
    topic: stream.readString(),
    cachedAppData: deserializeCachedAppData(stream),
  }
}
