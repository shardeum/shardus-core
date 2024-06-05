import { VectorBufferStream } from '../../../../src'
import { AppliedReceipt2 } from '../../../../src/state-manager/state-manager-types'
import { cAppliedReceipt2Version, serializeAppliedReceipt2 } from '../../../../src/types/AppliedReceipt2'
import { serializeAppliedVote } from '../../../../src/types/AppliedVote'
import { serializeConfirmOrChallengeMessage } from '../../../../src/types/ConfirmOrChallengeMessage'
import { cSignVersion } from '../../../../src/types/Sign'
import { TypeIdentifierEnum } from '../../../../src/types/enum/TypeIdentifierEnum'

describe('AppliedReceipt2 Serialization', () => {
  test('Should serialization with root true', () => {
    const obj: AppliedReceipt2 = {
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
    }
    const stream = new VectorBufferStream(0)
    serializeAppliedReceipt2(stream, obj, true)

    const expectedStream = new VectorBufferStream(0)
    expectedStream.writeUInt16(TypeIdentifierEnum.cAppliedReceipt2)
    expectedStream.writeUInt8(cAppliedReceipt2Version)
    expectedStream.writeString(obj.txid) // txid
    expectedStream.writeUInt8(1) // transaction_result
    serializeAppliedVote(expectedStream, obj.appliedVote) // appliedVote
    serializeConfirmOrChallengeMessage(expectedStream, obj.confirmOrChallenge) // confirmOrChallenge
    expectedStream.writeUInt16(obj.signatures.length)
    expectedStream.writeUInt8(cSignVersion)
    expectedStream.writeString(obj.signatures[0].owner)
    expectedStream.writeString(obj.signatures[0].sig)
    expectedStream.writeString(obj.app_data_hash)

    expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
  })

  test('Should serialization with root false', () => {
    const obj: AppliedReceipt2 = {
      txid: 'test',
      result: false,
      appliedVote: {
        txid: 'txid',
        transaction_result: true,
        account_id: ['acc123'],
        account_state_hash_after: ['state123'],
        account_state_hash_before: ['state123'],
        cant_apply: false,
        node_id: 'node1',
        sign: {
          sig: 'sign',
          owner: 'node1',
        },
        app_data_hash: 'hash',
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
          sign: {
            sig: 'sign',
            owner: 'node1',
          },
        },
      },
      signatures: [
        {
          sig: 'sign',
          owner: 'node1',
        },
        {
          sig: 'sign2',
          owner: 'node2',
        },
      ],
      app_data_hash: 'hash',
    }
    const stream = new VectorBufferStream(0)
    serializeAppliedReceipt2(stream, obj, false)

    const expectedStream = new VectorBufferStream(0)
    expectedStream.writeUInt8(cAppliedReceipt2Version)
    expectedStream.writeString(obj.txid) // txid
    expectedStream.writeUInt8(0) // transaction_result
    serializeAppliedVote(expectedStream, obj.appliedVote) // appliedVote
    serializeConfirmOrChallengeMessage(expectedStream, obj.confirmOrChallenge) // confirmOrChallenge
    expectedStream.writeUInt16(obj.signatures.length)
    expectedStream.writeUInt8(cSignVersion)
    expectedStream.writeString(obj.signatures[0].owner)
    expectedStream.writeString(obj.signatures[0].sig)
    expectedStream.writeUInt8(cSignVersion)
    expectedStream.writeString(obj.signatures[1].owner)
    expectedStream.writeString(obj.signatures[1].sig)
    expectedStream.writeString(obj.app_data_hash)

    expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
  })
})
