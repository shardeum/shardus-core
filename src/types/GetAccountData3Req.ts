import { VectorBufferStream } from "../utils/serialization/VectorBufferStream"
import { TypeIdentifierEnum } from "./enum/TypeIdentifierEnum"

export type GetAccountData3Req = {
  accountStart: string
  accountEnd: string
  tsStart: number
  maxRecords: number
  offset: number
  accountOffset: string
}

const cGetAccountData3ReqVersion = 1

export function serializeGetAccountData3Req(stream: VectorBufferStream, inp: GetAccountData3Req, root = false): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cGetAccountData3Req)
  }
  stream.writeUInt8(cGetAccountData3ReqVersion)
  stream.writeString(inp.accountStart)
  stream.writeString(inp.accountEnd)
  stream.writeString(inp.tsStart.toString())
  stream.writeString(inp.maxRecords.toString())
  stream.writeString(inp.offset.toString())
  stream.writeString(inp.accountOffset)
}

export function deserializeGetAccountData3Req(stream: VectorBufferStream): GetAccountData3Req {
  const version = stream.readUInt8()
  if (version !== cGetAccountData3ReqVersion) {
    throw new Error(`GetAccountData3Req version mismatch: expected ${cGetAccountData3ReqVersion}, got ${version}`)
  }
  const obj: GetAccountData3Req = {
    accountStart: stream.readString(),
    accountEnd: stream.readString(),
    tsStart: Number(stream.readString()),
    maxRecords: Number(stream.readString()),
    offset: Number(stream.readString()),
    accountOffset: stream.readString(),
  }
  return obj
}
