import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { verifyPayload } from './ajv/Helpers'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'

export type getTxTimestampReq = { txId: string; cycleCounter: number; cycleMarker: string }

export const cGetTxTimestampReqVersion = 1

export function serializeGetTxTimestampReq(
  stream: VectorBufferStream,
  obj: getTxTimestampReq,
  root = false
): void {
  const errors = verifyPayload('GetTxTimestampReq', obj)
  if (errors && errors.length > 0) {
    throw new Error('Data validation error')
  }
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cGetTxTimestampReq)
  }
  stream.writeUInt8(cGetTxTimestampReqVersion)
  stream.writeString(obj.txId)
  stream.writeUInt32(obj.cycleCounter)
  stream.writeString(obj.cycleMarker)
}

export function deserializeGetTxTimestampReq(stream: VectorBufferStream): getTxTimestampReq {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const version = stream.readUInt8()
  if (version > cGetTxTimestampReqVersion) {
    throw new Error('GetTxTimestampReqVersion : Unsupported version')
  }
  // eslint-disable-next-line prefer-const
  let obj: getTxTimestampReq = {
    txId: stream.readString(),
    cycleCounter: stream.readUInt32(),
    cycleMarker: stream.readString(),
  }

  const errors = verifyPayload('GetTxTimestampReq', obj)
  if (errors && errors.length > 0) {
    throw new Error('Data validation error')
  }

  return obj
}
