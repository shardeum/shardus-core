import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'
import { ConfirmOrChallengeMessage } from '../state-manager/state-manager-types'
import { DeSerializeFromJsonString, SerializeToJsonString } from '../utils'

export type GetConfirmOrChallengeResp = {
  txId: string
  appliedVoteHash: string
  result: ConfirmOrChallengeMessage
  uniqueCount: number
}

const cGetConfirmOrChallengeResponseVersion = 1

export function serializeGetConfirmOrChallengeResp(
  stream: VectorBufferStream,
  obj: GetConfirmOrChallengeResp,
  root = false
): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cGetConfirmOrChallengeResp)
  }
  stream.writeUInt8(cGetConfirmOrChallengeResponseVersion)
  stream.writeString(obj.txId)
  stream.writeString(obj.appliedVoteHash)
  stream.writeString(SerializeToJsonString(obj.result))
  stream.writeUInt32(obj.uniqueCount)
}

export function deserializeGetConfirmOrChallengeResp(stream: VectorBufferStream): GetConfirmOrChallengeResp {
  const version = stream.readUInt8()
  if (version > cGetConfirmOrChallengeResponseVersion) {
    throw new Error('GetConfirmOrChallengeResponse version mismatch')
  }
  return {
    txId: stream.readString(),
    appliedVoteHash: stream.readString(),
    result: DeSerializeFromJsonString(stream.readString()) as ConfirmOrChallengeMessage,
    uniqueCount: stream.readUInt32(),
  }
}
