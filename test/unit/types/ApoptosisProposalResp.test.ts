import { VectorBufferStream } from '../../../src'
import {
  ApoptosisProposalResp,
  cApoptosisProposalRespVersion,
  deserializeApoptosisProposalResp,
  serializeApoptosisProposalResp,
} from '../../../src/types/ApoptosisProposalResp'
import { initAjvSchemas } from '../../../src/types/ajv/Helpers'
import { TypeIdentifierEnum } from '../../../src/types/enum/TypeIdentifierEnum'

describe('ApoptosisProposalResp Serialization', () => {
  beforeAll(() => {
    initAjvSchemas()
  })

  describe('Data validation Cases', () => {
    const incompleteObjects = [
      { description: "missing 's'", data: { r: 1234 } as ApoptosisProposalResp },
      { description: "missing 'r'", data: { s: 'test' } as ApoptosisProposalResp },
      {
        description: "null value in a field' ",
        data: { r: 12, s: 'check for null' } as ApoptosisProposalResp,
      },
    ]

    test.each(incompleteObjects)(
      'should throw error if field is improper during serialization',
      ({ data }) => {
        if (data.s === 'check for null') data.s = null // we have added this for custom validation purposes
        const stream = new VectorBufferStream(0)
        expect(() => serializeApoptosisProposalResp(stream, data)).toThrow('Data validation error')
      }
    )
  })

  test('should serialize with root true', () => {
    const obj: ApoptosisProposalResp = { s: 'test', r: 1234 }
    const stream = new VectorBufferStream(0)
    serializeApoptosisProposalResp(stream, obj, true)

    const expectedStream = new VectorBufferStream(0)
    expectedStream.writeUInt16(TypeIdentifierEnum.cApoptosisProposalResp)
    expectedStream.writeUInt8(cApoptosisProposalRespVersion)
    expectedStream.writeString(obj.s)
    expectedStream.writeInt32(obj.r)

    expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
  })

  test('should serialize with root false', () => {
    const obj: ApoptosisProposalResp = { s: 'test', r: 1234 }
    const stream = new VectorBufferStream(0)
    serializeApoptosisProposalResp(stream, obj, false)

    const expectedStream = new VectorBufferStream(0)
    expectedStream.writeUInt8(cApoptosisProposalRespVersion)
    expectedStream.writeString(obj.s)
    expectedStream.writeInt32(obj.r)

    expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
  })

  test('should serialize with empty string', () => {
    const obj: ApoptosisProposalResp = { s: '', r: 1234 }
    const stream = new VectorBufferStream(0)
    serializeApoptosisProposalResp(stream, obj, false)

    const expectedStream = new VectorBufferStream(0)
    expectedStream.writeUInt8(cApoptosisProposalRespVersion)
    expectedStream.writeString(obj.s)
    expectedStream.writeInt32(obj.r)

    expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
  })

  test('should serialize with large integer', () => {
    const obj: ApoptosisProposalResp = { s: 'large', r: 2147483647 }
    const stream = new VectorBufferStream(0)
    serializeApoptosisProposalResp(stream, obj, false)

    const expectedStream = new VectorBufferStream(0)
    expectedStream.writeUInt8(cApoptosisProposalRespVersion)
    expectedStream.writeString(obj.s)
    expectedStream.writeInt32(obj.r)

    expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
  })

  test('should serialize with negative integer', () => {
    const obj: ApoptosisProposalResp = { s: 'negative', r: -1234 }
    const stream = new VectorBufferStream(0)
    serializeApoptosisProposalResp(stream, obj, false)

    const expectedStream = new VectorBufferStream(0)
    expectedStream.writeUInt8(cApoptosisProposalRespVersion)
    expectedStream.writeString(obj.s)
    expectedStream.writeInt32(obj.r)

    expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
  })
})

describe('ApoptosisProposalResp Deserialization', () => {
  test('should deserialize successfully', () => {
    const stream = new VectorBufferStream(0)
    stream.writeUInt8(cApoptosisProposalRespVersion)
    stream.writeString('test')
    stream.writeInt32(1234)
    stream.position = 0 // Reset position for reading
    const obj = deserializeApoptosisProposalResp(stream)

    expect(obj).toEqual({ s: 'test', r: 1234 })
  })

  test('should throw version mismatch error during deserialization', () => {
    const obj: ApoptosisProposalResp = { s: 'test', r: 1234 }
    const stream = new VectorBufferStream(0)
    serializeApoptosisProposalResp(stream, obj, false)

    // Manually increase the version number in the buffer to simulate a mismatch
    const buffer = stream.getBuffer()
    buffer[0] = cApoptosisProposalRespVersion + 1

    const alteredStream = VectorBufferStream.fromBuffer(buffer)
    expect(() => deserializeApoptosisProposalResp(alteredStream)).toThrow(
      'ApoptosisProposalResp version mismatch'
    )
  })

  test('should deserialize empty string', () => {
    const stream = new VectorBufferStream(0)
    stream.writeUInt8(cApoptosisProposalRespVersion)
    stream.writeString('')
    stream.writeInt32(1234)
    stream.position = 0 // Reset position for reading
    const obj = deserializeApoptosisProposalResp(stream)

    expect(obj).toEqual({ s: '', r: 1234 })
  })

  test('should deserialize large integer', () => {
    const stream = new VectorBufferStream(0)
    stream.writeUInt8(cApoptosisProposalRespVersion)
    stream.writeString('large')
    stream.writeInt32(2147483647)
    stream.position = 0 // Reset position for reading
    const obj = deserializeApoptosisProposalResp(stream)

    expect(obj).toEqual({ s: 'large', r: 2147483647 })
  })

  test('should deserialize negative integer', () => {
    const stream = new VectorBufferStream(0)
    stream.writeUInt8(cApoptosisProposalRespVersion)
    stream.writeString('negative')
    stream.writeInt32(-1234)
    stream.position = 0 // Reset position for reading
    const obj = deserializeApoptosisProposalResp(stream)

    expect(obj).toEqual({ s: 'negative', r: -1234 })
  })
})
