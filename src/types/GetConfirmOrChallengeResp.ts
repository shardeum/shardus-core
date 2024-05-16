import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'
import { ConfirmOrChallengeMessage } from '../state-manager/state-manager-types'
import { safeJsonParse, safeStringify } from '@shardus/types/build/src/utils/functions/stringify'

export type GetConfirmOrChallengeResp = {
  txId: string
  appliedVoteHash: string
  result?: ConfirmOrChallengeMessage
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
  if (obj.result) {
    stream.writeUInt8(1)
    stream.writeString(safeStringify(obj.result))
  } else {
    stream.writeUInt8(0)
  }
  stream.writeUInt32(obj.uniqueCount)
}

export function deserializeGetConfirmOrChallengeResp(stream: VectorBufferStream): GetConfirmOrChallengeResp {
  const version = stream.readUInt8()
  if (version > cGetConfirmOrChallengeResponseVersion) {
    throw new Error('GetConfirmOrChallengeResponse version mismatch')
  }
  const txId = stream.readString()
  const appliedVoteHash = stream.readString()
  const hasResult = stream.readUInt8() === 1
  let result: ConfirmOrChallengeMessage | undefined
  if (hasResult) {
    result = safeJsonParse(stream.readString())
  }
  const uniqueCount = stream.readUInt32()
  return {
    txId,
    appliedVoteHash,
    result,
    uniqueCount,
  }
}
