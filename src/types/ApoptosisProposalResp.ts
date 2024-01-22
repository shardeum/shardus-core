import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'

export const cApoptosisProposalRespVersion = 1

export interface ApoptosisProposalResp {
  s: string
  r: number
}

export function serializeApoptosisProposalResp(
  stream: VectorBufferStream,
  obj: ApoptosisProposalResp,
  root = false
): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cApoptosisProposalResp)
  }
  stream.writeUInt16(cApoptosisProposalRespVersion)
  stream.writeString(obj.s)
  stream.writeInt32(obj.r)
}

export function deserializeApoptosisProposalResp(stream: VectorBufferStream): ApoptosisProposalResp {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const version = stream.readUInt16()
  const s = stream.readString()
  const r = stream.readInt32()

  const obj: ApoptosisProposalResp = {
    s,
    r,
  }

  return obj
}
