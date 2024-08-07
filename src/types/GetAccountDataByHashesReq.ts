import { AccountIDAndHash } from '../state-manager/state-manager-types'
import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { verifyPayload } from './ajv/Helpers'
import { AJVSchemaEnum } from './enum/AJVSchemaEnum'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'

export type GetAccountDataByHashesReq = {
  cycle: number
  accounts: AccountIDAndHash[]
}

export const cGetAccountDataByHashesReqVersion = 1

export const serializeGetAccountDataByHashesReq = (
  stream: VectorBufferStream,
  inp: GetAccountDataByHashesReq,
  root = false
): void => {
  const errors = verifyPayload(AJVSchemaEnum.GetAccountDataByHashesReq, inp)
  if (errors && errors.length > 0) {
    throw new Error('Data validation error')
  }
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cGetAccountDataByHashesReq)
  }

  stream.writeUInt8(cGetAccountDataByHashesReqVersion)
  stream.writeBigUInt64(BigInt(inp.cycle))
  stream.writeUInt32(inp.accounts.length || 0)
  for (let i = 0; i < inp.accounts.length; i++) {
    // eslint-disable-next-line security/detect-object-injection
    stream.writeString(inp.accounts[i].accountID)
    // eslint-disable-next-line security/detect-object-injection
    stream.writeString(inp.accounts[i].hash)
  }
}

export const deserializeGetAccountDataByHashesReq = (
  stream: VectorBufferStream
): GetAccountDataByHashesReq => {
  const version = stream.readUInt8()
  if (version !== cGetAccountDataByHashesReqVersion) {
    throw new Error(
      `GetAccountDataByHashesReqDeserializer expected version ${cGetAccountDataByHashesReqVersion}, got ${version}`
    )
  }
  const cycleNumber = Number(stream.readBigUInt64())
  const accountsLength = stream.readUInt32()
  const result: GetAccountDataByHashesReq = {
    cycle: cycleNumber,
    accounts: [],
  }
  for (let i = 0; i < accountsLength; i++) {
    result.accounts.push({
      accountID: stream.readString(),
      hash: stream.readString(),
    })
  }
  const errors = verifyPayload(AJVSchemaEnum.GetAccountDataByHashesReq, result)
  if (errors && errors.length > 0) {
    throw new Error('Data validation error')
  }
  return result
}
