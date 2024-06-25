import { Utils } from '@shardus/types'
import { VectorBufferStream } from '../../../../src'
import { AJV_IDENT, initAjvSchemas, verifyPayload } from '../../../../src/types/ajv/Helpers'
import { TypeIdentifierEnum } from '../../../../src/types/enum/TypeIdentifierEnum'
import {
  deserializeGetAppliedVoteReq,
  serializeGetAppliedVoteReq,
} from '../../../../src/types/GetAppliedVoteReq'
import {
  deserializeGetAppliedVoteResp,
  GetAppliedVoteResp,
  serializeGetAppliedVoteResp,
} from '../../../../src/types/GetAppliedVoteResp'
jest.mock('../../../../src/p2p/Context', () => ({
  setDefaultConfigs: jest.fn(),
  stateManager: {
    app: {
      binarySerializeObject: jest.fn((enumType, data) => Buffer.from(Utils.safeStringify(data), 'utf8')),
      binaryDeserializeObject: jest.fn((enumType, buffer) => Utils.safeJsonParse(buffer.toString('utf8'))),
    },
  },
}))

describe('RequestStateForTx Serialization', () => {
  beforeAll(() => {
    initAjvSchemas()
  })

  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('Should serialize/desrialize with root true', () => {
    const req_stream = new VectorBufferStream(0)
    const req_payload = {
      txId: 'txid',
    }
    serializeGetAppliedVoteReq(req_stream, req_payload, true)
    // we'll read , so reset the position
    req_stream.position = 0
    expect(req_stream.readUInt16()).toEqual(TypeIdentifierEnum.cGetAppliedVoteReq)
    expect(deserializeGetAppliedVoteReq(req_stream)).toEqual(req_payload)

    const resp_payload: GetAppliedVoteResp = {
      txId: 'txid',
      appliedVote: {
        txid: 'txid',
        transaction_result: false,
        account_id: ['account_id'],
        account_state_hash_after: ['account_state_hash_after'],
        account_state_hash_before: ['account_state_hash_before'],
        cant_apply: false,
        node_id: 'node_id',
      },
      appliedVoteHash: 'appliedVoteHash',
    }

    const resp_stream = new VectorBufferStream(0)
    serializeGetAppliedVoteResp(resp_stream, resp_payload, true)
    // we'll read , so reset the position
    resp_stream.position = 0
    expect(resp_stream.readUInt16()).toEqual(TypeIdentifierEnum.cGetAppliedVoteResp)
    expect(deserializeGetAppliedVoteResp(resp_stream)).toEqual(resp_payload)
  })

  test('Should serialize/desrialize with root false', () => {
    const req_stream = new VectorBufferStream(0)
    const req_payload = {
      txId: 'txid',
    }
    serializeGetAppliedVoteReq(req_stream, req_payload, false)
    // we'll read , so reset the position
    req_stream.position = 0
    expect(deserializeGetAppliedVoteReq(req_stream)).toEqual(req_payload)

    const resp_payload: GetAppliedVoteResp = {
      txId: 'txid',
      appliedVote: {
        txid: 'txid',
        transaction_result: false,
        account_id: ['account_id'],
        account_state_hash_after: ['account_state_hash_after'],
        account_state_hash_before: ['account_state_hash_before'],
        cant_apply: false,
        node_id: 'node_id',
      },
      appliedVoteHash: 'appliedVoteHash',
    }

    const resp_stream = new VectorBufferStream(0)
    serializeGetAppliedVoteResp(resp_stream, resp_payload, false)
    // we'll read , so reset the position
    resp_stream.position = 0
    expect(deserializeGetAppliedVoteResp(resp_stream)).toEqual(resp_payload)
  })

  test('Should return errors on AJV fails', () => {
    const req_payload = {
      txId: ['txid'],
    }

    const errors = verifyPayload(AJV_IDENT.GET_APPLIED_VOTE_REQ, req_payload)
    expect(errors).toBeInstanceOf(Array)

    const resp_payload = {
      txId: 'txid',
      appliedVote: {
        txid: 'txid',
        transaction_result: false,
        account_id: 'account_id',
        account_state_hash_after: ['account_state_hash_after'],
        account_state_hash_before: ['account_state_hash_before'],
        cant_apply: false,
        node_id: 'node_id',
      },
      appliedVoteHash: 'appliedVoteHash',
    }

    const errors2 = verifyPayload(AJV_IDENT.GET_APPLIED_VOTE_RESP, resp_payload)
    expect(errors2).toBeInstanceOf(Array)
  })

  test('Should not return errors on AJV passes', () => {
    const req_payload = {
      txId: 'txid',
    }

    const errors = verifyPayload(AJV_IDENT.GET_APPLIED_VOTE_REQ, req_payload)
    expect(errors).toBeFalsy()

    const resp_payload = {
      txId: 'txid',
      appliedVote: {
        txid: 'txid',
        transaction_result: false,
        account_id: ['account_id'],
        account_state_hash_after: ['account_state_hash_after'],
        account_state_hash_before: ['account_state_hash_before'],
        cant_apply: false,
        node_id: 'node_id',
      },
      appliedVoteHash: 'appliedVoteHash',
    }

    const errors2 = verifyPayload(AJV_IDENT.GET_APPLIED_VOTE_RESP, resp_payload)
    expect(errors2).toBeFalsy()
  })
})
