import { AppliedVoteHash } from '../state-manager/state-manager-types'
import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'
import {
  deserializeSpreadAppliedVoteHashReq,
  serializeSpreadAppliedVoteHashReq,
} from './SpreadAppliedVoteHashReq'

const cPoqoSendVoteReqVersion = 1

export function serializePoqoSendVoteReq(
  stream: VectorBufferStream,
  inp: AppliedVoteHash & { txGroupCycle: number },
  root = false
): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cPoqoSendVoteReq)
  }
  stream.writeUInt8(cPoqoSendVoteReqVersion)
  serializeSpreadAppliedVoteHashReq(stream, inp)
  stream.writeUInt32(inp.txGroupCycle)
}

export function deserializePoqoSendVoteReq(
  stream: VectorBufferStream
): AppliedVoteHash & { txGroupCycle: number } {
  const version = stream.readUInt8()
  if (version != cPoqoSendVoteReqVersion) {
    throw new Error('PoqoSendVoteReq version mismatch')
  }
  return { ...deserializeSpreadAppliedVoteHashReq(stream), txGroupCycle: stream.readUInt32() }
}
