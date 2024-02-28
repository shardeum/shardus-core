import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'
import {
  WrappedDataResponse,
  deserializeWrappedDataResponse,
  serializeWrappedDataResponse,
} from './WrappedDataResponse'

const cRequestStateForTxPostRespVersion = 1

export type RequestStateForTxPostResp = {
  stateList: WrappedDataResponse[]
  beforeHashes: { [accountID: string]: string }
  note: string
  success: boolean
}

export function serializeRequestStateForTxPostResp(
  stream: VectorBufferStream,
  resp: RequestStateForTxPostResp,
  root = false
): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cRequestStateForTxPostResp)
  }
  stream.writeUInt8(cRequestStateForTxPostRespVersion)
  stream.writeUInt8(resp.success ? 1 : 0)
  stream.writeString(resp.note)
  stream.writeUInt16(Object.keys(resp.beforeHashes).length)
  Object.entries(resp.beforeHashes).forEach(([key, value]) => {
    stream.writeString(key)
    stream.writeString(value)
  }) // Serialize each item
  stream.writeUInt16(resp.stateList.length)
  resp.stateList.forEach((item) => serializeWrappedDataResponse(stream, item)) // Serialize each item
}

export function deserializeRequestStateForTxPostResp(stream: VectorBufferStream): RequestStateForTxPostResp {
  const version = stream.readUInt8()
  if (version > cRequestStateForTxPostRespVersion) {
    throw new Error('RequestStateForTxPostResp version mismatch')
  }
  const success = stream.readUInt8() === 1
  const note = stream.readString()
  const beforeHashesLength = stream.readUInt16()
  const beforeHashes: { [key: string]: string } = {}
  for (let i = 0; i < beforeHashesLength; i++) {
    const key = stream.readString()
    const value = stream.readString()
    // eslint-disable-next-line security/detect-object-injection
    beforeHashes[key] = value
  }
  const stateListLength = stream.readUInt16()
  const stateList = Array.from({ length: stateListLength }, () => deserializeWrappedDataResponse(stream))
  return { success, note, beforeHashes, stateList }
}
