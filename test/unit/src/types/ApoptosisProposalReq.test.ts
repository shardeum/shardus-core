import {
  ApoptosisProposalReq,
  cApoptosisProposalReqVersion,
  deserializeApoptosisProposalReq,
  serializeApoptosisProposalReq,
} from '../../../../src/types/ApoptosisProposalReq'
import { initAjvSchemas } from '../../../../src/types/ajv/Helpers'
import { TypeIdentifierEnum } from '../../../../src/types/enum/TypeIdentifierEnum'
import { VectorBufferStream } from '../../../../src/utils/serialization/VectorBufferStream'
import { Utils } from '@shardus/types'

describe('ApoptosisProposalReq Serialization', () => {
  test('should serialize with root true', () => {
    const obj: ApoptosisProposalReq = { id: 'test', when: 1234 }
    const stream = new VectorBufferStream(0)
    serializeApoptosisProposalReq(stream, obj, true)

    const expectedStream = new VectorBufferStream(0)
    expectedStream.writeUInt16(TypeIdentifierEnum.cApoptosisProposalReq)
    expectedStream.writeUInt8(cApoptosisProposalReqVersion)
    expectedStream.writeString(obj.id)
    expectedStream.writeUInt32(obj.when)

    expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
  })

  test('should serialize with root false', () => {
    const obj: ApoptosisProposalReq = { id: 'test', when: 1234 }
    const stream = new VectorBufferStream(0)
    serializeApoptosisProposalReq(stream, obj, false)

    const expectedStream = new VectorBufferStream(0)
    expectedStream.writeUInt8(cApoptosisProposalReqVersion)
    expectedStream.writeString(obj.id)
    expectedStream.writeUInt32(obj.when)

    expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
  })

  test('should serialize with empty string', () => {
    const obj: ApoptosisProposalReq = { id: '', when: 1234 }
    const stream = new VectorBufferStream(0)
    serializeApoptosisProposalReq(stream, obj, false)

    const expectedStream = new VectorBufferStream(0)
    expectedStream.writeUInt8(cApoptosisProposalReqVersion)
    expectedStream.writeString(obj.id)
    expectedStream.writeUInt32(obj.when)

    expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
  })

  test('should serialize with large integer', () => {
    const obj: ApoptosisProposalReq = { id: 'large', when: 2147483647 }
    const stream = new VectorBufferStream(0)
    serializeApoptosisProposalReq(stream, obj, false)

    const expectedStream = new VectorBufferStream(0)
    expectedStream.writeUInt8(cApoptosisProposalReqVersion)
    expectedStream.writeString(obj.id)
    expectedStream.writeUInt32(obj.when)

    expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
  })
})

describe('ApoptosisProposalReq Deserialization', () => {
  beforeAll(() => {
    initAjvSchemas()
  })

  test('should deserialize successfully', () => {
    const stream = new VectorBufferStream(0)
    stream.writeUInt8(cApoptosisProposalReqVersion)
    stream.writeString('test')
    stream.writeUInt32(1234)
    stream.position = 0 // Reset position for reading
    const obj = deserializeApoptosisProposalReq(stream)

    expect(obj).toEqual({ id: 'test', when: 1234 })
  })

  test('should throw version mismatch error during deserialization', () => {
    const obj: ApoptosisProposalReq = { id: 'test', when: 1234 }
    const stream = new VectorBufferStream(0)
    serializeApoptosisProposalReq(stream, obj, false)

    // Manually increase the version number in the buffer to simulate a mismatch
    const buffer = stream.getBuffer()
    buffer[0] = cApoptosisProposalReqVersion + 1

    const alteredStream = VectorBufferStream.fromBuffer(buffer)
    expect(() => deserializeApoptosisProposalReq(alteredStream)).toThrow(
      'ApoptosisProposalReq version mismatch'
    )
  })

  test('should deserialize empty string', () => {
    const stream = new VectorBufferStream(0)
    stream.writeUInt8(cApoptosisProposalReqVersion)
    stream.writeString('')
    stream.writeUInt32(1234)
    stream.position = 0 // Reset position for reading
    const obj = deserializeApoptosisProposalReq(stream)

    expect(obj).toEqual({ id: '', when: 1234 })
  })

  test('should deserialize large integer', () => {
    const stream = new VectorBufferStream(0)
    stream.writeUInt8(cApoptosisProposalReqVersion)
    stream.writeString('large')
    stream.writeUInt32(2147483647)
    stream.position = 0 // Reset position for reading
    const obj = deserializeApoptosisProposalReq(stream)

    expect(obj).toEqual({ id: 'large', when: 2147483647 })
  })
})
