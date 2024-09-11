import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'

export const cProposalVersion = 1

export type ProposalSerializable = {
  applied: boolean
  cant_preApply: boolean
  accountIDs: string[]
  beforeStateHashes: string[]
  afterStateHashes: string[]
  appReceiptDataHash: string
  txid: string
}

export function serializeProposal(stream: VectorBufferStream, obj: ProposalSerializable, root = false): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cProposalVersion)
  }
  stream.writeUInt8(cProposalVersion)

  stream.writeUInt8(obj.applied ? 1 : 0)
  stream.writeUInt8(obj.cant_preApply ? 1 : 0)
  stream.writeUInt16(obj.accountIDs.length)
  for (let i = 0; i < obj.accountIDs.length; i++) {
    // eslint-disable-next-line security/detect-object-injection
    stream.writeString(obj.accountIDs[i])
  }
  stream.writeUInt16(obj.beforeStateHashes.length)
  for (let i = 0; i < obj.beforeStateHashes.length; i++) {
    // eslint-disable-next-line security/detect-object-injection
    stream.writeString(obj.beforeStateHashes[i])
  }
  stream.writeUInt16(obj.afterStateHashes.length)
  for (let i = 0; i < obj.afterStateHashes.length; i++) {
    // eslint-disable-next-line security/detect-object-injection
    stream.writeString(obj.afterStateHashes[i])
  }
  stream.writeString(obj.appReceiptDataHash)
  stream.writeString(obj.txid)
}

export function deserializeProposal(stream: VectorBufferStream): ProposalSerializable {
  const version = stream.readUInt8()
  if (version > cProposalVersion) {
    throw new Error(`ProposalDeserializer expected version ${cProposalVersion}, got ${version}`)
  }
  const applied = stream.readUInt8() === 1
  const cant_preApply = stream.readUInt8() === 1
  const accountIDsLength = stream.readUInt16()
  const accountIDs: string[] = []
  for (let i = 0; i < accountIDsLength; i++) {
    accountIDs.push(stream.readString())
  }
  const beforeStateHashesLength = stream.readUInt16()
  const beforeStateHashes: string[] = []
  for (let i = 0; i < beforeStateHashesLength; i++) {
    beforeStateHashes.push(stream.readString())
  }
  const afterStateHashesLength = stream.readUInt16()
  const afterStateHashes: string[] = []
  for (let i = 0; i < afterStateHashesLength; i++) {
    afterStateHashes.push(stream.readString())
  }
  const appReceiptDataHash = stream.readString()
  const txid = stream.readString()
  return {
    applied,
    cant_preApply,
    accountIDs,
    beforeStateHashes,
    afterStateHashes,
    appReceiptDataHash,
    txid,
  }
}
