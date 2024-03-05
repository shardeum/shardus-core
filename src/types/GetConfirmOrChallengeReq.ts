import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'

export type GetConfirmOrChallengeReq = {
  txId: string
}

const cGetConfirmOrChallengeReqVersion = 1

export function serializeGetConfirmOrChallengeReq(
  stream: VectorBufferStream,
  obj: GetConfirmOrChallengeReq,
  root = false
): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cGetConfirmOrChallengeReq)
  }
  stream.writeUInt8(cGetConfirmOrChallengeReqVersion)
  stream.writeString(obj.txId)
}

export function deserializeGetConfirmOrChallengeReq(stream: VectorBufferStream): GetConfirmOrChallengeReq {
  const version = stream.readUInt8()
  if (version > cGetConfirmOrChallengeReqVersion) {
    throw new Error('GetConfirmOrChallengeReq version mismatch')
  }
  return {
    txId: stream.readString(),
  }
}
