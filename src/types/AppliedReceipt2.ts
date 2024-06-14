import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { AppliedVoteSerializable, deserializeAppliedVote, serializeAppliedVote } from './AppliedVote'
import {
  ConfirmOrChallengeMessageSerializable,
  deserializeConfirmOrChallengeMessage,
  serializeConfirmOrChallengeMessage,
} from './ConfirmOrChallengeMessage'
import { SignSerializable, deserializeSign, serializeSign } from './Sign'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'
import {Utils} from '@shardus/types'

export const cAppliedReceipt2Version = 1

export type AppliedReceipt2Serializable = {
  txid: string
  result: boolean
  //single copy of vote
  appliedVote: AppliedVoteSerializable
  confirmOrChallenge?: ConfirmOrChallengeMessageSerializable
  //all signatures for this vote
  signatures: SignSerializable[] //Could have all signatures or best N.  (lowest signature value?)
  // hash of app data
  app_data_hash: string
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
  // stream.writeString(obj.txid)
  // stream.writeUInt8(obj.result ? 1 : 0)
  // serializeAppliedVote(stream, obj.appliedVote)
  // serializeConfirmOrChallengeMessage(stream, obj.confirmOrChallenge)
  // stream.writeUInt16(obj.signatures.length)
  // // TODO: Convert to for loop
  // obj.signatures.forEach((sig) => serializeSign(stream, sig))
  // stream.writeString(obj.app_data_hash)
  const stringified = Utils.safeStringify(obj)
  stream.writeString(stringified)
}

export function deserializeAppliedReceipt2(stream: VectorBufferStream): AppliedReceipt2Serializable {
  const version = stream.readUInt8()
  if (version > cAppliedReceipt2Version) {
    throw new Error(`AppliedReceipt2Deserializer expected version ${cAppliedReceipt2Version}, got ${version}`)
  }
  // const txid = stream.readString()
  // const result = stream.readUInt8() === 1
  // const appliedVote = deserializeAppliedVote(stream)
  // const confirmOrChallenge = deserializeConfirmOrChallengeMessage(stream)
  // const signaturesLength = stream.readUInt16()
  // const signatures: SignSerializable[] = []
  // for (let i = 0; i < signaturesLength; i++) {
  //   signatures.push(deserializeSign(stream))
  // }
  // const app_data_hash = stream.readString()
  // return {
  //   txid,
  //   result,
  //   appliedVote,
  //   confirmOrChallenge,
  //   signatures,
  //   app_data_hash,
  // }
  const stringified = stream.readString()
  return Utils.safeJsonParse(stringified)
}
