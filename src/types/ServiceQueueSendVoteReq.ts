import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'
import { Sign } from '../shardus/shardus-types'

const cServiceQueueSendVoteReqVersion = 1
export interface ServiceQueueVote {
  txHash: string,
  result: boolean,
  verifierType: 'beforeAdd' | 'apply',
  sign: Sign
}

export function serializeServiceQueueSendVoteReq(
  stream: VectorBufferStream,
  inp: ServiceQueueVote,
  root = false
): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cServiceQueueSendVoteReq)
  }
  stream.writeUInt8(cServiceQueueSendVoteReqVersion)
  stream.writeString(inp.txHash)
  stream.writeUInt8(inp.result ? 1 : 0)
  stream.writeString(inp.verifierType)
  stream.writeString(inp.sign.owner)
  stream.writeString(inp.sign.sig)
}

export function deserializeServiceQueueSendVoteReq(
  stream: VectorBufferStream
): ServiceQueueVote {
  const version = stream.readUInt8()
  if (version != cServiceQueueSendVoteReqVersion) {
    throw new Error('ServiceQueueSendVoteReqVersion version mismatch')
  }
  const txHash = stream.readString()
  const result = stream.readUInt8() === 1
  const verifierType = stream.readString() as 'beforeAdd' | 'apply'
  let sign: Sign | undefined
  sign = {
    owner: stream.readString(),
    sig: stream.readString(),
  }
  return {
    txHash,
    result,
    verifierType,
    sign,
  }
}
