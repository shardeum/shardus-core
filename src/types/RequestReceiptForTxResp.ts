import { AppliedReceipt2 } from '../state-manager/state-manager-types'
import { DeSerializeFromJsonString, SerializeToJsonString } from '../utils'
import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'

export type RequestReceiptForTxRespSerialized = {
  receipt: AppliedReceipt2 | null
  note: string
  success: boolean
}

export const cRequestReceiptForTxRespVersion = 1

export function serializeRequestReceiptForTxResp(
  stream: VectorBufferStream,
  inp: RequestReceiptForTxRespSerialized,
  root = false
): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cRequestReceiptForTxResp)
  }
  stream.writeUInt8(cRequestReceiptForTxRespVersion)

  if (inp.receipt === null) {
    stream.writeUInt8(0)
    stream.writeString(SerializeToJsonString(inp.receipt))
  } else {
    stream.writeUInt8(1)
  }
  stream.writeString(inp.note)
  stream.writeUInt8(inp.success ? 1 : 0)
}

export function deserializeRequestReceiptForTxResp(
  stream: VectorBufferStream
): RequestReceiptForTxRespSerialized {
  const version = stream.readUInt8()
  if (version !== cRequestReceiptForTxRespVersion) {
    throw new Error('RequestReceiptForTxResp version mismatch')
  }
  if (stream.readUInt8() === 0) {
    const note = stream.readString()
    const success = stream.readUInt8() === 1
    return { receipt: null, note, success }
  }
  const receipt = DeSerializeFromJsonString(stream.readString()) as AppliedReceipt2
  const note = stream.readString()
  const success = stream.readUInt8() === 1
  return { receipt, note, success }
}
