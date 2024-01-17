/* eslint-disable @typescript-eslint/no-unused-vars */
import { BroadcastStateReq, serializeBroadcastStateReq } from '../../src/types/BroadcastStateReq'
import { WrappedData } from '../../src/types/WrappedData'
import { VectorBufferStream } from '../../src/utils/serialization/VectorBufferStream'

const resLength: number[] = []

const newBroadcastStateReq = (stateCount: number): BroadcastStateReq => {
  const wrappedData: WrappedData = {
    accountCreated: true,
    isPartial: true,
    accountId: 'f'.repeat(64),
    stateId: 'f'.repeat(64),
    data: Buffer.from('f'.repeat(200), 'hex'),
    timestamp: 1234567890,
  }
  const broadcastStateReq: BroadcastStateReq = {
    txid: 'txid',
    stateList: [],
  }
  for (let i = 0; i < stateCount; i++) {
    broadcastStateReq.stateList.push(wrappedData)
  }
  return broadcastStateReq
}

const testVectorBufferStreamWithMultipleAlloc = (): void => {
  const durations: number[] = []
  const iterations = 1000

  for (let i = 0; i < iterations; i++) {
    const broadcastStateReq = newBroadcastStateReq(i)

    const startTime = performance.now()
    const stream = new VectorBufferStream(0)
    serializeBroadcastStateReq(stream, broadcastStateReq, true)
    const endTime = performance.now()
    resLength.push(stream.getBufferLength())

    durations.push(endTime - startTime)
  }

  const stats = calculateStats(durations)
  console.log(`\tmin: ${stats.min} ms`)
  console.log(`\tmax: ${stats.max} ms`)
  console.log(`\tavg: ${stats.avg} ms`)
  console.log(`\ttotal: ${stats.total} ms`)
}

const testVectorBufferStreamWithReducedAlloc = (): void => {
  const durations: number[] = []
  const durationsForEstimate: number[] = []
  const durationsForSerialize: number[] = []
  const iterations = 1000

  for (let i = 0; i < iterations; i++) {
    const broadcastStateReq = newBroadcastStateReq(i)

    const startTime = performance.now()
    const est = estimateBinarySizeOfObject3(broadcastStateReq)
    const estEndTime = performance.now()
    durationsForEstimate.push(estEndTime - startTime)

    const stream = new VectorBufferStream(est)
    serializeBroadcastStateReq(stream, broadcastStateReq, true)
    const endTime = performance.now()

    durationsForSerialize.push(endTime - estEndTime)
    durations.push(endTime - startTime)
  }

  const stats = calculateStats(durations)
  console.log(`\tmin: ${stats.min} ms`)
  console.log(`\tmax: ${stats.max} ms`)
  console.log(`\tavg: ${stats.avg} ms`)
  console.log(`\ttotal: ${stats.total} ms`)

  const statsForEstimate = calculateStats(durationsForEstimate)
  console.log(`\testimate min: ${statsForEstimate.min} ms`)
  console.log(`\testimate max: ${statsForEstimate.max} ms`)
  console.log(`\testimate avg: ${statsForEstimate.avg} ms`)
  console.log(`\testimate total: ${statsForEstimate.total} ms`)

  const statsForSerialize = calculateStats(durationsForSerialize)
  console.log(`\tserialize min: ${statsForSerialize.min} ms`)
  console.log(`\tserialize max: ${statsForSerialize.max} ms`)
  console.log(`\tserialize avg: ${statsForSerialize.avg} ms`)
  console.log(`\tserialize total: ${statsForSerialize.total} ms`)
}

const testVectorBufferStreamWithExactAlloc = (): void => {
  const durations: number[] = []
  const iterations = 1000

  for (let i = 0; i < iterations; i++) {
    const broadcastStateReq = newBroadcastStateReq(i)
    const size = resLength.at(i)
    if (!size) {
      throw new Error(`size is undefined at i=${i}`)
    }

    const startTime = performance.now()
    const stream = new VectorBufferStream(size)
    serializeBroadcastStateReq(stream, broadcastStateReq, true)
    const endTime = performance.now()

    durations.push(endTime - startTime)
  }

  const stats = calculateStats(durations)
  console.log(`\tmin: ${stats.min} ms`)
  console.log(`\tmax: ${stats.max} ms`)
  console.log(`\tavg: ${stats.avg} ms`)
  console.log(`\ttotal: ${stats.total} ms`)
}

const testCorrectness = (): void => {
  for (let i = 0; i < 1000; i++) {
    const broadcastStateReq = newBroadcastStateReq(i)
    const stream = new VectorBufferStream(0)
    serializeBroadcastStateReq(stream, broadcastStateReq, true)
    const buffer = stream.getBuffer()
    const stream2 = new VectorBufferStream(estimateBinarySizeOfObject3(broadcastStateReq))
    serializeBroadcastStateReq(stream2, broadcastStateReq, true)
    const buffer2 = stream2.getBuffer()
    if (!buffer.equals(buffer2)) {
      console.log(`testCorrectness failed at i=${i}`)
      console.log(`buffer: ${buffer.toString('hex')}`)
      console.log(`buffer2: ${buffer2.toString('hex')}`)
      break
    }
  }
  console.log('testCorrectness passed')
}

function calculateStats(durations: number[]): { min: number; max: number; avg: number; total: number } {
  const min = Math.min(...durations)
  const max = Math.max(...durations)
  const avg = durations.reduce((a, b) => a + b, 0) / durations.length
  const total = durations.reduce((a, b) => a + b, 0)
  return { min, max, avg, total }
}

function estimateBinarySizeOfObject(
  obj,
  opts?: {
    customSizeForNumber?: number
    customSizeForString?: number
    customSizeForObject?: number
  }
): number {
  const sizes: { [key: string]: number } = {
    number: 8,
    boolean: 1,
    string: 64,
    object: 100,
  }
  if (opts?.customSizeForNumber) {
    sizes.number = opts.customSizeForNumber
  }
  if (opts?.customSizeForString) {
    sizes.string = opts.customSizeForString
  }
  if (opts?.customSizeForObject) {
    sizes.object = opts.customSizeForObject
  }

  const calculateSize = (item): number => {
    const type = typeof item
    if (type in sizes) {
      // eslint-disable-next-line security/detect-object-injection
      return sizes[type]
    } else if (Array.isArray(item)) {
      if (item.length === 0) {
        return 0
      }
      return item.length * calculateSize(item[0])
    }
    return 0
  }
  return calculateSize(obj)
}

function estimateBinarySizeOfObject2(obj): number {
  const sizes = {
    number: 8, // assuming a number is serialized as a double (8 bytes)
    boolean: 1,
    string: (str: string) => 2 + Buffer.byteLength(str, 'utf8'), // 2 bytes for length + string bytes
  }

  const calculateSize = (item): number => {
    const type = typeof item

    if (type === 'number') {
      return sizes.number
    } else if (type === 'boolean') {
      return sizes.boolean
    } else if (type === 'string') {
      return sizes.string(item)
    } else if (Array.isArray(item)) {
      return 2 + item.reduce((acc, el) => acc + calculateSize(el), 0)
    } else if (item && type === 'object') {
      // eslint-disable-next-line security/detect-object-injection
      return Object.keys(item).reduce((acc, key) => acc + calculateSize(item[key]), 0)
    }

    return 0
  }

  return calculateSize(obj)
}

function estimateBinarySizeOfObject3(obj): number {
  const sizes = {
    number: 8, // assuming a number is serialized as a double (8 bytes)
    boolean: 1,
    string: (str: string) => 2 + str.length * 2, // 2 bytes for length + string length * 2 bytes
  }

  const calculateSize = (item): number => {
    const type = typeof item

    if (type === 'number') {
      return sizes.number
    } else if (type === 'boolean') {
      return sizes.boolean
    } else if (type === 'string') {
      return sizes.string(item)
    } else if (Array.isArray(item)) {
      if (item.length === 0) {
        return 0
      }
      return 2 + item.length * calculateSize(item[0])
    } else if (item && type === 'object') {
      // eslint-disable-next-line security/detect-object-injection
      return Object.keys(item).reduce((acc, key) => acc + calculateSize(item[key]), 0)
    }

    return 0
  }

  return calculateSize(obj)
}

testCorrectness()

console.log('\ntestVectorBufferStreamWithReducedAlloc')
testVectorBufferStreamWithReducedAlloc()

console.log('\ntestVectorBufferStreamWithMultipleAlloc')
testVectorBufferStreamWithMultipleAlloc()

console.log('\ntestVectorBufferStreamWithExactAlloc')
testVectorBufferStreamWithExactAlloc()
