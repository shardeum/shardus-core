import { makeShortHash } from '../'

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

export const stringifyReduce = (val, isArrayProp?: boolean) => {
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
        let mapContainer = {
          dataType: 'stringifyReduce_map_2_array',
          value: Array.from(val.entries()), // or with spread: value: [...originalObject]
        }
        return stringifyReduce(mapContainer)
      } else {
        toStr = objToString.call(val)
        if (toStr === '[object Array]') {
          str = '['
          max = val.length - 1
          for (i = 0; i < max; i++) {
            str += stringifyReduce(val[i], true) + ','
          }
          if (max > -1) {
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
            key = keys[i]
            propVal = stringifyReduce(val[key], false)
            if (propVal !== undefined) {
              if (str) {
                str += ','
              }
              str += JSON.stringify(key) + ':' + propVal
            }
            i++
          }
          return '{' + str + '}'
        } else {
          return JSON.stringify(val)
        }
      }
    case 'function':
    case 'undefined':
      return isArrayProp ? null : undefined
    case 'string':
      const reduced = makeShortHash(val)
      return JSON.stringify(reduced)
    default:
      if (typeof val === 'bigint') {
        val = val.toString()
      }
      return isFinite(val) ? val : null
  }
}

export const stringifyReduceLimit = (val, limit = 100, isArrayProp?: boolean) => {
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
            str += stringifyReduceLimit(val[i], limit - str.length, true) + ','
            if (str.length > limit) {
              return str + 'LIMIT'
            }
          }
          if (max > -1) {
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
            key = keys[i]
            propVal = stringifyReduceLimit(val[key], limit - str.length, false)
            if (propVal !== undefined) {
              if (str) {
                str += ','
              }
              str += JSON.stringify(key) + ':' + propVal
            }
            i++

            if (str.length > limit) {
              return str + 'LIMIT'
            }
          }
          return '{' + str + '}'
        } else {
          return JSON.stringify(val)
        }
      }
    case 'function':
    case 'undefined':
      return isArrayProp ? null : undefined
    case 'string':
      const reduced = makeShortHash(val)
      return JSON.stringify(reduced)
    default:
      if (typeof val === 'bigint') {
        val = val.toString()
      }
      return isFinite(val) ? val : null
  }
}

export const replacer = (key, value) => {
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

export const reviver = (key, value) => {
  if (typeof value === 'object' && value !== null) {
    if (value.dataType === 'stringifyReduce_map_2_array') {
      return new Map(value.value)
    }
  }
  return value
}

export const reviverExpander = (key, value) => {
  if (typeof value === 'object' && value !== null) {
    if (value.dataType === 'stringifyReduce_map_2_array') {
      return new Map(value.value)
    }
  }
  if (typeof value === 'string' && value.length === 10 && value[4] === 'x') {
    let res = value.slice(0, 4) + '0'.repeat(55) + value.slice(5, 5 + 5)
    return res
  }
  return value
}

//Figure out certain chunky objects and store them in their own table
export const stringifyReduceMemoize = (val, isArrayProp?: boolean) => {}

export const reviverMemoize = (key, value) => {
  if (typeof value === 'object' && value !== null) {
    if (value.dataType === 'stringifyReduce_map_2_array') {
      return new Map(value.value)
    }
  }
  return value
}

export const debugReplacer = (key, value) => {
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

export const debugReviver = (key, value) => {
  if (typeof value === 'object' && value !== null) {
    if (value.dataType === 'stringifyReduce_map_2_array') {
      return new Map(value.value)
    }
  }
  return value
}
