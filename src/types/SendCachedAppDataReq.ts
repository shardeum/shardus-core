import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { CachedAppDataSerializable, deserializeCachedAppData, serializeCachedAppData } from './CachedAppData'
import { verifyPayload } from './ajv/Helpers'
import { AJVSchemaEnum } from './enum/AJVSchemaEnum'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'

const cSendCachedAppDataReqVersion = 1

export type SendCachedAppDataReq = {
  topic: string,
  txId: string,
  executionShardKey: string
  cachedAppData: CachedAppDataSerializable,
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
  stream.writeString(obj.txId)
  stream.writeString(obj.executionShardKey)
  serializeCachedAppData(stream, obj.cachedAppData)
}

export function deserializeSendCachedAppDataReq(stream: VectorBufferStream): SendCachedAppDataReq {
  const version = stream.readUInt8()
  if (version > cSendCachedAppDataReqVersion) {
    throw new Error('SendCachedAppDataReq version mismatch')
  }

  const data = {
    topic: stream.readString(),
    txId: stream.readString(),
    executionShardKey: stream.readString(),
    cachedAppData: deserializeCachedAppData(stream),
  }

  const errors = verifyPayload(AJVSchemaEnum.SendCachedAppDataReq, data)

  if (errors && errors.length > 0) {
    throw new Error('AJV: SendCachedAppDataReq validation failed')
  }

  return data
}
