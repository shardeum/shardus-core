import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'
import { deserializeSignedReceipt, serializeSignedReceipt, SignedReceiptSerializable } from './SignedReceipt'
export type PoqoSendReceiptReq = SignedReceiptSerializable & { txGroupCycle: number }

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

  serializeSignedReceipt(stream, obj)
  stream.writeUInt32(obj.txGroupCycle)
}

export function deserializePoqoSendReceiptReq(stream: VectorBufferStream): PoqoSendReceiptReq {
  const version = stream.readUInt8()
  if (version > cPoqoSendReceiptReqVersion) {
    throw new Error('PoQoSendReceiptReq Unsupported version')
  }

  return { ...deserializeSignedReceipt(stream), txGroupCycle: stream.readUInt32() }
}
