import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { verifyPayload } from './ajv/Helpers'
import { AJVSchemaEnum } from './enum/AJVSchemaEnum'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'

export const cApoptosisProposalReqVersion = 1

export interface ApoptosisProposalReq {
  id: string
  when: number
}

export function serializeApoptosisProposalReq(
  stream: VectorBufferStream,
  obj: ApoptosisProposalReq,
  root = false
): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cApoptosisProposalReq)
  }
  stream.writeUInt8(cApoptosisProposalReqVersion)
  stream.writeString(obj.id)
  stream.writeUInt32(obj.when)
}

export function deserializeApoptosisProposalReq(stream: VectorBufferStream): ApoptosisProposalReq {
  const version = stream.readUInt8()
  if (version > cApoptosisProposalReqVersion) {
    throw new Error('ApoptosisProposalReq version mismatch')
  }
  const id = stream.readString()
  const when = stream.readUInt32()

  const obj: ApoptosisProposalReq = {
    id,
    when,
  }
  const errors = verifyPayload(AJVSchemaEnum.ApoptosisProposalReq, obj)
  if (errors && errors.length > 0) {
    throw new Error('Data validation error')
  }

  return obj
}
