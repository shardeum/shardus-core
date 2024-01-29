import { AppHeader } from '@shardus/net/build/src/types'
import { logFlags } from '../logger'
import { nestedCountersInstance } from '../utils/nestedCounters'
import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { WrappedReq, serializeWrappedReq } from './WrappedReq'
import { WrappedResp, deserializeWrappedResp, serializeWrappedResp } from './WrappedResp'
import { InternalRouteEnum } from './enum/InternalRouteEnum'
import { RequestErrorEnum } from './enum/RequestErrorEnum'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'

export const responseSerializer = <T>(
  data: T,
  serializerFunc: (stream: VectorBufferStream, obj: T, root?: boolean) => void
): VectorBufferStream => {
  const bufferInitialSize = estimateBinarySizeOfObject(data)
  const serializedPayload = new VectorBufferStream(bufferInitialSize)
  serializerFunc(serializedPayload, data, true)
  const resp: WrappedResp = {
    payload: serializedPayload.getBuffer(),
  }
  const wrappedRespStream = new VectorBufferStream(4 + resp.payload.length * 4)
  serializeWrappedResp(wrappedRespStream, resp, true)
  return wrappedRespStream
}

export const responseDeserializer = <T>(
  data: VectorBufferStream,
  deserializerFunc: (stream: VectorBufferStream, root?: boolean) => T
): T => {
  data.position = 0
  const responseType = data.readUInt16()
  if (responseType !== TypeIdentifierEnum.cWrappedResp) {
    throw new Error(`Invalid response stream: ${responseType}`)
  }
  const wrappedResp = deserializeWrappedResp(data)
  const payloadStream = VectorBufferStream.fromBuffer(wrappedResp.payload)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const payloadType = payloadStream.readUInt16()
  return deserializerFunc(payloadStream)
}

export const requestSerializer = <T>(
  data: T,
  serializerFunc: (stream: VectorBufferStream, obj: T, root?: boolean) => void
): VectorBufferStream => {
  const bufferInitialSize = estimateBinarySizeOfObject(data)
  const serializedPayload = new VectorBufferStream(bufferInitialSize)
  serializerFunc(serializedPayload, data, true)
  const req: WrappedReq = {
    payload: serializedPayload.getBuffer(),
  }
  const wrappedReqStream = new VectorBufferStream(4 + req.payload.length * 4)
  serializeWrappedReq(wrappedReqStream, req, true)
  return wrappedReqStream
}

// this function pop the first 2 bytes of the stream and check if it matches the typeId
export const getStreamWithTypeCheck = (
  payload: Buffer,
  typeId: number,
  customErrorLog?: string
): VectorBufferStream => {
  const requestStream = VectorBufferStream.fromBuffer(payload)
  const requestType = requestStream.readUInt16()
  if (requestType !== typeId) {
    /* prettier-ignore */ if (logFlags.error && logFlags.console) console.log(`Invalid request stream: expected: ${typeId} actual: ${requestType}. ${customErrorLog ? customErrorLog : ''}`)
    return null
  }
  return requestStream
}

export const verificationDataCombiner = (...args: string[]): string => {
  return args.join(':')
}

export const verificationDataSplitter = (data: string): string[] => {
  return data.split(':')
}

export const requestErrorHandler = (
  apiRoute: InternalRouteEnum,
  errorType: RequestErrorEnum,
  header: AppHeader,
  opts?: { customErrorLog?: string; customCounterSuffix?: string }
): void => {
  let logMessage = `route: ${apiRoute}, error_type: ${errorType}, sender_id: ${header.sender_id}, tracker_id: ${header.tracker_id}, verification_data: ${header.verification_data}`
  if (opts?.customErrorLog) {
    logMessage += `, custom_log: ${opts.customErrorLog}`
  }
  /* prettier-ignore */ if (logFlags.error && logFlags.console) console.log(logMessage)

  let counter = `${apiRoute}_${errorType}`
  if (opts?.customCounterSuffix) {
    counter += `_${opts.customCounterSuffix}`
  }
  nestedCountersInstance.countEvent('internal', counter)
}

function estimateBinarySizeOfObject(obj): number {
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
