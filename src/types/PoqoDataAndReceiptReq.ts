import { WrappedResponse } from '../shardus/shardus-types'
import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'
import { Utils as StringUtils } from '@shardus/types'
import { deserializeSignedReceipt, serializeSignedReceipt, SignedReceiptSerializable } from './SignedReceipt'

export type PoqoDataAndReceiptReq = {
  finalState: {
    txid: string
    stateList: WrappedResponse[]
  }
  receipt: SignedReceiptSerializable
  txGroupCycle: number
}

const cPoqoDataAndReceiptReqVersion = 1

export function serializePoqoDataAndReceiptReq(
  stream: VectorBufferStream,
  inp: PoqoDataAndReceiptReq,
  root = false
): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cPoqoDataAndReceiptReq)
  }
  stream.writeUInt8(cPoqoDataAndReceiptReqVersion)
  stream.writeString(inp.finalState.txid)
  stream.writeString(StringUtils.safeStringify(inp.finalState.stateList))
  stream.writeUInt32(inp.txGroupCycle)
  serializeSignedReceipt(stream, inp.receipt)
}

export function deserializePoqoDataAndReceiptResp(stream: VectorBufferStream): PoqoDataAndReceiptReq {
  const version = stream.readUInt8()
  if (version !== cPoqoDataAndReceiptReqVersion) {
    throw new Error('PoqoDataAndReceiptReq version mismatch')
  }
  const txid = stream.readString()
  const stateList = StringUtils.safeJsonParse(stream.readString())
  const txGroupCycle = stream.readUInt32()
  const signedReceipt = deserializeSignedReceipt(stream)

  return {
    finalState: {
      txid: txid,
      stateList: stateList,
    },
    receipt: signedReceipt,
    txGroupCycle: txGroupCycle,
  }
}
