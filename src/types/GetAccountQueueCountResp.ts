import { stateManager } from '../p2p/Context'
import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { verifyPayload } from './ajv/Helpers'
import { AJVSchemaEnum } from './enum/AJVSchemaEnum'
import { AppObjEnum } from './enum/AppObjEnum'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'

export type GetAccountQueueCountResp =
  | {
      counts: number[]
      committingAppData: unknown[]
      accounts: unknown[]
    }
  | false

export const cGetAccountQueueCountRespVersion = 1

export function serializeGetAccountQueueCountResp(
  stream: VectorBufferStream,
  obj: GetAccountQueueCountResp,
  root = false
): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cGetAccountQueueCountResp)
  }
  stream.writeUInt8(cGetAccountQueueCountRespVersion)
  if (obj === false) {
    stream.writeUInt8(0)
  } else {
    stream.writeUInt8(1)
    stream.writeUInt16(obj.counts.length)
    obj.counts.forEach((count) => stream.writeUInt32(count))
    stream.writeUInt16(obj.committingAppData.length)
    obj.committingAppData.forEach((data) =>
      stream.writeBuffer(stateManager.app.binarySerializeObject(AppObjEnum.AppData, data))
    )
    stream.writeUInt16(obj.accounts.length)
    obj.accounts.forEach((account) =>
      stream.writeBuffer(stateManager.app.binarySerializeObject(AppObjEnum.AppData, account))
    )
  }

  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cGetAccountQueueCountResp)
  }
}

export function deserializeGetAccountQueueCountResp(stream: VectorBufferStream): GetAccountQueueCountResp {
  const version = stream.readUInt8()
  if (version > cGetAccountQueueCountRespVersion) {
    throw new Error('GetAccountQueueCountResp version mismatch')
  }
  const typeIndicator = stream.readUInt8()
  if (typeIndicator === 0) {
    return false
  } else {
    const countsLength = stream.readUInt16()
    const counts = []
    for (let i = 0; i < countsLength; i++) {
      counts.push(stream.readUInt32())
    }
    const committingAppDataLength = stream.readUInt16()
    const committingAppData = []
    for (let i = 0; i < committingAppDataLength; i++) {
      committingAppData.push(
        stateManager.app.binaryDeserializeObject(AppObjEnum.AppData, stream.readBuffer())
      )
    }
    const accountsLength = stream.readUInt16()
    const accounts = []
    for (let i = 0; i < accountsLength; i++) {
      accounts.push(stateManager.app.binaryDeserializeObject(AppObjEnum.AppData, stream.readBuffer()))
    }
    const errors = verifyPayload(AJVSchemaEnum.GetAccountQueueCountResp, {
      counts,
      committingAppData,
      accounts,
    })
    if (errors && errors.length > 0) {
      throw new Error('Data validation error')
    }
    return {
      counts,
      committingAppData,
      accounts,
    }
  }
}
