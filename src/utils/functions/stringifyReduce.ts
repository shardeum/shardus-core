import { safeStringify } from '@shardus/types/build/src/utils/functions/stringify'
import { makeShortHash } from '../'

function isBufferValue(toStr, val: Record<string, unknown>): boolean {
  return (
    toStr === '[object Object]' &&
    objKeys(val).length == 2 &&
    objKeys(val).includes('type') &&
    val['type'] == 'Buffer'
  )
}

function isUnit8Array(value: unknown): boolean {
  return value instanceof Uint8Array
}

const objToString = Object.prototype.toString
const objKeys =
  Object.keys ||
  ((obj) => {
    const keys = []
    // tslint:disable-next-line: forin
    for (const name in obj) {
      keys.push(name)
    }
    return keys
  })
export const stringifyReduce = (val, isArrayProp?: boolean): string => {
  let i, max, str, keys, key, propVal, toStr
  if (val === true) {
    return 'true'
  }
  if (val === false) {
    return 'false'
  }
  switch (typeof val) {
    case 'object':
      if (val === null) {
        return null
      } else if (val.toJSON && typeof val.toJSON === 'function') {
        return stringifyReduce(val.toJSON(), isArrayProp)
      } else if (val instanceof Map) {
        // let mapContainer = {stringifyReduce_map_2_array:[...val.entries()]}
        // return stringifyReduce(mapContainer)
        const mapContainer = {
          dataType: 'stringifyReduce_map_2_array',
          value: Array.from(val.entries()), // or with spread: value: [...originalObject]
        }
        return stringifyReduce(mapContainer)
      } else if (val instanceof Uint8Array) {
        // this seems to work.  choosing a lossy option but that is more readable for this context
        const buffer = Buffer.from(val)
        return buffer.toString('hex')
      } else {
        toStr = objToString.call(val)
        if (toStr === '[object Array]') {
          str = '['
          max = val.length - 1
          for (i = 0; i < max; i++) {
            // eslint-disable-next-line security/detect-object-injection
            str += stringifyReduce(val[i], true) + ','
          }
          if (max > -1) {
            // eslint-disable-next-line security/detect-object-injection
            str += stringifyReduce(val[i], true)
          }
          return str + ']'
        } else if (toStr === '[object Object]') {
          // only object is left
          keys = objKeys(val).sort()
          max = keys.length
          str = ''
          i = 0
          while (i < max) {
            // eslint-disable-next-line security/detect-object-injection
            key = keys[i]
            // eslint-disable-next-line security/detect-object-injection
            propVal = stringifyReduce(val[key], false)
            if (propVal !== undefined) {
              if (str) {
                str += ','
              }
              str += safeStringify(key) + ':' + propVal
            }
            i++
          }
          return '{' + str + '}'
        } else {
          return safeStringify(val)
        }
      }
    case 'function':
    case 'undefined':
      return isArrayProp ? null : undefined
    case 'string': {
      const reduced = makeShortHash(val)
      return safeStringify(reduced)
    }
    case 'bigint':
      // Add some special identifier for bigint
      // return JSON.stringify({__BigInt__: val.toString()})
      return safeStringify(val.toString(16))
    default:
      if (typeof val === 'bigint') {
        val = val.toString(16)
      }
      return isFinite(val) ? val : null
  }
}

export const stringifyReduceLimit = (val, limit = 100, isArrayProp?: boolean): string => {
  let i, max, str, keys, key, propVal, toStr

  if (limit < 0) {
    return str + 'LIMIT'
  }
  if (val === true) {
    return 'true'
  }
  if (val === false) {
    return 'false'
  }
  switch (typeof val) {
    case 'object':
      if (val === null) {
        return null
      } else if (val.toJSON && typeof val.toJSON === 'function') {
        return stringifyReduceLimit(val.toJSON(), limit, isArrayProp)
      } else {
        toStr = objToString.call(val)
        if (toStr === '[object Array]') {
          str = '['
          max = val.length - 1
          for (i = 0; i < max; i++) {
            // eslint-disable-next-line security/detect-object-injection
            str += stringifyReduceLimit(val[i], limit - str.length, true) + ','
            if (str.length > limit) {
              return str + 'LIMIT'
            }
          }
          if (max > -1) {
            // eslint-disable-next-line security/detect-object-injection
            str += stringifyReduceLimit(val[i], limit - str.length, true)
          }
          return str + ']'
        } else if (toStr === '[object Object]') {
          // only object is left
          keys = objKeys(val).sort()
          max = keys.length
          str = ''
          i = 0
          while (i < max) {
            key = keys[Number(i)]
            // eslint-disable-next-line security/detect-object-injection
            propVal = stringifyReduceLimit(val[key], limit - str.length, false)
            if (propVal !== undefined) {
              if (str) {
                str += ','
              }
              str += safeStringify(key) + ':' + propVal
            }
            i++

            if (str.length > limit) {
              return str + 'LIMIT'
            }
          }
          return '{' + str + '}'
        } else {
          return safeStringify(val)
        }
      }
    case 'function':
    case 'undefined':
      return isArrayProp ? null : undefined
    case 'string': {
      const reduced = makeShortHash(val)
      return safeStringify(reduced)
    }
    default:
      if (typeof val === 'bigint') {
        val = val.toString()
      }
      return isFinite(val) ? val : null
  }
}

export const replacer = <T>(
  _key,
  value: T
):
  | {
      dataType: 'stringifyReduce_map_2_array'
      value: [symbol, unknown][]
    }
  | T => {
  const originalObject = value // this[key]
  if (originalObject instanceof Map) {
    return {
      dataType: 'stringifyReduce_map_2_array',
      value: Array.from(originalObject.entries()), // or with spread: value: [...originalObject]
    }
  } else {
    return value
  }
}

export const reviver = <T, K, V>(
  _key,
  value:
    | {
        dataType: 'stringifyReduce_map_2_array'
        value: [K, V][]
      }
    | T
): Map<K, V> | T => {
  if (typeof value === 'object' && value !== null && 'dataType' in value) {
    if (value.dataType === 'stringifyReduce_map_2_array') {
      return new Map(value.value)
    }
  } else {
    return value as T
  }
}

export const reviverExpander = <T, K, V>(
  _key,
  value:
    | {
        dataType: 'stringifyReduce_map_2_array'
        value: [K, V][]
      }
    | T
): Map<K, V> | string | T => {
  if (typeof value === 'object' && value !== null) {
    if ('dataType' in value && value.dataType === 'stringifyReduce_map_2_array') {
      return new Map(value.value)
    }
  }
  if (typeof value === 'string' && value.length === 10 && value[4] === 'x') {
    const res = value.slice(0, 4) + '0'.repeat(55) + value.slice(5, 5 + 5)
    return res
  }
  return value as T
}

//Figure out certain chunky objects and store them in their own table
// commenting stringifyReduceMemoize as its not being used anywhere
//export const stringifyReduceMemoize = (val, isArrayProp?: boolean) => {}

export const reviverMemoize = <T, K, V>(
  _key,
  value:
    | {
        dataType: 'stringifyReduce_map_2_array'
        value: [K, V][]
      }
    | T
): Map<K, V> | T => {
  if (typeof value === 'object' && value !== null) {
    if ('dataType' in value && value.dataType === 'stringifyReduce_map_2_array') {
      return new Map(value.value)
    }
  }
  return value as T
}

export const debugReplacer = <T>(
  key: string,
  value: T
):
  | {
      dataType: 'stringifyReduce_map_2_array'
      value: [symbol, unknown][]
    }
  | Record<string, never>
  | string
  | T => {
  const originalObject = value // this[key]

  if (key === 'accountTempMap') {
    return {}
  }
  if (typeof originalObject === 'string') {
    const reduced = makeShortHash(originalObject)
    return reduced
  }
  if (originalObject instanceof Map) {
    return {
      dataType: 'stringifyReduce_map_2_array',
      value: Array.from(originalObject.entries()), // or with spread: value: [...originalObject]
    }
  } else {
    return value
  }
}

export const debugReviver = <T, K, V>(
  _key,
  value:
    | {
        dataType: 'stringifyReduce_map_2_array'
        value: [K, V][]
      }
    | T
): Map<K, V> | T => {
  if (typeof value === 'object' && value !== null) {
    if ('dataType' in value && value.dataType === 'stringifyReduce_map_2_array') {
      return new Map(value.value)
    }
  }
  return value as T
}
