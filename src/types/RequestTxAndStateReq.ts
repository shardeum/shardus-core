import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'

export const cRequestTxAndStateReqVersion = 1

export type RequestTxAndStateReq = {
  txid: string
  accountIds: string[]
  includeAppReceiptData?: boolean
}

export function serializeRequestTxAndStateReq(
  stream: VectorBufferStream,
  obj: RequestTxAndStateReq,
  root = false
): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cRequestTxAndStateReq)
  }
  stream.writeUInt8(cRequestTxAndStateReqVersion)
  stream.writeString(obj.txid)
  stream.writeUInt32(obj.accountIds.length)
  for (const accountId of obj.accountIds) {
    stream.writeString(accountId)
  }
  stream.writeUInt8(obj.includeAppReceiptData ? 1 : 0)
}

export function deserializeRequestTxAndStateReq(stream: VectorBufferStream): RequestTxAndStateReq {
  const version = stream.readUInt8()
  if (version > cRequestTxAndStateReqVersion) {
    throw new Error('cRequestTxAndStateReqVersion version mismatch')
  }
  const txid = stream.readString()
  const accountIdsLength = stream.readUInt32()
  const accountIds = []
  for (let i = 0; i < accountIdsLength; i++) {
    accountIds.push(stream.readString())
  }
  let includeAppReceiptData = false
  if (stream.readUInt8() === 1) {
    // Check if appReceiptData is requested
    includeAppReceiptData = true
  }
  return {
    txid,
    accountIds,
    includeAppReceiptData,
  }
}
