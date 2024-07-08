import { AppliedReceipt2 } from '../state-manager/state-manager-types'
import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { deserializeAppliedVote, serializeAppliedVote } from './AppliedVote'
import {
  deserializeConfirmOrChallengeMessage,
  serializeConfirmOrChallengeMessage,
} from './ConfirmOrChallengeMessage'
import { deserializeSign, serializeSign } from './Sign'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'

export type PoqoSendReceiptReq = AppliedReceipt2

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

  stream.writeString(obj.txid)
  stream.writeUInt8(obj.result ? 1 : 0)

  serializeAppliedVote(stream, obj.appliedVote)

  if (obj.confirmOrChallenge) {
    stream.writeUInt8(1)
    serializeConfirmOrChallengeMessage(stream, obj.confirmOrChallenge)
  } else {
    stream.writeUInt8(0)
  }

  stream.writeUInt16(obj.signatures.length)
  obj.signatures.forEach((signature) => {
    serializeSign(stream, signature)
  })

  stream.writeString(obj.app_data_hash)
}

export function deserializePoqoSendReceiptReq(stream: VectorBufferStream): PoqoSendReceiptReq {
  const version = stream.readUInt8()
  if (version > cPoqoSendReceiptReqVersion) {
    throw new Error('PoQoSendReceiptReq Unsupported version')
  }

  const txid = stream.readString()
  const result = stream.readUInt8() === 1
  const appliedVote = deserializeAppliedVote(stream)

  let confirmOrChallenge
  if (stream.readUInt8() === 1) {
    confirmOrChallenge = deserializeConfirmOrChallengeMessage(stream)
  }

  const signaturesLength = stream.readUInt16()
  const signatures = []
  for (let i = 0; i < signaturesLength; i++) {
    signatures.push(deserializeSign(stream))
  }

  const app_data_hash = stream.readString()

  if (confirmOrChallenge) {
    return {
      txid,
      result,
      appliedVote,
      confirmOrChallenge,
      signatures,
      app_data_hash,
    }
  } else {
    return {
      txid,
      result,
      appliedVote,
      signatures,
      app_data_hash,
    }
  }
}
