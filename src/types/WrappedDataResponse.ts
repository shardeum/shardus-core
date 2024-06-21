import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { WrappedData, deserializeWrappedData, serializeWrappedData } from './WrappedData'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'
import { verifyPayload } from './ajv/Helpers'
import { AJV_IDENT } from './ajv/Helpers'

export const cWrappedDataResponseVersion = 1

export interface WrappedDataResponse extends WrappedData {
  accountCreated: boolean
  isPartial: boolean
}

export function serializeWrappedDataResponse(
  stream: VectorBufferStream,
  obj: WrappedDataResponse,
  root = false
): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cWrappedDataResponse)
  }
  stream.writeUInt8(cWrappedDataResponseVersion)
  serializeWrappedData(stream, obj)
  stream.writeUInt8(obj.accountCreated ? 1 : 0)
  stream.writeUInt8(obj.isPartial ? 1 : 0)
}

export function deserializeWrappedDataResponse(stream: VectorBufferStream): WrappedDataResponse {
  const version = stream.readUInt8()
  if (version > cWrappedDataResponseVersion) {
    throw new Error('WrappedDataResponse version mismatch')
  }
  const wrappedData = deserializeWrappedData(stream)
  const accountCreated = stream.readUInt8() !== 0
  const isPartial = stream.readUInt8() !== 0
  const errors = verifyPayload(AJV_IDENT.WRAPPED_DATA_RESPONSE, {
    ...wrappedData,
    accountCreated,
    isPartial,
  })
  if (errors && errors.length > 0) {
    throw new Error('Data validation error')
  }
  return {
    ...wrappedData,
    accountCreated,
    isPartial,
  }
}
