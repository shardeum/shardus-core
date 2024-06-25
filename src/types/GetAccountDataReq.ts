import { isValidShardusAddress } from '../utils'
import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { verifyPayload } from './ajv/Helpers'
import { AJVSchemaEnum } from './enum/AJVSchemaEnum'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'

export type GetAccountDataReqSerializable = {
  accountStart: string
  accountEnd: string
  tsStart: number
  maxRecords: number
  offset: number
  accountOffset: string
}

const cGetAccountDataReqVersion = 1

export function serializeGetAccountDataReq(
  stream: VectorBufferStream,
  inp: GetAccountDataReqSerializable,
  root = false
): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cGetAccountDataReq)
  }
  stream.writeUInt8(cGetAccountDataReqVersion)
  stream.writeString(inp.accountStart)
  stream.writeString(inp.accountEnd)
  stream.writeBigUInt64(BigInt(inp.tsStart))
  stream.writeBigUInt64(BigInt(inp.maxRecords))
  stream.writeBigUInt64(BigInt(inp.offset))
  stream.writeString(inp.accountOffset)
}

export function deserializeGetAccountDataReq(stream: VectorBufferStream): GetAccountDataReqSerializable {
  const version = stream.readUInt8()
  if (version > cGetAccountDataReqVersion) {
    throw new Error('GetAccountDataReq version mismatch')
  }
  const obj: GetAccountDataReqSerializable = {
    accountStart: stream.readString(),
    accountEnd: stream.readString(),
    tsStart: Number(stream.readBigUInt64()),
    maxRecords: Number(stream.readBigUInt64()),
    offset: Number(stream.readBigUInt64()),
    accountOffset: stream.readString(),
  }
  const errors = verifyPayload(AJVSchemaEnum.GetAccountDataReq, obj)
  if (errors && errors.length > 0) {
    throw new Error('Data validation error')
  }
  return obj
}

export function verifyGetAccountDataReq(obj: GetAccountDataReqSerializable): boolean {
  if (isValidShardusAddress([obj.accountStart, obj.accountEnd]) === false) {
    /* prettier-ignore */ console.log(`GetAccountDataReq: Invalid accountStart or accountEnd: ${obj.accountStart}, ${obj.accountEnd}`)
    return false
  }
}
