import { stateManager } from '../p2p/Context'
import {
  AppObjEnum,
  OpaqueTransaction,
  ShardusMemoryPatternsInput,
  TransactionKeys,
} from '../shardus/shardus-types'
import { DeSerializeFromJsonString, SerializeToJsonString } from '../utils'
import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'

const cSpreadTxToGroupSyncingReqVersion = 1
export type SpreadTxToGroupSyncingReq = {
  timestamp: number
  txId: string
  keys: TransactionKeys
  data: OpaqueTransaction
  appData: unknown
  shardusMemoryPatterns: ShardusMemoryPatternsInput
}

export function serializeSpreadTxToGroupSyncingReq(
  stream: VectorBufferStream,
  inp: SpreadTxToGroupSyncingReq,
  root = false
): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cSpreadTxToGroupSyncingReq)
  }
  stream.writeUInt8(cSpreadTxToGroupSyncingReqVersion)
  stream.writeBigUInt64(BigInt(inp.timestamp))
  stream.writeString(inp.txId)
  stream.writeString(SerializeToJsonString(inp.keys))
  stream.writeString(SerializeToJsonString(inp.data))
  stream.writeBuffer(stateManager.app.binarySerializeObject(AppObjEnum.AppData, inp.appData))
  stream.writeString(SerializeToJsonString(inp.shardusMemoryPatterns))
}

export function deserializeSpreadTxToGroupSyncingReq(stream: VectorBufferStream): SpreadTxToGroupSyncingReq {
  const version = stream.readUInt8()
  if (version > cSpreadTxToGroupSyncingReqVersion) {
    throw new Error('SpreadTxToGroupSyncingReq Unsupported version')
  }
  return {
    timestamp: Number(stream.readBigUInt64()),
    txId: stream.readString(),
    keys: DeSerializeFromJsonString(stream.readString()),
    data: DeSerializeFromJsonString(stream.readString()),
    appData: stateManager.app.binaryDeserializeObject(AppObjEnum.AppData, stream.readBuffer()),
    shardusMemoryPatterns: DeSerializeFromJsonString(stream.readString()),
  }
}
