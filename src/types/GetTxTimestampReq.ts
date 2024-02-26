import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'

export type getTxTimestampReq = { txId: string; cycleCounter: number; cycleMarker: string }

export const cGetTxTimestampReqVersion = 1

export function serializeGetTxTimestampReq(
  stream: VectorBufferStream,
  obj: getTxTimestampReq,
  root = false
): void {
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

  return obj
}
