/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { VectorBufferStream } from '../../../../src/utils/serialization/VectorBufferStream'
import { DeSerializeFromJsonString, SerializeToJsonString } from '../../../../src/utils'

// Function to JSON serialize
export function jsonSerialize(stream: VectorBufferStream, item: any) {
  const json = SerializeToJsonString(item)
  const buffer = Buffer.from(json, 'utf8')
  stream.writeBuffer(buffer)
}

// Function to JSON deserialize
export function jsonDeserialize(stream: VectorBufferStream) {
  const jsonBuffer = stream.readBuffer()
  const json = jsonBuffer.toString('utf8')
  console.log("The json here after toString is ", json) // it is correct at this step. 
  /*
  {
  "accountData": [
    {
      "accountId": "acc123",
      "data": {
        "detail": "info"
      },
      "seenInQueue": true,
      "stateId": "state456",
      "syncData": {
        "cycleDataName": "initialSync",
        "hash": "abc",
        "id": 1
      },
      "timestamp": 123456
    },
    {
      "accountId": "acc789",
      "data": {
        "detail": "moreInfo"
      },
      "seenInQueue": false,
      "stateId": "state101112",
      "syncData": {
        "cycleDataName": "secondarySync",
        "hash": "def",
        "id": 2
      },
      "timestamp": 654321
    }
  ]
}
  */
  return DeSerializeFromJsonString(json)
}

describe('JSON Serialization and Deserialization Edge Cases', () => {
//   test('should handle null values correctly during serialization and deserialization', () => {
//     const item = {
//       accountId: null,
//       stateId: null,
//       data: null,
//     }
//     const stream = new VectorBufferStream(0)
//     jsonSerialize(stream, item)
//     stream.position = 0
//     const deserializedItem = jsonDeserialize(stream)
//     expect(deserializedItem).toEqual(item)
//   })

//   test('should process large objects efficiently', () => {
//     const largeObject = {
//       data: new Array(10).fill({ info: 'Repeat' }),
//     }
//     const stream = new VectorBufferStream(0)
//     jsonSerialize(stream, largeObject)
//     stream.position = 0
//     const deserializedItem = jsonDeserialize(stream)
//     expect(deserializedItem).toEqual(largeObject)
//   })

  const originalObj = {
    accountData: [
      {
        accountId: 'acc123',
        stateId: 'state456',
        data: { detail: 'info' },
        timestamp: 123456,
        seenInQueue: true,
        syncData: { id: 1, hash: 'abc', cycleDataName: 'initialSync' },
      },
      {
        accountId: 'acc789',
        stateId: 'state101112',
        data: { detail: 'moreInfo' },
        timestamp: 654321,
        seenInQueue: false,
        syncData: { id: 2, hash: 'def', cycleDataName: 'secondarySync' },
      },
    ],
  }

  test('A is equal to A*', () => {

    const expectedJson = SerializeToJsonString(originalObj)
    const newJson = DeSerializeFromJsonString(expectedJson)

    expect(newJson).toEqual(originalObj)
  })

  test('should deserialize a buffer to an object', () => {
    const json = SerializeToJsonString(originalObj)
    const buffer = Buffer.from(json, 'utf8')
    const stream = new VectorBufferStream(buffer.length)
    stream.writeBuffer(buffer)
    stream.position = 0 // Reset position for reading

    const deserializedItem = jsonDeserialize(stream)

    expect(deserializedItem).toEqual(originalObj)
  })

  test('should correctly serialize and then deserialize the object, maintaining data integrity', () => {
    const stream = new VectorBufferStream(0)

    jsonSerialize(stream, originalObj)

    stream.position = 0 // Reset the stream position to zero before reading

    const deserializedObj = jsonDeserialize(stream)

    expect(deserializedObj).toEqual(originalObj)
  })
})
