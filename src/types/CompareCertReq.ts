import { P2P } from '@shardus/types'
import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'
import { Utils } from '@shardus/types'
import { verifyPayload } from './ajv/Helpers'
import { AJVSchemaEnum } from './enum/AJVSchemaEnum'

export interface CompareCertReqSerializable {
  certs: P2P.CycleCreatorTypes.CycleCert[]
  record: P2P.CycleCreatorTypes.CycleRecord
}

export const cCompareCertReqVersion = 1

export const serializeCompareCertReq = (
  stream: VectorBufferStream,
  inp: CompareCertReqSerializable,
  root = false
): void => {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cCompareCertReq)
  }
  stream.writeUInt8(cCompareCertReqVersion)
  stream.writeString(Utils.safeStringify(inp))
}

export const deserializeCompareCertReq = (stream: VectorBufferStream): CompareCertReqSerializable => {
  const version = stream.readUInt8()
  if (version > cCompareCertReqVersion) {
    throw new Error(`Unsupported CompareCertReqSerializable version ${version}`)
  }
  const obj: CompareCertReqSerializable = Utils.safeJsonParse(stream.readString())

  const errors = verifyPayload(AJVSchemaEnum.CompareCertReq, obj)
  if (errors && errors.length > 0) {
    throw new Error('Data validation error')
  }

  return obj
}
