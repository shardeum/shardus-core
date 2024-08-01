import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { verifyPayload } from './ajv/Helpers'
import { AJVSchemaEnum } from './enum/AJVSchemaEnum'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'

export type GetCachedAppDataReq = {
  topic: string
  dataId: string
}

const cGetCachedAppDataReqVersion = 1

export function serializeGetCachedAppDataReq(
  stream: VectorBufferStream,
  request: GetCachedAppDataReq,
  root = false
): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cGetCachedAppDataReq)
  }
  stream.writeUInt8(cGetCachedAppDataReqVersion)
  stream.writeString(request.topic)
  stream.writeString(request.dataId)
}

export function deserializeGetCachedAppDataReq(stream: VectorBufferStream): GetCachedAppDataReq {
  const version = stream.readUInt8()
  if (version > cGetCachedAppDataReqVersion) {
    throw new Error('Unsupported version in deserializeGetCachedAppDataReq')
  }
  const topic = stream.readString()
  const dataId = stream.readString()
  const req = { topic, dataId }

  const errors = verifyPayload(AJVSchemaEnum.GetCachedAppDataReq, req)
  if (errors && errors.length > 0) {
    throw new Error(`AJV: validation error -> ${errors.join(', ')}`)
  }
  return req
}
