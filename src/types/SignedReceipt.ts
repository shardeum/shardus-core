import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { deserializeProposal, ProposalSerializable, serializeProposal } from './Proposal'
import { deserializeSign, serializeSign, SignSerializable } from './Sign'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'

export const cSignedReceiptVersion = 1

export type SignedReceiptSerializable = {
  proposal: ProposalSerializable
  proposalHash: string
  voteOffsets: number[]
  signaturePack: SignSerializable[]
}

export function serializeSignedReceipt(
  stream: VectorBufferStream,
  obj: SignedReceiptSerializable,
  root = false
): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cSignedReceipt)
  }
  stream.writeUInt8(cSignedReceiptVersion)

  serializeProposal(stream, obj.proposal)
  stream.writeString(obj.proposalHash)
  stream.writeUInt16(obj.voteOffsets.length)
  for (let i = 0; i < obj.voteOffsets.length; i++) {
    // eslint-disable-next-line security/detect-object-injection
    stream.writeUInt16(obj.voteOffsets[i])
  }
  stream.writeUInt16(obj.signaturePack.length)
  for (let i = 0; i < obj.signaturePack.length; i++) {
    // eslint-disable-next-line security/detect-object-injection
    serializeSign(stream, obj.signaturePack[i])
  }
}

export function deserializeSignedReceipt(stream: VectorBufferStream): SignedReceiptSerializable {
  const version = stream.readUInt8()
  if (version > cSignedReceiptVersion) {
    throw new Error(`SignedReceiptDeserializer expected version ${cSignedReceiptVersion}, got ${version}`)
  }
  const proposal = deserializeProposal(stream)
  const proposalHash = stream.readString()
  const voteOffsetsLength = stream.readUInt16()
  const voteOffsets: number[] = []
  for (let i = 0; i < voteOffsetsLength; i++) {
    voteOffsets.push(stream.readUInt16())
  }
  const signaturesLength = stream.readUInt16()
  const signatures: SignSerializable[] = []
  for (let i = 0; i < signaturesLength; i++) {
    signatures.push(deserializeSign(stream))
  }
  return {
    proposal,
    proposalHash,
    voteOffsets,
    signaturePack: signatures,
  }
}
