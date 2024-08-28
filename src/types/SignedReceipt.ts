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
  sign?: SignSerializable
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
  if (obj.sign) {
    stream.writeUInt8(1)
    serializeSign(stream, obj.sign)
  } else {
    stream.writeUInt8(0)
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
  const hasSign = stream.readUInt8()
  if (hasSign) {
    return {
      proposal,
      proposalHash,
      voteOffsets,
      signaturePack: signatures,
      sign: deserializeSign(stream),
    }
  } else {
    return {
      proposal,
      proposalHash,
      voteOffsets,
      signaturePack: signatures,
    }
  }
}
