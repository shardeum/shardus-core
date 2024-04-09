import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { ResponseErrorEnum } from './enum/ResponseErrorEnum'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'

export const cResponseErrorVersion = 1

export class ResponseError extends Error {
  Code: ResponseErrorEnum // Standard error codes
  AppCode: number // Route specific error codes
  Message: string

  constructor(code: ResponseErrorEnum, appCode: number, message: string) {
    super(`Code: ${code}, AppCode: ${appCode}, Message: ${message}`)
    this.Code = code
    this.AppCode = appCode
    this.Message = message
    Object.setPrototypeOf(this, ResponseError.prototype)
  }
}

export function serializeResponseError(stream: VectorBufferStream, obj: ResponseError, root = false): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cResponseError)
  }
  stream.writeUInt16(cResponseErrorVersion)
  stream.writeInt32(obj.Code)
  stream.writeInt32(obj.AppCode)
  stream.writeString(obj.Message)
}

export function deserializeResponseError(stream: VectorBufferStream): ResponseError {
  const version = stream.readUInt16()
  if (version > cResponseErrorVersion) {
    throw new Error('ResponseError version mismatch')
  }
  const code = stream.readInt32()
  const appCode = stream.readInt32()
  const message = stream.readString()
  return new ResponseError(code, appCode, message)
}

export function InternalError(message: string, appCode = 0): ResponseError {
  return new ResponseError(ResponseErrorEnum.InternalError, appCode, message)
}

export function BadRequest(message: string, appCode = 0): ResponseError {
  return new ResponseError(ResponseErrorEnum.BadRequest, appCode, message)
}

export function NotFound(message: string, appCode = 0): ResponseError {
  return new ResponseError(ResponseErrorEnum.NotFound, appCode, message)
}