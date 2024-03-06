import { AcceptedTx, WrappedResponses } from '../state-manager/state-manager-types'
import { DeSerializeFromJsonString, SerializeToJsonString } from '../utils'
import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import {
  WrappedDataResponse,
  deserializeWrappedDataResponse,
  serializeWrappedDataResponse,
} from './WrappedDataResponse'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'

export const cRequestTxAndStateRespVersion = 1

export type RequestTxAndStateResp = {
  stateList: WrappedDataResponse[]
  account_state_hash_before: { [accountID: string]: string }
  account_state_hash_after: { [accountID: string]: string }
  note: string
  success: boolean
  acceptedTX?: AcceptedTx
  originalData?: WrappedResponses
}

export function serializeRequestTxAndStateResp(
  stream: VectorBufferStream,
  obj: RequestTxAndStateResp,
  root = false
): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cRequestTxAndStateResp)
  }
  stream.writeUInt8(cRequestTxAndStateRespVersion)

  stream.writeUInt16(obj.stateList.length)
  obj.stateList.forEach((state) => serializeWrappedDataResponse(stream, state))

  const beforeHashKeys = Object.keys(obj.account_state_hash_before)
  stream.writeUInt16(beforeHashKeys.length)
  beforeHashKeys.forEach((key) => {
    stream.writeString(key)
    // eslint-disable-next-line security/detect-object-injection
    stream.writeString(obj.account_state_hash_before[key])
  })

  const afterHashKeys = Object.keys(obj.account_state_hash_after)
  stream.writeUInt16(afterHashKeys.length)
  afterHashKeys.forEach((key) => {
    stream.writeString(key)
    // eslint-disable-next-line security/detect-object-injection
    stream.writeString(obj.account_state_hash_after[key])
  })

  stream.writeString(obj.note)
  stream.writeUInt8(obj.success ? 1 : 0)

  stream.writeUInt8(obj.acceptedTX !== undefined ? 1 : 0)
  if (obj.acceptedTX !== undefined) {
    stream.writeString(SerializeToJsonString(obj.acceptedTX))
  }
  stream.writeUInt8(obj.originalData !== undefined ? 1 : 0)
  if (obj.originalData !== undefined) {
    stream.writeString(SerializeToJsonString(obj.originalData))
  }
}

export function deserializeRequestTxAndStateResp(stream: VectorBufferStream): RequestTxAndStateResp {
  const version = stream.readUInt8()
  if (version > cRequestTxAndStateRespVersion) {
    throw new Error('cRequestTxAndStateRespVersion version mismatch')
  }
  const result: RequestTxAndStateResp = {
    stateList: [],
    account_state_hash_before: {},
    account_state_hash_after: {},
    note: '',
    success: false,
  }

  const stateListLength = stream.readUInt16()
  for (let i = 0; i < stateListLength; i++) {
    result.stateList.push(deserializeWrappedDataResponse(stream))
  }

  const beforeHashLength = stream.readUInt16()
  for (let i = 0; i < beforeHashLength; i++) {
    const key = stream.readString()
    const value = stream.readString()
    // eslint-disable-next-line security/detect-object-injection
    result.account_state_hash_before[key] = value
  }

  const afterHashLength = stream.readUInt16()
  for (let i = 0; i < afterHashLength; i++) {
    const key = stream.readString()
    const value = stream.readString()
    // eslint-disable-next-line security/detect-object-injection
    result.account_state_hash_after[key] = value
  }

  result.note = stream.readString()
  result.success = stream.readUInt8() === 1

  if (stream.readUInt8() === 1) {
    // Check if acceptedTX is present
    result.acceptedTX = DeSerializeFromJsonString(stream.readString())
  }
  if (stream.readUInt8() === 1) {
    // Check if originalData is present
    result.originalData = DeSerializeFromJsonString(stream.readString())
  }

  return result
}
