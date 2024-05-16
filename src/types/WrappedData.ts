import { safeJsonParse, safeStringify } from '@shardus/types/build/src/utils/functions/stringify'
import { stateManager } from '../p2p/Context'
import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { AppObjEnum } from './enum/AppObjEnum'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'

export const cWrappedDataVersion = 1
export interface WrappedData {
  accountId: string
  stateId: string // hash of the data blob
  data: unknown // data blob opaqe
  timestamp: number
  syncData?: unknown
}

export function serializeWrappedData(stream: VectorBufferStream, obj: WrappedData, root = false): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cWrappedData)
  }
  stream.writeUInt8(cWrappedDataVersion)
  stream.writeString(obj.accountId)
  stream.writeString(obj.stateId)
  stream.writeBuffer(stateManager.app.binarySerializeObject(AppObjEnum.AppData, obj.data))
  stream.writeBigUInt64(BigInt(obj.timestamp))
  if (obj.syncData !== undefined) {
    stream.writeUInt8(1)
    stream.writeString(safeStringify(obj.syncData))
  } else {
    stream.writeUInt8(0)
  }
}

export function deserializeWrappedData(stream: VectorBufferStream): WrappedData {
  const version = stream.readUInt8()
  if (version > cWrappedDataVersion) {
    throw new Error(`WrappedData version mismatch`)
  }
  return {
    accountId: stream.readString(),
    stateId: stream.readString(),
    data: stateManager.app.binaryDeserializeObject(AppObjEnum.AppData, stream.readBuffer()),
    timestamp: Number(stream.readBigUInt64()),
    syncData: stream.readUInt8() === 1 ? safeJsonParse(stream.readString()) : undefined,
  }
}
