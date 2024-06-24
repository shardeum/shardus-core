import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { AJV_IDENT, verifyPayload } from './ajv/Helpers'
import { AppliedVoteSerializable, deserializeAppliedVote, serializeAppliedVote } from './AppliedVote'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'

const cGetAppliedVoteRespVersion = 1

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
  stream.writeUInt8(cGetAppliedVoteRespVersion)
  stream.writeString(obj.txId)
  serializeAppliedVote(stream, obj.appliedVote) // Serialize AppliedVote object
  stream.writeString(obj.appliedVoteHash)
}

export function deserializeGetAppliedVoteResp(stream: VectorBufferStream): GetAppliedVoteResp {
  const version = stream.readUInt8()
  if (version > cGetAppliedVoteRespVersion) {
    throw new Error('GetAppliedVoteResp version mismatch')
  }
  const txId = stream.readString()
  const appliedVote = deserializeAppliedVote(stream) // Deserialize AppliedVote object
  const appliedVoteHash = stream.readString()

  const result = {
    txId,
    appliedVote,
    appliedVoteHash,
  }
  const errors = verifyPayload(AJV_IDENT.GET_APPLIED_VOTE_RESP, result)
  if (errors && errors.length > 0) {
    throw new Error(`AJV: validation error -> ${errors.join(', ')}`)
  }
  return result
}
