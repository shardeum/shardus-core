import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import {
  WrappedDataResponse,
  deserializeWrappedDataResponse,
  serializeWrappedDataResponse,
} from './WrappedDataResponse'
import { AJV_IDENT, verifyPayload } from './ajv/Helpers'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'

export const cBroadcastStateReqVersion = 1

export interface BroadcastStateReq {
  txid: string
  stateList: WrappedDataResponse[]
}

export function serializeBroadcastStateReq(
  stream: VectorBufferStream,
  obj: BroadcastStateReq,
  root = false
): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cBroadcastStateReq)
  }
  stream.writeUInt8(cBroadcastStateReqVersion)
  stream.writeString(obj.txid)
  stream.writeUInt16(obj.stateList.length) // Serialize array length
  obj.stateList.forEach((item) => serializeWrappedDataResponse(stream, item)) // Serialize each item
}

export function deserializeBroadcastStateReq(stream: VectorBufferStream): BroadcastStateReq {
  const version = stream.readUInt8()
  if (version > cBroadcastStateReqVersion) {
    throw new Error('BroadcastStateReq version mismatch')
  }
  const txid = stream.readString()
  const stateListLength = stream.readUInt16()
  const stateList = Array.from({ length: stateListLength }, () => deserializeWrappedDataResponse(stream))
  const errors = verifyPayload(AJV_IDENT.BROADCAST_STATE_REQ, { txid, stateList })
  if (errors && errors.length > 0) {
    throw new Error('Data validation error')
  }
  return { txid, stateList }
}
