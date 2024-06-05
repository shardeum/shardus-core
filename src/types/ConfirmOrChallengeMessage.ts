import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { AppliedVoteSerializable, deserializeAppliedVote, serializeAppliedVote } from './AppliedVote'
import { SignSerializable, deserializeSign, serializeSign } from './Sign'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'

export const cConfirmOrChallengeMessageVersion = 1

export type ConfirmOrChallengeMessageSerializable = {
  message: string
  nodeId: string
  appliedVote: AppliedVoteSerializable
  sign?: SignSerializable
}

export function serializeConfirmOrChallengeMessage(
  stream: VectorBufferStream,
  obj: ConfirmOrChallengeMessageSerializable,
  root = false
): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cConfirmOrChallengeMessage)
  }
  stream.writeUInt8(cConfirmOrChallengeMessageVersion)
  stream.writeString(obj.message)
  stream.writeString(obj.nodeId)
  serializeAppliedVote(stream, obj.appliedVote)
  if (obj.sign) {
    stream.writeUInt8(1)
    serializeSign(stream, obj.sign)
  } else {
    stream.writeUInt8(0)
  }
}

export function deserializeConfirmOrChallengeMessage(
  stream: VectorBufferStream
): ConfirmOrChallengeMessageSerializable {
  const version = stream.readUInt8()
  if (version > cConfirmOrChallengeMessageVersion) {
    throw new Error(
      `ConfirmOrChallengeMessageDeserializer expected version ${cConfirmOrChallengeMessageVersion}, got ${version}`
    )
  }
  const message = stream.readString()
  const nodeId = stream.readString()
  const appliedVote = deserializeAppliedVote(stream)
  const sign = stream.readUInt8() === 1 ? deserializeSign(stream) : undefined
  return {
    message,
    nodeId,
    appliedVote,
    sign,
  }
}
