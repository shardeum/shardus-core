import { AccountRepairInstruction } from '../state-manager/AccountPatcher'
import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { deserializeAppliedReceipt2, serializeAppliedReceipt2 } from './AppliedReceipt2'
import { deserializeWrappedData, serializeWrappedData } from './WrappedData'
import { verifyPayload } from './ajv/Helpers'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'

export type RepairMissingAccountsReq = {
  repairInstructions: AccountRepairInstruction[]
}

export const cRepairMissingAccountsReqVersion = 1

//TODO: add file in /ajv folder
// Two enums

export const serializeRepairMissingAccountsReq = (
  stream: VectorBufferStream,
  inp: RepairMissingAccountsReq,
  root = false
): void => {
  // const errors = verifyPayload('RepairMissingAccountsReq', inp)
  // if (errors && errors.length > 0) {
  //   throw new Error('Data validation error')
  // }
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cRepairMissingAccountsReq)
  }

  stream.writeUInt8(cRepairMissingAccountsReqVersion)
  stream.writeUInt32(inp.repairInstructions.length || 0)
  for (let i = 0; i < inp.repairInstructions.length; i++) {
    // eslint-disable-next-line security/detect-object-injection
    stream.writeString(inp.repairInstructions[i].accountID)
    // eslint-disable-next-line security/detect-object-injection
    stream.writeString(inp.repairInstructions[i].hash)
    // eslint-disable-next-line security/detect-object-injection
    stream.writeString(inp.repairInstructions[i].txId)
    // eslint-disable-next-line security/detect-object-injection
    serializeWrappedData(stream, inp.repairInstructions[i].accountData)
    // eslint-disable-next-line security/detect-object-injection
    stream.writeString(inp.repairInstructions[i].targetNodeId)
    // eslint-disable-next-line security/detect-object-injection
    serializeAppliedReceipt2(stream, inp.repairInstructions[i].receipt2)
  }
}

export const deserializeRepairMissingAccountsReq = (stream: VectorBufferStream): RepairMissingAccountsReq => {
  const version = stream.readUInt8()
  if (version !== cRepairMissingAccountsReqVersion) {
    throw new Error(
      `RepairMissingAccountsReqDeserializer expected version ${cRepairMissingAccountsReqVersion}, got ${version}`
    )
  }
  const repairInstructionsLength = stream.readUInt32()
  const result: RepairMissingAccountsReq = {
    repairInstructions: [],
  }
  for (let i = 0; i < repairInstructionsLength; i++) {
    result.repairInstructions.push({
      accountID: stream.readString(),
      hash: stream.readString(),
      txId: stream.readString(),
      accountData: deserializeWrappedData(stream),
      targetNodeId: stream.readString(),
      receipt2: deserializeAppliedReceipt2(stream),
    })
  }
  // const errors = verifyPayload('RepairMissingAccountsReq', result)
  // if (errors && errors.length > 0) {
  //   throw new Error('Data validation error')
  // }
  return result
}
