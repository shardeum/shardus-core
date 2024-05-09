import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'
import { Sign } from '../shardus/shardus-types'
import { verifyPayload } from './ajv/Helpers'

export type getTxTimestampResp = {
  txId: string
  cycleMarker: string
  cycleCounter: number
  timestamp: number
  sign?: Sign
  isResponse?: boolean
}

const cGetTxTimestampRespVersion = 1

export function serializeGetTxTimestampResp(
  stream: VectorBufferStream,
  obj: getTxTimestampResp,
  root = false
): void {
  const errors = verifyPayload('GetTxTimestampResp', obj)
  if (errors && errors.length > 0) {
    throw new Error('Data validation error')
  }
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cGetTxTimestampResp)
  }
  stream.writeUInt8(cGetTxTimestampRespVersion)
  stream.writeString(obj.txId)
  stream.writeString(obj.cycleMarker)
  stream.writeUInt32(obj.cycleCounter)
  stream.writeBigUInt64(BigInt(obj.timestamp))

  if (obj.sign) {
    stream.writeUInt8(1)
    stream.writeString(obj.sign.owner)
    stream.writeString(obj.sign.sig)
  } else {
    stream.writeUInt8(0)
  }

  if (obj.isResponse !== undefined) {
    stream.writeUInt8(1)
    stream.writeUInt8(obj.isResponse ? 1 : 0)
  } else {
    stream.writeUInt8(0)
  }
}

export function deserializeGetTxTimestampResp(stream: VectorBufferStream): getTxTimestampResp {
  const version = stream.readUInt8()
  if (version > cGetTxTimestampRespVersion) {
    throw new Error('GetTxTimestampRespVersion : Unsupported version')
  }

  const txId = stream.readString()
  const cycleMarker = stream.readString()
  const cycleCounter = stream.readUInt32()
  const timestamp = Number(stream.readBigUInt64())

  let sign: Sign
  if (stream.readUInt8() === 1) {
    const owner = stream.readString()
    const sig = stream.readString()
    sign = { owner, sig }
  }

  let isResponse: boolean
  if (stream.readUInt8() === 1) {
    isResponse = stream.readUInt8() === 1 ? true : false
  }

  const result: getTxTimestampResp = {
    txId,
    cycleMarker,
    cycleCounter,
    timestamp,
    ...(sign && { sign }),
    ...(typeof isResponse !== 'undefined' && { isResponse }),
  }
  const errors = verifyPayload('GetTxTimestampResp', result)
  if (errors && errors.length > 0) {
    throw new Error('Data validation error')
  }

  return result
}
