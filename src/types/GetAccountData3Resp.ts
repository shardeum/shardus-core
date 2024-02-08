
import { WrappedData, serializeWrappedData, deserializeWrappedData } from "./WrappedData"
import { VectorBufferStream } from "../utils/serialization/VectorBufferStream"
import { TypeIdentifierEnum } from "./enum/TypeIdentifierEnum"

export type GetAccountData3RespSerialized = {
  data?: {
    wrappedAccounts: WrappedData[]
    lastUpdateNeeded: boolean
    wrappedAccounts2: WrappedData[]
    highestTs: number
    delta: number
  }
  errors?: string[]
}

const cGetAccountData3RespVersion = 1

export function serializeGetAccountData3Resp(stream: VectorBufferStream, inp: GetAccountData3RespSerialized, root = false): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cGetAccountData3Resp)
  }
  stream.writeUInt8(cGetAccountData3RespVersion)
  if (inp.errors) {
    stream.writeUInt8(1) // this mean, the error field is present
    stream.writeInt32(inp.errors.length)
    for (const errors of inp.errors) {
      stream.writeString(errors)
    }
  } else {
    stream.writeUInt8(0)
  }

  if(inp.data){ 
    stream.writeUInt8(1) // this mean, the data field is present
    stream.writeUInt32(inp.data.wrappedAccounts.length || 0)
    for (const wrappedAccounts of inp.data.wrappedAccounts) {
      serializeWrappedData(stream, wrappedAccounts, true)
    }
    stream.writeUInt8(inp.data.lastUpdateNeeded ? 1 : 0)
    stream.writeInt32(inp.data.wrappedAccounts2.length || 0)
    for (const wrappedAccounts2 of inp.data.wrappedAccounts2) {
      serializeWrappedData(stream, wrappedAccounts2, true)
    }
    stream.writeString(inp.data.highestTs.toString())
    stream.writeString(inp.data.delta.toString())
  } else {
    stream.writeUInt8(0)
  }
}


export function deserializeGetAccountData3Resp(stream: VectorBufferStream): GetAccountData3RespSerialized {
  const version = stream.readUInt8()
  if (version !== cGetAccountData3RespVersion) {
    throw new Error(`GetAccountData3Resp version mismatch: expected ${cGetAccountData3RespVersion}, got ${version}`)
  }
  const obj: GetAccountData3RespSerialized = {
    data: undefined,
    errors: undefined
  }
  const errorsPresent = stream.readUInt8()
  if (errorsPresent) {
    const errorsLength = stream.readInt32()
    obj.errors = []
    for (let i = 0; i < errorsLength; i++) {
      obj.errors.push(stream.readString())
    }
  }
  const dataPresent = stream.readUInt8()
  if (dataPresent) {
    obj.data = {
      wrappedAccounts: [],
      lastUpdateNeeded: false,
      wrappedAccounts2: [],
      highestTs: 0,
      delta: 0
    }
    const wrappedAccountsLength = stream.readUInt32()
    for (let i = 0; i < wrappedAccountsLength; i++) {
      obj.data.wrappedAccounts.push(deserializeWrappedData(stream))
    }
    obj.data.lastUpdateNeeded = stream.readUInt8() === 1
    const wrappedAccounts2Length = stream.readInt32()
    for (let i = 0; i < wrappedAccounts2Length; i++) {
      obj.data.wrappedAccounts2.push(deserializeWrappedData(stream))
    }
    obj.data.highestTs = parseInt(stream.readString())
    obj.data.delta = parseInt(stream.readString())
  }
  return obj
}

