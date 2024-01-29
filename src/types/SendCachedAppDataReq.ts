import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { CachedAppData, deserializeCachedAppData, serializeCachedAppData } from './CachedAppData'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'

export type SendCachedAppDataReq = {
  topic: string
  cachedAppData: CachedAppData 
}

export function serializeSendCachedAppDataReq (
  stream: VectorBufferStream, 
  obj: SendCachedAppDataReq,
  root = false
): void {
  if(root) {
    stream.writeUInt16(TypeIdentifierEnum.cSendCachedAppDataReq)
  }
  stream.writeString(obj.topic)
  serializeCachedAppData(stream, obj.cachedAppData)
}

export function deserializeSendCachedAppDataReq(
  stream: VectorBufferStream,
): SendCachedAppDataReq {
  const topic = stream.readString()
  const cachedAppData = deserializeCachedAppData(stream)
  return {
    topic,
    cachedAppData
  }
}



