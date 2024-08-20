import { P2P } from '@shardus/types'
import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'
import { Utils } from '@shardus/types'
import { verifyPayload } from './ajv/Helpers'
import { AJVSchemaEnum } from './enum/AJVSchemaEnum'

export interface CompareCertRespSerializable {
  certs: P2P.CycleCreatorTypes.CycleCert[]
  record: P2P.CycleCreatorTypes.CycleRecord
}
export const cCompareCertRespVersion = 1

export const serializeCompareCertResp = (
  stream: VectorBufferStream,
  inp: CompareCertRespSerializable,
  root = false
): void => {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cCompareCertResp)
  }
  stream.writeUInt8(cCompareCertRespVersion)
  stream.writeString(Utils.safeStringify(inp))
}

export const deserializeCompareCertResp = (stream: VectorBufferStream): CompareCertRespSerializable => {
  const version = stream.readUInt8()
  if (version > cCompareCertRespVersion) {
    throw new Error(`Unsupported CompareCertRespSerializable version ${version}`)
  }

  const obj: CompareCertRespSerializable = Utils.safeJsonParse(stream.readString())

  const errors = verifyPayload(AJVSchemaEnum.CompareCertResp, obj)

  if (errors && errors.length > 0) {
    throw new Error('Data validation error')
  }

  return obj
}
