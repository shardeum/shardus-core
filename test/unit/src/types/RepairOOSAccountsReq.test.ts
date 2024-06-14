import { serializeAppliedReceipt2 } from '../../../../src/types/AppliedReceipt2'
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
          receipt2: {
            txid: 'test',
            result: true,
            appliedVote: {
              txid: 'txid',
              transaction_result: true,
              account_id: ['acc123'],
              account_state_hash_after: ['state123'],
              account_state_hash_before: ['state123'],
              cant_apply: false,
              node_id: 'node1',
            },
            confirmOrChallenge: {
              message: 'message',
              nodeId: 'node1',
              appliedVote: {
                txid: 'txid',
                transaction_result: true,
                account_id: ['acc123'],
                account_state_hash_after: ['state123'],
                account_state_hash_before: ['state123'],
                cant_apply: false,
                node_id: 'node1',
              },
              sign: {
                sig: 'sign',
                owner: 'node1',
              },
            },
            signatures: [
              {
                sig: 'sign',
                owner: 'node1',
              },
            ],
            app_data_hash: 'hash',
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
      serializeAppliedReceipt2(expectedStream, obj.repairInstructions[i].receipt2)
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
          receipt2: {
            txid: 'test',
            result: true,
            appliedVote: {
              txid: 'txid',
              transaction_result: true,
              account_id: ['acc123'],
              account_state_hash_after: ['state123'],
              account_state_hash_before: ['state123'],
              cant_apply: false,
              node_id: 'node1',
            },
            confirmOrChallenge: {
              message: 'message',
              nodeId: 'node1',
              appliedVote: {
                txid: 'txid',
                transaction_result: true,
                account_id: ['acc123'],
                account_state_hash_after: ['state123'],
                account_state_hash_before: ['state123'],
                cant_apply: false,
                node_id: 'node1',
              },
              sign: {
                sig: 'sign',
                owner: 'node1',
              },
            },
            signatures: [
              {
                sig: 'sign',
                owner: 'node1',
              },
            ],
            app_data_hash: 'hash',
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
          receipt2: {
            txid: 'test',
            result: true,
            appliedVote: {
              txid: 'txid',
              transaction_result: true,
              account_id: ['acc123'],
              account_state_hash_after: ['state123'],
              account_state_hash_before: ['state123'],
              cant_apply: false,
              node_id: 'node1',
            },
            confirmOrChallenge: {
              message: 'message',
              nodeId: 'node1',
              appliedVote: {
                txid: 'txid',
                transaction_result: true,
                account_id: ['acc123'],
                account_state_hash_after: ['state123'],
                account_state_hash_before: ['state123'],
                cant_apply: false,
                node_id: 'node1',
              },
              sign: {
                sig: 'sign',
                owner: 'node1',
              },
            },
            signatures: [
              {
                sig: 'sign',
                owner: 'node1',
              },
            ],
            app_data_hash: 'hash',
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
      serializeAppliedReceipt2(expectedStream, obj.repairInstructions[i].receipt2)
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
          receipt2: {
            txid: '',
            result: true,
            appliedVote: {
              txid: 'txid',
              transaction_result: true,
              account_id: ['acc123'],
              account_state_hash_after: ['state123'],
              account_state_hash_before: ['state123'],
              cant_apply: false,
              node_id: 'node1',
            },
            confirmOrChallenge: {
              message: 'message',
              nodeId: 'node1',
              appliedVote: {
                txid: 'txid',
                transaction_result: true,
                account_id: ['acc123'],
                account_state_hash_after: ['state123'],
                account_state_hash_before: ['state123'],
                cant_apply: false,
                node_id: 'node1',
              },
              sign: {
                sig: 'sign',
                owner: 'node1',
              },
            },
            signatures: [
              {
                sig: 'sign',
                owner: 'node1',
              },
            ],
            app_data_hash: 'hash',
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
          receipt2: {
            txid: 'test',
            result: true,
            appliedVote: {
              txid: 'txid',
              transaction_result: true,
              account_id: ['acc123'],
              account_state_hash_after: ['state123'],
              account_state_hash_before: ['state123'],
              cant_apply: false,
              node_id: 'node1',
            },
            confirmOrChallenge: {
              message: 'message',
              nodeId: 'node1',
              appliedVote: {
                txid: 'txid',
                transaction_result: true,
                account_id: ['acc123'],
                account_state_hash_after: ['state123'],
                account_state_hash_before: ['state123'],
                cant_apply: false,
                node_id: 'node1',
              },
              sign: {
                sig: 'sign',
                owner: 'node1',
              },
            },
            signatures: [
              {
                sig: 'sign',
                owner: 'node1',
              },
            ],
            app_data_hash: 'hash',
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
      serializeAppliedReceipt2(expectedStream, obj.repairInstructions[i].receipt2)
    }
  })

  test('Should serialize without confirmOrChallenge', () => {
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
          receipt2: {
            txid: 'test',
            result: true,
            appliedVote: {
              txid: 'txid',
              transaction_result: true,
              account_id: ['acc123'],
              account_state_hash_after: ['state123'],
              account_state_hash_before: ['state123'],
              cant_apply: false,
              node_id: 'node1',
            },
            signatures: [
              {
                sig: 'sign',
                owner: 'node1',
              },
            ],
            app_data_hash: 'hash',
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
          receipt2: {
            txid: 'test',
            result: true,
            appliedVote: {
              txid: 'txid',
              transaction_result: true,
              account_id: ['acc123'],
              account_state_hash_after: ['state123'],
              account_state_hash_before: ['state123'],
              cant_apply: false,
              node_id: 'node1',
            },
            confirmOrChallenge: undefined,
            signatures: [
              {
                sig: 'sign',
                owner: 'node1',
              },
            ],
            app_data_hash: 'hash',
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
      serializeAppliedReceipt2(expectedStream, obj.repairInstructions[i].receipt2)
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
          receipt2: {
            txid: '',
            result: true,
            appliedVote: {
              txid: 'txid',
              transaction_result: true,
              account_id: ['acc123'],
              account_state_hash_after: ['state123'],
              account_state_hash_before: ['state123'],
              cant_apply: false,
              node_id: 'node1',
            },
            confirmOrChallenge: {
              message: 'message',
              nodeId: 'node1',
              appliedVote: {
                txid: 'txid',
                transaction_result: true,
                account_id: ['acc123'],
                account_state_hash_after: ['state123'],
                account_state_hash_before: ['state123'],
                cant_apply: false,
                node_id: 'node1',
              },
              sign: {
                sig: 'sign',
                owner: 'node1',
              },
            },
            signatures: [
              {
                sig: 'sign',
                owner: 'node1',
              },
            ],
            app_data_hash: 'hash',
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
    serializeAppliedReceipt2(stream, data.repairInstructions[0].receipt2) // receipt2
    stream.position = 0

    const obj = deserializeRepairOOSAccountsReq(stream)
    expect(obj).toEqual(data)
  })

  test('Should deserialize successfully with missing confirmOrChallenge', () => {
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
          receipt2: {
            txid: 'test',
            result: true,
            appliedVote: {
              txid: 'txid',
              transaction_result: true,
              account_id: ['acc123'],
              account_state_hash_after: ['state123'],
              account_state_hash_before: ['state123'],
              cant_apply: false,
              node_id: 'node1',
            },
            signatures: [
              {
                sig: 'sign',
                owner: 'node1',
              },
            ],
            app_data_hash: 'hash',
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
          receipt2: {
            txid: 'test',
            result: true,
            appliedVote: {
              txid: 'txid',
              transaction_result: true,
              account_id: ['acc123'],
              account_state_hash_after: ['state123'],
              account_state_hash_before: ['state123'],
              cant_apply: false,
              node_id: 'node1',
            },
            confirmOrChallenge: undefined,
            signatures: [
              {
                sig: 'sign',
                owner: 'node1',
              },
            ],
            app_data_hash: 'hash',
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
    serializeAppliedReceipt2(stream, data.repairInstructions[0].receipt2) // receipt2
    stream.writeString(data.repairInstructions[1].accountID) // accountID
    stream.writeString(data.repairInstructions[1].hash) // hash
    stream.writeString(data.repairInstructions[1].txId) // txId
    serializeWrappedData(stream, data.repairInstructions[1].accountData) // accountData
    stream.writeString(data.repairInstructions[1].targetNodeId) // targetNodeId
    serializeAppliedReceipt2(stream, data.repairInstructions[1].receipt2) // receipt2
    stream.position = 0

    const obj = deserializeRepairOOSAccountsReq(stream)
    expect(obj).toEqual(data)
  })
})
