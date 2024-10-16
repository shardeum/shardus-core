import { Utils } from '@shardus/types'
import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'
import { verifyPayload } from './ajv/Helpers'
import { AJVSchemaEnum } from './enum/AJVSchemaEnum'

export const cMakeReceiptReqVersion = 1

export type MakeReceiptReq = {
  sign: {
    owner: string
    sig: string
  }
  address: string
  addressHash: string
  value: unknown
  when: number
  source: string
}

export function serializeMakeReceiptReq(stream: VectorBufferStream, obj: MakeReceiptReq, root = false): void {
  if (root) {
    stream.writeInt16(TypeIdentifierEnum.cMakeReceiptReq)
  }
  stream.writeUInt8(cMakeReceiptReqVersion)
  stream.writeString(obj.sign.owner)
  stream.writeString(obj.sign.sig)
  stream.writeString(obj.address)
  stream.writeString(obj.addressHash)
  stream.writeString(Utils.safeStringify(obj.value))
  stream.writeBigUInt64(BigInt(obj.when))
  stream.writeString(obj.source)
}

export function deserializeMakeReceiptReq(stream: VectorBufferStream): MakeReceiptReq {
  const version = stream.readUInt8()
  if (version > cMakeReceiptReqVersion) {
    throw new Error(`Invalid version ${version} for MakeReceiptReq`)
  }
  const obj: MakeReceiptReq = {
    sign: {
      owner: stream.readString(),
      sig: stream.readString(),
    },
    address: stream.readString(),
    addressHash: stream.readString(),
    value: Utils.safeJsonParse(stream.readString()),
    when: Number(stream.readBigUInt64()),
    source: stream.readString(),
  }
  const errors = verifyPayload(AJVSchemaEnum.MakeReceiptReq, obj)
  if (errors && errors.length > 0) {
    throw new Error('Data validation error')
  }
  return obj
}
