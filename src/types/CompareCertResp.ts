import { P2P } from '@shardus/types'
import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'
import { safeJsonParse, safeStringify } from '@shardus/types/build/src/utils/functions/stringify'

export interface CompareCertRespSerializable {
  certs: P2P.CycleCreatorTypes.CycleCert[]
  record: P2P.CycleCreatorTypes.CycleRecord
}
const cCompareCertRespVersion = 1

export const serializeCompareCertResp = (
  stream: VectorBufferStream,
  inp: CompareCertRespSerializable,
  root = false
): void => {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cCompareCertResp)
  }
  stream.writeUInt8(cCompareCertRespVersion)
  stream.writeString(safeStringify(inp))
}

export const deserializeCompareCertResp = (stream: VectorBufferStream): CompareCertRespSerializable => {
  const version = stream.readUInt8()
  if (version > cCompareCertRespVersion) {
    throw new Error(`Unsupported CompareCertRespSerializable version ${version}`)
  }

  const obj: CompareCertRespSerializable = safeJsonParse(stream.readString())

  return obj
}
