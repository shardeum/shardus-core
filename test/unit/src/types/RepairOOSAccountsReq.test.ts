import {
  serializeRepairOOSAccountsReq,
  RepairOOSAccountsReq,
  cRepairOOSAccountsReqVersion,
  deserializeRepairOOSAccountsReq,
} from '../../../../src/types/RepairOOSAccountsReq'
import { serializeWrappedData } from '../../../../src/types/WrappedData'
import { initAjvSchemas } from '../../../../src/types/ajv/Helpers'
import { TypeIdentifierEnum } from '../../../../src/types/enum/TypeIdentifierEnum'
import { Utils } from '@shardus/types'
import { VectorBufferStream } from '../../../../src/utils/serialization/VectorBufferStream'
import { serializeSignedReceipt } from '../../../../src/types/SignedReceipt'

// Mock the Context module and its nested structure
jest.mock('../../../../src/p2p/Context', () => ({
  setDefaultConfigs: jest.fn(),
  stateManager: {
    app: {
      binarySerializeObject: jest.fn((enumType, data) => Buffer.from(Utils.safeStringify(data), 'utf8')),
      binaryDeserializeObject: jest.fn((enumType, buffer) => Utils.safeJsonParse(buffer.toString('utf8'))),
    },
  },
}))

describe('RepairMissingAccountReq Serialization', () => {
  beforeAll(() => {
    initAjvSchemas()
  })

  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('Should serialize with root true', () => {
    const obj: RepairOOSAccountsReq = {
      repairInstructions: [
        {
          accountID: 'test',
          hash: '1234',
          txId: '1234',
          accountData: {
            accountId: 'acc123',
            stateId: 'state456',
            data: { detail: 'info' },
            timestamp: 123456,
          },
          targetNodeId: 'node1',
          signedReceipt: {
            proposal: {
              txid: 'test',
              applied: true,
              cant_preApply: false,
              accountIDs: ['a', 'b', 'c'],
              beforeStateHashes: ['b1', 'b2', 'b3'],
              afterStateHashes: ['a1', 'a2', 'a3'],
              appReceiptDataHash: 'hash',
            },
            signaturePack: [
              {
                sig: 'sign',
                owner: 'node1',
              },
            ],
            voteOffsets: [5],
            proposalHash: 'hash',
            sign: {
              sig: 'sign',
              owner: 'aggregator',
            },
          },
        },
      ],
    }

    const stream = new VectorBufferStream(0)
    serializeRepairOOSAccountsReq(stream, obj, true)

    const expectedStream = new VectorBufferStream(0)
    expectedStream.writeUInt16(TypeIdentifierEnum.cRepairOOSAccountsReq)
    expectedStream.writeUInt8(cRepairOOSAccountsReqVersion)
    expectedStream.writeUInt32(1) // repairInstructions length
    for (let i = 0; i < obj.repairInstructions.length; i++) {
      // eslint-disable-next-line security/detect-object-injection
      expectedStream.writeString(obj.repairInstructions[i].accountID)
      // eslint-disable-next-line security/detect-object-injection
      expectedStream.writeString(obj.repairInstructions[i].hash)
      // eslint-disable-next-line security/detect-object-injection
      expectedStream.writeString(obj.repairInstructions[i].txId)
      // eslint-disable-next-line security/detect-object-injection
      serializeWrappedData(expectedStream, obj.repairInstructions[i].accountData)
      // eslint-disable-next-line security/detect-object-injection
      expectedStream.writeString(obj.repairInstructions[i].targetNodeId)
      // eslint-disable-next-line security/detect-object-injection
      serializeSignedReceipt(expectedStream, obj.repairInstructions[i].signedReceipt)
    }

    expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
  })

  test('Should serialize with root false', () => {
    const obj: RepairOOSAccountsReq = {
      repairInstructions: [
        {
          accountID: 'test',
          hash: '1234',
          txId: '1234',
          accountData: {
            accountId: 'acc123',
            stateId: 'state456',
            data: { detail: 'info' },
            timestamp: 123456,
            syncData: { detail: 'info' },
          },
          targetNodeId: 'node1',
          signedReceipt: {
            proposal: {
              txid: 'test',
              applied: true,
              cant_preApply: false,
              accountIDs: ['a', 'b', 'c'],
              beforeStateHashes: ['b1', 'b2', 'b3'],
              afterStateHashes: ['a1', 'a2', 'a3'],
              appReceiptDataHash: 'hash',
            },
            signaturePack: [
              {
                sig: 'sign',
                owner: 'node1',
              },
            ],
            voteOffsets: [5],
            proposalHash: 'hash',
            sign: {
              sig: 'sign',
              owner: 'aggregator',
            },
          },
        },
        {
          accountID: 'test',
          hash: '1234',
          txId: '1234',
          accountData: {
            accountId: 'acc123',
            stateId: 'state456',
            data: { detail: 'info' },
            timestamp: 123456,
          },
          targetNodeId: 'node1',
          signedReceipt: {
            proposal: {
              txid: 'test',
              applied: true,
              cant_preApply: false,
              accountIDs: ['a', 'b', 'c'],
              beforeStateHashes: ['b1', 'b2', 'b3'],
              afterStateHashes: ['a1', 'a2', 'a3'],
              appReceiptDataHash: 'hash',
            },
            signaturePack: [
              {
                sig: 'sign',
                owner: 'node1',
              },
            ],
            voteOffsets: [5],
            proposalHash: 'hash',
            sign: {
              sig: 'sign',
              owner: 'aggregator',
            },
          },
        },
      ],
    }

    const stream = new VectorBufferStream(0)
    serializeRepairOOSAccountsReq(stream, obj, false)

    const expectedStream = new VectorBufferStream(0)
    expectedStream.writeUInt8(cRepairOOSAccountsReqVersion)
    expectedStream.writeUInt32(2) // repairInstructions length
    for (let i = 0; i < obj.repairInstructions.length; i++) {
      // eslint-disable-next-line security/detect-object-injection
      expectedStream.writeString(obj.repairInstructions[i].accountID)
      // eslint-disable-next-line security/detect-object-injection
      expectedStream.writeString(obj.repairInstructions[i].hash)
      // eslint-disable-next-line security/detect-object-injection
      expectedStream.writeString(obj.repairInstructions[i].txId)
      // eslint-disable-next-line security/detect-object-injection
      serializeWrappedData(expectedStream, obj.repairInstructions[i].accountData)
      // eslint-disable-next-line security/detect-object-injection
      expectedStream.writeString(obj.repairInstructions[i].targetNodeId)
      // eslint-disable-next-line security/detect-object-injection
      serializeSignedReceipt(expectedStream, obj.repairInstructions[i].signedReceipt)
    }
  })

  test('Should serialize with empty string', () => {
    const obj: RepairOOSAccountsReq = {
      repairInstructions: [
        {
          accountID: '',
          hash: '1234',
          txId: '1234',
          accountData: {
            accountId: 'acc123',
            stateId: 'state456',
            data: { detail: 'info' },
            timestamp: 123456,
            syncData: { detail: 'info' },
          },
          targetNodeId: 'node1',
          signedReceipt: {
            proposal: {
              txid: '',
              applied: true,
              cant_preApply: false,
              accountIDs: ['a', 'b', 'c'],
              beforeStateHashes: ['b1', 'b2', 'b3'],
              afterStateHashes: ['a1', 'a2', 'a3'],
              appReceiptDataHash: 'hash',
            },
            signaturePack: [
              {
                sig: 'sign',
                owner: 'node1',
              },
            ],
            voteOffsets: [5],
            proposalHash: 'hash',
            sign: {
              sig: 'sign',
              owner: 'aggregator',
            },
          },
        },
        {
          accountID: 'test',
          hash: '1234',
          txId: '1234',
          accountData: {
            accountId: 'acc123',
            stateId: 'state456',
            data: { detail: 'info' },
            timestamp: 123456,
          },
          targetNodeId: 'node1',
          signedReceipt: {
            proposal: {
              txid: 'test',
              applied: true,
              cant_preApply: false,
              accountIDs: ['a', 'b', 'c'],
              beforeStateHashes: ['b1', 'b2', 'b3'],
              afterStateHashes: ['a1', 'a2', 'a3'],
              appReceiptDataHash: 'hash',
            },
            signaturePack: [
              {
                sig: 'sign',
                owner: 'node1',
              },
            ],
            voteOffsets: [5],
            proposalHash: 'hash',
            sign: {
              sig: 'sign',
              owner: 'aggregator',
            },
          },
        },
      ],
    }

    const stream = new VectorBufferStream(0)
    serializeRepairOOSAccountsReq(stream, obj, false)

    const expectedStream = new VectorBufferStream(0)
    expectedStream.writeUInt8(cRepairOOSAccountsReqVersion)
    expectedStream.writeUInt32(2) // repairInstructions length
    for (let i = 0; i < obj.repairInstructions.length; i++) {
      // eslint-disable-next-line security/detect-object-injection
      expectedStream.writeString(obj.repairInstructions[i].accountID)
      // eslint-disable-next-line security/detect-object-injection
      expectedStream.writeString(obj.repairInstructions[i].hash)
      // eslint-disable-next-line security/detect-object-injection
      expectedStream.writeString(obj.repairInstructions[i].txId)
      // eslint-disable-next-line security/detect-object-injection
      serializeWrappedData(expectedStream, obj.repairInstructions[i].accountData)
      // eslint-disable-next-line security/detect-object-injection
      expectedStream.writeString(obj.repairInstructions[i].targetNodeId)
      // eslint-disable-next-line security/detect-object-injection
      serializeSignedReceipt(expectedStream, obj.repairInstructions[i].signedReceipt)
    }
  })

  test('Should serialize without final sign', () => {
    const obj: RepairOOSAccountsReq = {
      repairInstructions: [
        {
          accountID: 'test',
          hash: '1234',
          txId: '1234',
          accountData: {
            accountId: 'acc123',
            stateId: 'state456',
            data: { detail: 'info' },
            timestamp: 123456,
            syncData: { detail: 'info' },
          },
          targetNodeId: 'node1',
          signedReceipt: {
            proposal: {
              txid: 'test',
              applied: true,
              cant_preApply: false,
              accountIDs: ['a', 'b', 'c'],
              beforeStateHashes: ['b1', 'b2', 'b3'],
              afterStateHashes: ['a1', 'a2', 'a3'],
              appReceiptDataHash: 'hash',
            },
            signaturePack: [
              {
                sig: 'sign',
                owner: 'node1',
              },
            ],
            voteOffsets: [5],
            proposalHash: 'hash',
          },
        },
        {
          accountID: 'test',
          hash: '1234',
          txId: '1234',
          accountData: {
            accountId: 'acc123',
            stateId: 'state456',
            data: { detail: 'info' },
            timestamp: 123456,
          },
          targetNodeId: 'node1',
          signedReceipt: {
            proposal: {
              txid: 'test',
              applied: true,
              cant_preApply: false,
              accountIDs: ['a', 'b', 'c'],
              beforeStateHashes: ['b1', 'b2', 'b3'],
              afterStateHashes: ['a1', 'a2', 'a3'],
              appReceiptDataHash: 'hash',
            },
            signaturePack: [
              {
                sig: 'sign',
                owner: 'node1',
              },
            ],
            voteOffsets: [5],
            proposalHash: 'hash',
            sign: {
              sig: 'sign',
              owner: 'aggregator',
            },
          },
        },
      ],
    }

    const stream = new VectorBufferStream(0)
    serializeRepairOOSAccountsReq(stream, obj, false)

    const expectedStream = new VectorBufferStream(0)
    expectedStream.writeUInt8(cRepairOOSAccountsReqVersion)
    expectedStream.writeUInt32(2) // repairInstructions length
    for (let i = 0; i < obj.repairInstructions.length; i++) {
      // eslint-disable-next-line security/detect-object-injection
      expectedStream.writeString(obj.repairInstructions[i].accountID)
      // eslint-disable-next-line security/detect-object-injection
      expectedStream.writeString(obj.repairInstructions[i].hash)
      // eslint-disable-next-line security/detect-object-injection
      expectedStream.writeString(obj.repairInstructions[i].txId)
      // eslint-disable-next-line security/detect-object-injection
      serializeWrappedData(expectedStream, obj.repairInstructions[i].accountData)
      // eslint-disable-next-line security/detect-object-injection
      expectedStream.writeString(obj.repairInstructions[i].targetNodeId)
      // eslint-disable-next-line security/detect-object-injection
      serializeSignedReceipt(expectedStream, obj.repairInstructions[i].signedReceipt)
    }

    expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
  })
})

describe('RepairMissingAccountReq Deserialization', () => {
  test('Should deserialize successfully', () => {
    const data: RepairOOSAccountsReq = {
      repairInstructions: [
        {
          accountID: 'test',
          hash: '1234',
          txId: '1234',
          accountData: {
            accountId: 'acc123',
            stateId: 'state456',
            data: { detail: 'info' },
            timestamp: 123456,
            syncData: { detail: 'info' },
          },
          targetNodeId: 'node1',
          signedReceipt: {
            proposal: {
              txid: 'test',
              applied: true,
              cant_preApply: false,
              accountIDs: ['a', 'b', 'c'],
              beforeStateHashes: ['b1', 'b2', 'b3'],
              afterStateHashes: ['a1', 'a2', 'a3'],
              appReceiptDataHash: 'hash',
            },
            signaturePack: [
              {
                sig: 'sign',
                owner: 'node1',
              },
            ],
            voteOffsets: [5],
            proposalHash: 'hash',
            sign: {
              sig: 'sign',
              owner: 'aggregator',
            },
          },
        },
      ],
    }
    const stream = new VectorBufferStream(0)
    stream.writeUInt8(cRepairOOSAccountsReqVersion)
    stream.writeUInt32(1) // repairInstructions length
    stream.writeString(data.repairInstructions[0].accountID) // accountID
    stream.writeString(data.repairInstructions[0].hash) // hash
    stream.writeString(data.repairInstructions[0].txId) // txId
    serializeWrappedData(stream, data.repairInstructions[0].accountData) // accountData
    stream.writeString(data.repairInstructions[0].targetNodeId) // targetNodeId
    serializeSignedReceipt(stream, data.repairInstructions[0].signedReceipt) // receipt2
    stream.position = 0

    const obj = deserializeRepairOOSAccountsReq(stream)
    expect(obj).toEqual(data)
  })

  test('Should deserialize successfully with missing sign', () => {
    const data: RepairOOSAccountsReq = {
      repairInstructions: [
        {
          accountID: 'test',
          hash: '1234',
          txId: '1234',
          accountData: {
            accountId: 'acc123',
            stateId: 'state456',
            data: { detail: 'info' },
            timestamp: 123456,
            syncData: { detail: 'info' },
          },
          targetNodeId: 'node1',
          signedReceipt: {
            proposal: {
              txid: 'test',
              applied: true,
              cant_preApply: false,
              accountIDs: ['a', 'b', 'c'],
              beforeStateHashes: ['b1', 'b2', 'b3'],
              afterStateHashes: ['a1', 'a2', 'a3'],
              appReceiptDataHash: 'hash',
            },
            signaturePack: [
              {
                sig: 'sign',
                owner: 'node1',
              },
            ],
            voteOffsets: [5],
            proposalHash: 'hash',
          },
        },
        {
          accountID: 'test',
          hash: '1234',
          txId: '1234',
          accountData: {
            accountId: 'acc123',
            stateId: 'state456',
            data: { detail: 'info' },
            timestamp: 123456,
          },
          targetNodeId: 'node1',
          signedReceipt: {
            proposal: {
              txid: 'test',
              applied: true,
              cant_preApply: false,
              accountIDs: ['a', 'b', 'c'],
              beforeStateHashes: ['b1', 'b2', 'b3'],
              afterStateHashes: ['a1', 'a2', 'a3'],
              appReceiptDataHash: 'hash',
            },
            signaturePack: [
              {
                sig: 'sign',
                owner: 'node1',
              },
            ],
            voteOffsets: [5],
            proposalHash: 'hash',
            sign: {
              sig: 'sign',
              owner: 'aggregator',
            },
          },
        },
      ],
    }
    const stream = new VectorBufferStream(0)
    stream.writeUInt8(cRepairOOSAccountsReqVersion)
    stream.writeUInt32(2) // repairInstructions length
    stream.writeString(data.repairInstructions[0].accountID) // accountID
    stream.writeString(data.repairInstructions[0].hash) // hash
    stream.writeString(data.repairInstructions[0].txId) // txId
    serializeWrappedData(stream, data.repairInstructions[0].accountData) // accountData
    stream.writeString(data.repairInstructions[0].targetNodeId) // targetNodeId
    serializeSignedReceipt(stream, data.repairInstructions[0].signedReceipt) // receipt2
    stream.writeString(data.repairInstructions[1].accountID) // accountID
    stream.writeString(data.repairInstructions[1].hash) // hash
    stream.writeString(data.repairInstructions[1].txId) // txId
    serializeWrappedData(stream, data.repairInstructions[1].accountData) // accountData
    stream.writeString(data.repairInstructions[1].targetNodeId) // targetNodeId
    serializeSignedReceipt(stream, data.repairInstructions[1].signedReceipt) // receipt2
    stream.position = 0

    const obj = deserializeRepairOOSAccountsReq(stream)
    expect(obj).toEqual(data)
  })
})
