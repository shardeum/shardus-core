import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'

const cRequestStateForTxPostReqVersion = 1

export type RequestStateForTxPostReq = {
  txid: string
  timestamp: number
  key: string
  hash: string
}

export function serializeRequestStateForTxPostReq(
  stream: VectorBufferStream,
  obj: RequestStateForTxPostReq,
  root = false
): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cRequestStateForTxPostReq)
  }
  stream.writeUInt8(cRequestStateForTxPostReqVersion)
  stream.writeString(obj.txid)
  stream.writeBigUInt64(BigInt(obj.timestamp))
  stream.writeString(obj.key)
  stream.writeString(obj.hash)
}

export function deserializeRequestStateForTxPostReq(stream: VectorBufferStream): RequestStateForTxPostReq {
  const version = stream.readUInt8()
  if (version > cRequestStateForTxPostReqVersion) {
    throw new Error('RequestStateForTxPostReq version mismatch')
  }
  const txid = stream.readString()
  const timestamp = Number(stream.readBigUInt64())
  const key = stream.readString()
  const hash = stream.readString()
  return { txid, timestamp, key, hash }
}
