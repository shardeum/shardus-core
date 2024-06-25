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
  const stringified = Utils.safeStringify(obj)
  stream.writeString(stringified)
}

export function deserializeAppliedReceipt2(stream: VectorBufferStream): AppliedReceipt2Serializable {
  const version = stream.readUInt8()
  if (version > cAppliedReceipt2Version) {
    throw new Error(`AppliedReceipt2Deserializer expected version ${cAppliedReceipt2Version}, got ${version}`)
  }
  const stringified = stream.readString()
  return Utils.safeJsonParse(stringified)
}
