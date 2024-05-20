import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { WrappedData, deserializeWrappedData, serializeWrappedData } from './WrappedData'
import { verifyPayload } from './ajv/Helpers'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'

export const cGetAccountDataByListRespVersion = 1

export type GetAccountDataByListResp = {
  accountData: WrappedData[] | null
}

export function serializeGetAccountDataByListResp(
  stream: VectorBufferStream,
  obj: GetAccountDataByListResp,
  root = false
): void {
  const errors = verifyPayload('GetAccountDataByListResp', obj)
  if (errors && errors.length > 0) {
    throw new Error('Data validation error')
  }
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cGetAccountDataByListResp)
  }
  stream.writeUInt8(cGetAccountDataByListRespVersion)
  if (obj.accountData !== null) {
    stream.writeUInt8(1)
    stream.writeUInt16(obj.accountData.length)
    for (const item of obj.accountData) {
      serializeWrappedData(stream, item)
    }
  } else {
    stream.writeUInt8(0) // Indicate that accountData is null
  }
}

export function deserializeGetAccountDataByListResp(stream: VectorBufferStream): GetAccountDataByListResp {
  const version = stream.readUInt8()
  if (version > cGetAccountDataByListRespVersion) {
    throw new Error('GetAccountDataByListResp version mismatch')
  }
  const accountDataPresent = stream.readUInt8()
  let accountData = null
  if (accountDataPresent === 1) {
    const length = stream.readUInt16()
    accountData = []
    for (let i = 0; i < length; i++) {
      accountData.push(deserializeWrappedData(stream))
    }
  }

  const errors = verifyPayload('GetAccountDataByListResp', accountData)
  if (errors && errors.length > 0) {
    throw new Error('Data validation error')
  }
  return {
    accountData,
  }
}
