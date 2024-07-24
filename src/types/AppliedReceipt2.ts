import { Utils } from '@shardus/types'
import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { AppliedVoteSerializable } from './AppliedVote'
import { ConfirmOrChallengeMessageSerializable } from './ConfirmOrChallengeMessage'
import { SignSerializable } from './Sign'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'

export const cAppliedReceipt2Version = 1

export type AppliedReceipt2Serializable = {
  txid: string
  result: boolean
  appliedVote: AppliedVoteSerializable //single copy of vote
  confirmOrChallenge?: ConfirmOrChallengeMessageSerializable
  signatures: SignSerializable[] //all signatures for this vote, Could have all signatures or best N.  (lowest signature value?)
  app_data_hash: string // hash of app data
}

export function serializeAppliedReceipt2(
  stream: VectorBufferStream,
  obj: AppliedReceipt2Serializable,
  root = false
): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cAppliedReceipt2)
  }
  stream.writeUInt8(cAppliedReceipt2Version)
  stream.writeString(obj.txid)
  stream.writeUInt8(obj.result ? 1 : 0)
  serializeAppliedVote(stream, obj.appliedVote)
  // Check if confirmOrChallenge is defined
  if (obj.confirmOrChallenge) {
    stream.writeUInt8(1)
    serializeConfirmOrChallengeMessage(stream, obj.confirmOrChallenge)
  } else {
    stream.writeUInt8(0)
  }

  stream.writeUInt16(obj.signatures.length)

  for(let i = 0; i < obj.signatures.length; i++) {
    serializeSign(stream, obj.signatures[i])
  }

  stream.writeString(obj.app_data_hash)
}

export function deserializeAppliedReceipt2(stream: VectorBufferStream): AppliedReceipt2Serializable {
  const version = stream.readUInt8()
  if (version > cAppliedReceipt2Version) {
    throw new Error(`AppliedReceipt2Deserializer expected version ${cAppliedReceipt2Version}, got ${version}`)
  }
  const txid = stream.readString()
  const result = stream.readUInt8() === 1
  const appliedVote = deserializeAppliedVote(stream)
  const confirmOrChallengeFlag = stream.readUInt8()
  let confirmOrChallenge
  if (confirmOrChallengeFlag === 1) {
    confirmOrChallenge = deserializeConfirmOrChallengeMessage(stream)
  } else {
    confirmOrChallenge = undefined
  }
  const signaturesLength = stream.readUInt16()
  const signatures: SignSerializable[] = []
  for (let i = 0; i < signaturesLength; i++) {
    signatures.push(deserializeSign(stream))
  }
  const app_data_hash = stream.readString()
  return {
    txid,
    result,
    appliedVote,
    confirmOrChallenge,
    signatures,
    app_data_hash,
  }
}
