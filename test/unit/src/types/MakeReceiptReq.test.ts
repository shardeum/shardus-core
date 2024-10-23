import {
  serializeMakeReceiptReq,
  deserializeMakeReceiptReq,
  MakeReceiptReq,
} from '../../../../src/types/MakeReceipReq'
import { VectorBufferStream } from '../../../../src/utils/serialization/VectorBufferStream'
import { TypeIdentifierEnum } from '../../../../src/types/enum/TypeIdentifierEnum'
import { initAjvSchemas } from '../../../../src/types/ajv/Helpers'
import { Utils } from '@shardus/types'

describe('MakeReceiptReq Tests', () => {
  beforeAll(() => {
    initAjvSchemas()
  })

  describe('serializeMakeReceiptReq', () => {
    let stream: VectorBufferStream

    beforeEach(() => {
      stream = new VectorBufferStream(0)
    })

    it('should serialize correctly with root flag false', () => {
      const obj: MakeReceiptReq = {
        sign: {
          owner: 'owner123',
          sig: 'signature123',
        },
        address: 'address123',
        addressHash: 'addressHash123',
        value: { key: 'value' },
        when: 1234567890,
        source: 'source123',
      }
      serializeMakeReceiptReq(stream, obj, false)
      stream.position = 0 // Reset stream position to read from the beginning
      expect(stream.readUInt8()).toBe(1) // Version
      expect(stream.readString()).toBe(obj.sign.owner)
      expect(stream.readString()).toBe(obj.sign.sig)
      expect(stream.readString()).toBe(obj.address)
      expect(stream.readString()).toBe(obj.addressHash)
      expect(stream.readString()).toBe(Utils.safeStringify(obj.value))
      expect(stream.readBigUInt64()).toBe(BigInt(obj.when))
      expect(stream.readString()).toBe(obj.source)
    })

    it('should serialize correctly with root flag true', () => {
      const obj: MakeReceiptReq = {
        sign: {
          owner: 'owner123',
          sig: 'signature123',
        },
        address: 'address123',
        addressHash: 'addressHash123',
        value: { key: 'value' },
        when: 1234567890,
        source: 'source123',
      }
      serializeMakeReceiptReq(stream, obj, true)
      stream.position = 0 // Reset stream position to read from the beginning
      expect(stream.readUInt16()).toBe(TypeIdentifierEnum.cMakeReceiptReq)
      expect(stream.readUInt8()).toBe(1) // Version
      expect(stream.readString()).toBe(obj.sign.owner)
      expect(stream.readString()).toBe(obj.sign.sig)
      expect(stream.readString()).toBe(obj.address)
      expect(stream.readString()).toBe(obj.addressHash)
      expect(stream.readString()).toBe(Utils.safeStringify(obj.value))
      expect(stream.readBigUInt64()).toBe(BigInt(obj.when))
      expect(stream.readString()).toBe(obj.source)
    })

    it('should handle empty strings correctly', () => {
      const obj: MakeReceiptReq = {
        sign: {
          owner: '',
          sig: '',
        },
        address: '',
        addressHash: '',
        value: {},
        when: 0,
        source: '',
      }
      serializeMakeReceiptReq(stream, obj, false)
      stream.position = 0 // Reset stream position to read from the beginning
      expect(stream.readUInt8()).toBe(1) // Version
      expect(stream.readString()).toBe(obj.sign.owner)
      expect(stream.readString()).toBe(obj.sign.sig)
      expect(stream.readString()).toBe(obj.address)
      expect(stream.readString()).toBe(obj.addressHash)
      expect(stream.readString()).toBe(Utils.safeStringify(obj.value))
      expect(stream.readBigUInt64()).toBe(BigInt(obj.when))
      expect(stream.readString()).toBe(obj.source)
    })

    it('should handle large integer values correctly', () => {
      const obj: MakeReceiptReq = {
        sign: {
          owner: 'owner123',
          sig: 'signature123',
        },
        address: 'address123',
        addressHash: 'addressHash123',
        value: { key: 'value' },
        when: Number.MAX_SAFE_INTEGER,
        source: 'source123',
      }
      serializeMakeReceiptReq(stream, obj, false)
      stream.position = 0 // Reset stream position to read from the beginning
      expect(stream.readUInt8()).toBe(1) // Version
      expect(stream.readString()).toBe(obj.sign.owner)
      expect(stream.readString()).toBe(obj.sign.sig)
      expect(stream.readString()).toBe(obj.address)
      expect(stream.readString()).toBe(obj.addressHash)
      expect(stream.readString()).toBe(Utils.safeStringify(obj.value))
      expect(stream.readBigUInt64()).toBe(BigInt(obj.when))
      expect(stream.readString()).toBe(obj.source)
    })
  })

  describe('deserializeMakeReceiptReq', () => {
    let stream: VectorBufferStream

    beforeEach(() => {
      stream = new VectorBufferStream(0)
    })

    it('should throw error on unsupported version', () => {
      stream.writeUInt8(2) // Write an unsupported version
      stream.writeString('owner123')
      stream.writeString('signature123')
      stream.writeString('address123')
      stream.writeString(Utils.safeStringify({ key: 'value' }))
      stream.writeBigUInt64(BigInt(1234567890))
      stream.writeString('source123')
      stream.position = 0 // Reset stream position to read from the beginning
      expect(() => deserializeMakeReceiptReq(stream)).toThrow('Invalid version 2 for MakeReceiptReq')
    })

    it('should deserialize correctly', () => {
      const obj: MakeReceiptReq = {
        sign: {
          owner: 'owner123',
          sig: 'signature123',
        },
        address: 'address123',
        addressHash: 'addressHash123',
        value: { key: 'value' },
        when: 1234567890,
        source: 'source123',
      }
      stream.writeUInt8(1) // Version
      stream.writeString(obj.sign.owner)
      stream.writeString(obj.sign.sig)
      stream.writeString(obj.address)
      stream.writeString(obj.addressHash)
      stream.writeString(Utils.safeStringify(obj.value))
      stream.writeBigUInt64(BigInt(obj.when))
      stream.writeString(obj.source)
      stream.position = 0 // Reset stream position to read from the beginning
      const result = deserializeMakeReceiptReq(stream)
      expect(result).toEqual(obj)
    })

    it('should handle empty strings correctly during deserialization', () => {
      const obj: MakeReceiptReq = {
        sign: {
          owner: '',
          sig: '',
        },
        address: '',
        addressHash: '',
        value: {},
        when: 0,
        source: '',
      }
      stream.writeUInt8(1) // Version
      stream.writeString(obj.sign.owner)
      stream.writeString(obj.sign.sig)
      stream.writeString(obj.address)
      stream.writeString(obj.addressHash)
      stream.writeString(Utils.safeStringify(obj.value))
      stream.writeBigUInt64(BigInt(obj.when))
      stream.writeString(obj.source)
      stream.position = 0 // Reset stream position to read from the beginning
      const result = deserializeMakeReceiptReq(stream)
      expect(result).toEqual(obj)
    })

    it('should handle large integer values correctly during deserialization', () => {
      const obj: MakeReceiptReq = {
        sign: {
          owner: 'owner123',
          sig: 'signature123',
        },
        address: 'address123',
        addressHash: 'addressHash123',
        value: { key: 'value' },
        when: Number.MAX_SAFE_INTEGER,
        source: 'source123',
      }
      stream.writeUInt8(1) // Version
      stream.writeString(obj.sign.owner)
      stream.writeString(obj.sign.sig)
      stream.writeString(obj.address)
      stream.writeString(obj.addressHash)
      stream.writeString(Utils.safeStringify(obj.value))
      stream.writeBigUInt64(BigInt(obj.when))
      stream.writeString(obj.source)
      stream.position = 0 // Reset stream position to read from the beginning
      const result = deserializeMakeReceiptReq(stream)
      expect(result).toEqual(obj)
    })
  })
})
