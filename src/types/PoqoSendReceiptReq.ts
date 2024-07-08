import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'
import { AppliedReceipt2Serializable, deserializeAppliedReceipt2, serializeAppliedReceipt2 } from './AppliedReceipt2'
export type PoqoSendReceiptReq = AppliedReceipt2Serializable

const cPoqoSendReceiptReqVersion = 1

export function serializePoqoSendReceiptReq(
  stream: VectorBufferStream,
  obj: PoqoSendReceiptReq,
  root = false
): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cPoqoSendReceiptReq)
  }
  stream.writeUInt8(cPoqoSendReceiptReqVersion)

  serializeAppliedReceipt2(stream, obj)

}

export function deserializePoqoSendReceiptReq(stream: VectorBufferStream): PoqoSendReceiptReq {
  const version = stream.readUInt8()
  if (version > cPoqoSendReceiptReqVersion) {
    throw new Error('PoQoSendReceiptReq Unsupported version')
  }

  return deserializeAppliedReceipt2(stream)

}
