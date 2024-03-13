import { P2P } from '@shardus/types'
import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'
import { DeSerializeFromJsonString, SerializeToJsonString } from '../utils'

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
  stream.writeString(SerializeToJsonString(inp))
}

export const deserializeCompareCertResp = (stream: VectorBufferStream): CompareCertRespSerializable => {
  const version = stream.readUInt8()
  if (version > cCompareCertRespVersion) {
    throw new Error(`Unsupported CompareCertRespSerializable version ${version}`)
  }

  const obj: CompareCertRespSerializable = DeSerializeFromJsonString(stream.readString())

  return obj
}
