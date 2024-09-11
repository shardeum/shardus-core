import { VectorBufferStream } from '../../../../src/utils/serialization/VectorBufferStream'
import {
  serializeCompareCertReq,
  deserializeCompareCertReq,
  cCompareCertReqVersion,
} from '../../../../src/types/CompareCertReq'
import { initCompareCertReq } from '../../../../src/types/ajv/CompareCert'
import { TypeIdentifierEnum } from '../../../../src/types/enum/TypeIdentifierEnum'
import { Utils } from '@shardus/types'
import { verifyPayload } from '../../../../src/types/ajv/Helpers'
import { AJVSchemaEnum } from '../../../../src/types/enum/AJVSchemaEnum'

/*
Note: Since both CompareCertReq and CompareCertResp have similar types, 
      there is a common AJV schema for both. Hence, a single test file is sufficient to 
      test the serialization and deserialization of both CompareCertReq and CompareCertResp.
*/

describe('CompareCert Serialization and Deserialization', () => {
  beforeAll(() => {
    initCompareCertReq()
  })

  const validPayload = {
    certs: [{ marker: 'marker1', score: 10, sign: { owner: 'owner1', sig: 'signature1' } }],
    record: {
      networkId: 'network1',
      counter: 1,
      previous: 'prev',
      start: 123,
      duration: 456,
      networkConfigHash: 'hash',
      mode: 'processing' as
        | 'forming'
        | 'processing'
        | 'safety'
        | 'recovery'
        | 'restart'
        | 'restore'
        | 'shutdown',
      safetyMode: true,
      safetyNum: 2,
      networkStateHash: 'stateHash',
      refreshedArchivers: [],
      refreshedConsensors: [],
      joinedArchivers: [],
      leavingArchivers: [],
      archiversAtShutdown: [],
      syncing: 0,
      joinedConsensors: [],
      active: 1,
      standby: 1,
      activated: [],
      activatedPublicKeys: [],
      maxSyncTime: 100,
      apoptosized: [],
      lost: [],
      lostSyncing: [],
      refuted: [],
      appRemoved: [],
      expired: 0,
      removed: [],
      nodeListHash: 'nodeHash',
      archiverListHash: 'archiverHash',
      standbyNodeListHash: 'standbyHash',
      random: 0,
      joined: [],
      returned: [],
      networkDataHash: [{ hash: 'hash', cycle: 1 }],
      networkReceiptHash: [{ hash: 'receiptHash', cycle: 1 }],
      networkSummaryHash: [{ hash: 'summaryHash', cycle: 1 }],
      desired: 1,
      target: 1,
      lostArchivers: [],
      refutedArchivers: [],
      removedArchivers: [],
    },
  }

  test('Serialize valid data with root true', () => {
    const stream = new VectorBufferStream(0)
    serializeCompareCertReq(stream, validPayload, true)
    const expectedStream = new VectorBufferStream(0)
    expectedStream.writeUInt16(TypeIdentifierEnum.cCompareCertReq)
    expectedStream.writeUInt8(cCompareCertReqVersion)
    expectedStream.writeString(Utils.safeStringify(validPayload))
    expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
  })

  test('Serialize valid data with root false', () => {
    const stream = new VectorBufferStream(0)
    serializeCompareCertReq(stream, validPayload, false)
    const expectedStream = new VectorBufferStream(0)
    expectedStream.writeUInt8(cCompareCertReqVersion)
    expectedStream.writeString(Utils.safeStringify(validPayload))
    expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
  })

  test('Deserialize valid data', () => {
    const stream = new VectorBufferStream(0)
    stream.writeUInt8(cCompareCertReqVersion)
    stream.writeString(Utils.safeStringify(validPayload))
    stream.position = 0
    const result = deserializeCompareCertReq(stream)
    expect(result).toEqual(validPayload)
  })

  test('Deserialize with unsupported version', () => {
    const stream = new VectorBufferStream(0)
    stream.writeUInt8(cCompareCertReqVersion + 1)
    stream.writeString(Utils.safeStringify(validPayload))
    stream.position = 0
    expect(() => deserializeCompareCertReq(stream)).toThrow('Unsupported CompareCertReqSerializable version')
  })

  test('Serialize with empty certs array', () => {
    const payload = { ...validPayload, certs: [] }
    const stream = new VectorBufferStream(0)
    serializeCompareCertReq(stream, payload, false)
    stream.position = 0
    const deserializedObj = deserializeCompareCertReq(stream)
    expect(deserializedObj).toEqual(payload)
  })

  test('Deserialize with corrupted data', () => {
    const stream = new VectorBufferStream(0)
    stream.writeUInt8(cCompareCertReqVersion)
    stream.writeString('corrupted data')
    stream.position = 0
    expect(() => deserializeCompareCertReq(stream)).toThrow()
  })

  test('Serialize and deserialize maintaining data integrity', () => {
    const stream = new VectorBufferStream(0)
    serializeCompareCertReq(stream, validPayload, false)
    stream.position = 0
    const deserializedObj = deserializeCompareCertReq(stream)
    expect(deserializedObj).toEqual(validPayload)
  })

  test('AJV allows additional properties in record', () => {
    const payload = {
      ...validPayload,
      record: { ...validPayload.record, additionalProperty: 'additional' },
    }
    const errors = verifyPayload(AJVSchemaEnum.CompareCertReq, payload)
    expect(errors).toBeNull()
  })
})
