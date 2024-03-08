import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { AppliedVoteSerializable, deserializeAppliedVote, serializeAppliedVote } from './AppliedVote'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'

const cGetAppliedVoteRespVersion = 3

export type GetAppliedVoteResp = {
  txId: string
  appliedVote: AppliedVoteSerializable
  appliedVoteHash: string
}

export function serializeGetAppliedVoteResp(
  stream: VectorBufferStream,
  obj: GetAppliedVoteResp,
  root = false
): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cGetAppliedVoteResp)
  }
  stream.writeUInt16(cGetAppliedVoteRespVersion)
  stream.writeString(obj.txId)
  serializeAppliedVote(stream, obj.appliedVote) // Serialize AppliedVote object
  stream.writeString(obj.appliedVoteHash)
}

export function deserializeGetAppliedVoteResp(stream: VectorBufferStream): GetAppliedVoteResp {
  const version = stream.readUInt16()
  if (version > cGetAppliedVoteRespVersion) {
    throw new Error('GetAppliedVoteResp version mismatch')
  }
  const txId = stream.readString()
  const appliedVote = deserializeAppliedVote(stream) // Deserialize AppliedVote object
  const appliedVoteHash = stream.readString()
  return {
    txId,
    appliedVote,
    appliedVoteHash,
  }
}
