import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { verifyPayload } from './ajv/Helpers'
import { AJVSchemaEnum } from './enum/AJVSchemaEnum'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'
import { deserializeWrappedData, serializeWrappedData, WrappedData } from './WrappedData'

export type RequestStateForTxRespSerialized = {
  stateList: WrappedData[]
  beforeHashes: { [accountID: string]: string }
  note: string
  success: boolean
}

export const cRequestStateForTxRespVersion = 1

export const serializeRequestStateForTxResp = (
  stream: VectorBufferStream,
  inp: RequestStateForTxRespSerialized,
  bool = false
): void => {
  if (bool) {
    stream.writeUInt16(TypeIdentifierEnum.cRequestStateForTxResp)
  }
  stream.writeUInt8(cRequestStateForTxRespVersion)
  stream.writeUInt16(inp.stateList.length)
  for (let i = 0; i < inp.stateList.length; i++) {
    // eslint-disable-next-line security/detect-object-injection
    serializeWrappedData(stream, inp.stateList[i])
  }
  stream.writeUInt16(Object.keys(inp.beforeHashes).length)
  for (const key in inp.beforeHashes) {
    stream.writeString(key)
    // eslint-disable-next-line security/detect-object-injection
    stream.writeString(inp.beforeHashes[key])
  }
  stream.writeString(inp.note)
  stream.writeUInt8(inp.success ? 1 : 0)
}

export const deserializeRequestStateForTxResp = (
  stream: VectorBufferStream
): RequestStateForTxRespSerialized => {
  const ver = stream.readUInt8()
  if (ver !== cRequestStateForTxRespVersion) {
    throw new Error('Unsupported version')
  }
  const stateListLen = stream.readUInt16()

  const ret: RequestStateForTxRespSerialized = {
    stateList: new Array<WrappedData>(stateListLen),
    beforeHashes: {},
    note: '',
    success: false,
  }

  for (let i = 0; i < stateListLen; i++) {
    // eslint-disable-next-line security/detect-object-injection
    ret.stateList[i] = deserializeWrappedData(stream)
  }

  const beforeHashesLen = stream.readUInt16()
  for (let i = 0; i < beforeHashesLen; i++) {
    const key = stream.readString()
    const value = stream.readString()
    // eslint-disable-next-line security/detect-object-injection
    ret.beforeHashes[key] = value
  }
  ret.note = stream.readString()
  ret.success = stream.readUInt8() !== 0

  console.log('ret', ret)
  const errors = verifyPayload(AJVSchemaEnum.RequestStateForTxResp, ret)
  if (errors && errors.length > 0) {
    throw new Error(`AJV: validation error -> ${errors.join(', ')}`)
  }

  return ret
}
