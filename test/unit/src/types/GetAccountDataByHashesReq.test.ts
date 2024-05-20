import { VectorBufferStream } from '../../../../src'
import {
  GetAccountDataByHashesReq,
  cGetAccountDataByHashesReqVersion,
  deserializeGetAccountDataByHashesReq,
  serializeGetAccountDataByHashesReq,
} from '../../../../src/types/GetAccountDataByHashesReq'
import { initAjvSchemas } from '../../../../src/types/ajv/Helpers'
import { TypeIdentifierEnum } from '../../../../src/types/enum/TypeIdentifierEnum'

describe('GetAccountDataByHashesReq Tests', () => {
  beforeAll(() => {
    initAjvSchemas()
  })
  describe('Serialization Tests', () => {
    test('Basic Serialization with Valid Input Correctly, root true', () => {
      const obj: GetAccountDataByHashesReq = {
        cycle: 1,
        accounts: [{ accountID: 'acc1', hash: 'hash1' }],
      }
      const stream = new VectorBufferStream(0)
      serializeGetAccountDataByHashesReq(stream, obj, true)

      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt16(TypeIdentifierEnum.cGetAccountDataByHashesReq)
      expectedStream.writeUInt8(cGetAccountDataByHashesReqVersion)
      expectedStream.writeBigUInt64(BigInt(obj.cycle))
      expectedStream.writeUInt32(obj.accounts.length || 0)
      for (let i = 0; i < obj.accounts.length; i++) {
        expectedStream.writeString(obj.accounts[i].accountID)
        expectedStream.writeString(obj.accounts[i].hash)
      }
      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })

    test('Basic Serialization with Valid Input Correctly, root false', () => {
      const obj: GetAccountDataByHashesReq = {
        cycle: 1,
        accounts: [{ accountID: 'acc1', hash: 'hash1' }],
      }
      const stream = new VectorBufferStream(0)
      serializeGetAccountDataByHashesReq(stream, obj, false)

      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt8(cGetAccountDataByHashesReqVersion)
      expectedStream.writeBigUInt64(BigInt(obj.cycle))
      expectedStream.writeUInt32(obj.accounts.length || 0)
      for (let i = 0; i < obj.accounts.length; i++) {
        expectedStream.writeString(obj.accounts[i].accountID)
        expectedStream.writeString(obj.accounts[i].hash)
      }
      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })

    test('Empty Accounts Array', () => {
      const obj = { cycle: 2, accounts: [] }
      const stream = new VectorBufferStream(0)
      serializeGetAccountDataByHashesReq(stream, obj, false)
      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt8(cGetAccountDataByHashesReqVersion)
      expectedStream.writeBigUInt64(BigInt(obj.cycle))
      expectedStream.writeUInt32(0)
      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })

    test('Version Mismatch Error', () => {
      const data = { cycle: 7, accounts: [{ accountID: 'acc7', hash: 'hash7' }] }
      const stream = new VectorBufferStream(0)
      serializeGetAccountDataByHashesReq(stream, data, false)
      const buffer = stream.getBuffer()
      buffer[0] = cGetAccountDataByHashesReqVersion + 1 // Corrupt the version byte
      stream.position = 0
      expect(() => deserializeGetAccountDataByHashesReq(stream)).toThrow(
        `GetAccountDataByHashesReqDeserializer expected version ${cGetAccountDataByHashesReqVersion}, got ${
          cGetAccountDataByHashesReqVersion + 1
        }`
      )
    })
  })

  test('Deserialization with Large Data Set', () => {
    const data = {
      cycle: 8,
      accounts: [
        { accountID: 'acc8', hash: 'hash8' },
        { accountID: ',acc9', hash: 'hash9' },
      ],
    }
    const stream = new VectorBufferStream(0)
    stream.writeUInt8(cGetAccountDataByHashesReqVersion)
    stream.writeBigUInt64(BigInt(data.cycle))
    stream.writeUInt32(data.accounts.length)
    for (let i = 0; i < data.accounts.length; i++) {
      stream.writeString(data.accounts[i].accountID)
      stream.writeString(data.accounts[i].hash)
    }
    stream.position = 0
    const result = deserializeGetAccountDataByHashesReq(stream)
    expect(result).toEqual(data)
  })

  test('Round-Trip Serialization and Deserialization', () => {
    const data = {
      cycle: 9,
      accounts: [
        { accountID: 'acc9', hash: 'hash9' },
        { accountID: 'acc10', hash: 'hash10' },
      ],
    }
    const stream = new VectorBufferStream(0)
    serializeGetAccountDataByHashesReq(stream, data, false)
    stream.position = 0
    const deserialized = deserializeGetAccountDataByHashesReq(stream)
    expect(deserialized).toEqual(data)
  })
})
