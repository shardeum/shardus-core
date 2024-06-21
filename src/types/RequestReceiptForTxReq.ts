import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { AJV_IDENT, verifyPayload } from './ajv/Helpers'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'

export type RequestReceiptForTxReqSerialized = {
  txid: string
  timestamp: number
}
export const cRequestReceiptForTxReqVersion = 1

export function serializeRequestReceiptForTxReq(
  stream: VectorBufferStream,
  inp: RequestReceiptForTxReqSerialized,
  root = false
): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cRequestReceiptForTxReq)
  }
  stream.writeUInt8(cRequestReceiptForTxReqVersion)

  stream.writeString(inp.txid)
  stream.writeString(inp.timestamp.toString())
}

export function deserializeRequestReceiptForTxReq(
  stream: VectorBufferStream
): RequestReceiptForTxReqSerialized {
  const version = stream.readUInt8()
  if (version !== cRequestReceiptForTxReqVersion) {
    throw new Error('RequestReceiptForTxReq version mismatch')
  }

  const txid = stream.readString()
  const timestamp = Number(stream.readString())

  const result =  { txid, timestamp }

  const errors = verifyPayload(AJV_IDENT.REQUEST_RECEIPT_FOR_TX_REQ, result)
  if (errors && errors.length > 0) {
    throw new Error(`AJV: validation error -> ${errors.join(', ')}`)
  }

  return result
}
