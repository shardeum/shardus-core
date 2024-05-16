import { P2P } from '@shardus/types'
import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'
import { safeJsonParse, safeStringify } from '@shardus/types/build/src/utils/functions/stringify'

export interface CompareCertReqSerializable {
  certs: P2P.CycleCreatorTypes.CycleCert[]
  record: P2P.CycleCreatorTypes.CycleRecord
}

const cCompareCertReqVersion = 1

export const serializeCompareCertReq = (
  stream: VectorBufferStream,
  inp: CompareCertReqSerializable,
  root = false
): void => {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cCompareCertReq)
  }
  stream.writeUInt8(cCompareCertReqVersion)
  stream.writeString(safeStringify(inp))
}

export const deserializeCompareCertReq = (stream: VectorBufferStream): CompareCertReqSerializable => {
  const version = stream.readUInt8()
  if (version > cCompareCertReqVersion) {
    throw new Error(`Unsupported CompareCertReqSerializable version ${version}`)
  }
  const obj: CompareCertReqSerializable = safeJsonParse(stream.readString())
  return obj
}
