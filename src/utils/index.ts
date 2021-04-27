import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { isDeepStrictEqual } from 'util'
import {logFlags} from '../logger'

type Comparator<T, E = T> = (a: E, b: T) => number

export const sleep = (ms) => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export const getTime = (format = 'ms') => {
  let time
  switch (format) {
    case 'ms':
      time = Date.now()
      break
    case 's':
      time = Math.floor(Date.now() / 1000)
      break
    default:
      throw Error('Error: Invalid format given.')
  }
  return time
}

export const deepCopy = (obj) => {
  if (typeof obj !== 'object') {
    throw Error('Given element is not of type object.')
  }
  return JSON.parse(JSON.stringify(obj))
}

export const readJson = (filename) => {
  const file = readFileSync(filename).toString()
  const config = JSON.parse(file)
  return config
}

export const readJsonDir = (dir) => {
  // => filesObj
  const filesObj = {}
  readdirSync(dir).forEach((fileName) => {
    const name = fileName.split('.')[0]
    filesObj[name] = readJson(join(dir, fileName))
  })
  return filesObj
}

/**
 * Binary find lowest
 * Returns the index of the lowest element in the array. The array is monotonically increasing to the right, but
 *     can have a break in the middle. For example
 * [ 5, 8, 1, 2, 4]
 * Notice the break is at index 1 when the value drops from 8 to 1, but is other increasing to the right
 * The index to be returned in this case is 2 which is the indes of the lowest value.
 * In the following example the index to be returned is also 2.
 * [ 5, 8, 1, 1, 4]
 * So when the lowest value is repeated we should return the indes of the left most lowest element.
 * In the following example the index to be returned is 0.
 * [ 2, 3, 5, 7, 8]
 * The simple way of doing this is to scan the whole array to find the left most lowest element.
 * However if the array is very long it is faster to use a binary search to find it.
 * This is used when we refresh nodes.
 *
 * Parameters:
 *     ar - A sorted array
 *     compare_fn - A comparator function. The function takes two arguments: (a, b) and returns:
 *        a positive number if a is greater than b.
 *        a negative number if a is less than b.
 *        0 if a is equal to b;
 * The array may contain duplicate elements. If there are more than one lowest elements in the array,
 * the returned value will be the index of the left most lowest element
 */
export function binaryLowest<T>(ar: T[], comparator?: Comparator<T>) {
  if (ar.length < 1) return -1
  if (comparator == null) {
    // Emulate the default Array.sort() comparator
    comparator = (a, b) => {
      return a > b ? 1 : a < b ? -1 : 0
    }
  }
  if (ar.length < 2) return 0
  let m = 0
  let n = ar.length - 1
  if (comparator(ar[m], ar[n]) < 0) return m
  while (m <= n) {
    const k = (n + m) >> 1
    const cmp = comparator(ar[m], ar[k])
    if (logFlags.console) console.log(ar)
    if (logFlags.console) console.log(m, k, ar[m], ar[k], cmp)
    if (cmp > 0) {
      n = k
    } else if (cmp < 0) {
      m = k
    } else {
      if (k + 1 === n) return n
      m = k
    }
  }
  return m
}

/**
 * Binary search in JavaScript.
 * Returns the index of of the element in a sorted array or (-n-1) where n is the insertion point for the new element.
 *   If the return value is negative use 1-returned as the insertion point for the element
 * Parameters:
 *     arr - A sorted array
 *     el - An element to search for
 *     compare_fn - A comparator function. The function takes two arguments: (el, ae) and returns:
 *       a negative number  if el is less than ae;
 *       a positive number if el is greater than ae.
 *       0 if el is equal to ae;
 *       note that el is the element we are searching for and ae is an array element from the sorted array
 * The array may contain duplicate elements. If there are more than one equal elements in the array,
 * the returned value can be the index of any one of the equal elements.
 *
 * @param arr
 * @param el
 * @param comparator
 */
export function binarySearch<T, E = Partial<T>>(
  arr: T[],
  el: E,
  comparator?: Comparator<T, typeof el>
) {
  if (comparator == null) {
    // Emulate the default Array.sort() comparator
    comparator = (a, b) => {
      return a.toString() > b.toString()
        ? 1
        : a.toString() < b.toString()
        ? -1
        : 0
    }
  }
  let m = 0
  let n = arr.length - 1
  while (m <= n) {
    const k = (n + m) >> 1
    const cmp = comparator(el, arr[k])
    if (cmp > 0) {
      m = k + 1
    } else if (cmp < 0) {
      n = k - 1
    } else {
      return k
    }
  }
  return -m - 1
}

export function insertSorted<T>(arr: T[], item: T, comparator?: Comparator<T>) {
  let i = binarySearch(arr, item, comparator)
  if (i < 0) {
    i = -1 - i
  }
  arr.splice(i, 0, item)
}

export function propComparator<T>(prop: keyof T) {
  const comparator = (a: T, b: T) =>
    a[prop] > b[prop] ? 1 : a[prop] < b[prop] ? -1 : 0
  return comparator
}

export function propComparator2<T>(prop: keyof T, prop2: keyof T) {
  const comparator = (a: T, b: T) =>
    a[prop] === b[prop]
      ? a[prop2] === b[prop2]
        ? 0
        : a[prop2] > b[prop2]
        ? 1
        : -1
      : a[prop] > b[prop]
      ? 1
      : -1
  return comparator
}

export const computeMedian = (arr = [], sort = true) => {
  if (sort) {
    arr.sort((a, b) => a - b)
  }
  const len = arr.length
  switch (len) {
    case 0: {
      return 0
    }
    case 1: {
      return arr[0]
    }
    default: {
      const mid = len / 2
      if (len % 2 === 0) {
        return arr[mid]
      } else {
        return (arr[Math.floor(mid)] + arr[Math.ceil(mid)]) / 2
      }
    }
  }
}

export const XOR = (hexString1, hexString2) => {
  // tslint:disable-next-line: ban
  const num1 = parseInt(hexString1.substring(0, 8), 16)
  // tslint:disable-next-line: ban
  const num2 = parseInt(hexString2.substring(0, 8), 16)
  return (num1 ^ num2) >>> 0
}

export const getClosestHash = (targetHash, hashes) => {
  let closest = null
  let closestDist = 0
  for (const hash of hashes) {
    const dist = XOR(targetHash, hash)
    if (dist === closestDist) {
      console.error(
        new Error(
          `Two hashes came out to the same distance from target hash!\n 1st hash: ${closest}\n 2nd hash: ${hash}\n Target hash: ${targetHash}`
        )
      )
      return null
    }
    if (dist > closestDist) closest = hash
    closestDist = dist
  }
  return closest
}

export const setAlarm = (callback, timestamp) => {
  const now = Date.now()
  if (timestamp <= now) {
    callback()
    return
  }
  const toWait = timestamp - now
  setTimeout(callback, toWait)
}

export const isObject = (val) => {
  if (val === null) {
    return false
  }
  if (Array.isArray(val)) {
    return false
  }
  return typeof val === 'function' || typeof val === 'object'
}

export const isString = (x) => {
  return Object.prototype.toString.call(x) === '[object String]'
}

export const isNumeric = (x) => {
  return isNaN(x) === false
}

export const makeShortHash = (x, n = 4) => {
  if (!x) {
    return x
  }
  if (x.length > 63) {
    if (x.length === 64) {
      return x.slice(0, n) + 'x' + x.slice(63 - n)
    } else if (x.length === 128) {
      return x.slice(0, n) + 'xx' + x.slice(127 - n)
    } else if (x.length === 192) {
      return x.slice(0, n) + 'xx' + x.slice(191 - n)
    }
  }
  return x
}

/**
 * short
 * grab the first n (default=4) hex bytes of a string (4 bytes == 8 char hex string)
 * @param x
 * @param n
 */
export const short = (x: string, n = 4) => {
  if (!x) {
    return x
  }
  return x.slice(0, n * 2)
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
  if(typeof value === 'string' && value.length === 10 && value[4] === 'x'){
    let res =  value.slice(0,4) + '0'.repeat(55) + value.slice(5,5+5)
    return res
  }
  return value
}

export const debugExpand = (value: string) => {
  let res =  value.slice(0,4) + '0'.repeat(55) + value.slice(5,5+5)
  return res
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

//Figure out certain chunky objects and store them in their own table
export const stringifyReduceMemoize = (val, isArrayProp?: boolean) => { 


}

export const reviverMemoize = (key, value) => {
  if (typeof value === 'object' && value !== null) {
    if (value.dataType === 'stringifyReduce_map_2_array') {
      return new Map(value.value)
    }
  }
  return value
}

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
      return isFinite(val) ? val : null
  }
}

export const stringifyReduceLimit = (
  val,
  limit = 100,
  isArrayProp?: boolean
) => {
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
      return isFinite(val) ? val : null
  }
}

/**
 * Returns an array of two arrays, one will all resolved promises, and one with all rejected promises
 */
export const robustPromiseAll = async (promises) => {
  // This is how we wrap a promise to prevent it from rejecting directing in the Promise.all and causing a short circuit
  const wrapPromise = async (promise) => {
    // We are trying to await the promise, and catching any rejections
    // We return an array, the first index being resolve, and the second being an error
    try {
      const result = await promise
      return [result]
    } catch (e) {
      return [null, e]
    }
  }

  const wrappedPromises = []
  // We wrap all the promises we received and push them to an array to be Promise.all'd
  for (const promise of promises) {
    wrappedPromises.push(wrapPromise(promise))
  }
  const resolved = []
  const errors = []
  // We await the wrapped promises to finish resolving or rejecting
  const wrappedResults = await Promise.all(wrappedPromises)
  // We iterate over all the results, checking if they resolved or rejected
  for (const wrapped of wrappedResults) {
    const [result, err] = wrapped
    // If there was an error, we push it to our errors array
    if (err) {
      errors.push(err)
      continue
    }
    // Otherwise, we were able to resolve so we push it to the resolved array
    resolved.push(result)
  }
  // We return two arrays, one of the resolved promises, and one of the errors
  return [resolved, errors]
}

export const sortAsc = (a, b) => {
  return a === b ? 0 : a < b ? -1 : 1
}

export const sortDec = (a, b) => {
  return a === b ? 0 : a > b ? -1 : 1
}

export const sort_i_Asc = (a, b) => {
  return a.i === b.i ? 0 : a.i < b.i ? -1 : 1
}

export const sort_id_Asc = (a, b) => {
  return a.id === b.id ? 0 : a.id < b.id ? -1 : 1
}

export const sortHashAsc = (a, b) => {
  return a.hash === b.hash ? 0 : a.hash < b.hash ? -1 : 1
}

export const sortTimestampAsc = (a, b) => {
  return a.timestamp === b.timestamp ? 0 : a.timestamp < b.timestamp ? -1 : 1
}

export const sortAscProp = (a, b, propName) => {
  const aVal = a[propName]
  const bVal = b[propName]
  return aVal === bVal ? 0 : aVal < bVal ? -1 : 1
}

export const sortDecProp = (a, b, propName) => {
  const aVal = a[propName]
  const bVal = b[propName]
  return aVal === bVal ? 0 : aVal > bVal ? -1 : 1
}

// From: https://stackoverflow.com/a/12646864
export function shuffleArray<T>(array: T[]) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[array[i], array[j]] = [array[j], array[i]]
  }
}

export function removeNodesByID(nodes, ids) {
  if (!Array.isArray(ids)) {
    return nodes
  }
  return nodes.filter((node) => ids.indexOf(node.id) === -1)
}

// From: https://stackoverflow.com/a/19270021
export function getRandom<T>(arr: T[], n: number): T[] {
  let len = arr.length
  const taken = new Array(len)
  if (n > len) {
    n = len
  }
  const result = new Array(n)
  while (n--) {
    const x = Math.floor(Math.random() * len)
    result[n] = arr[x in taken ? taken[x] : x]
    taken[x] = --len in taken ? taken[len] : len
  }
  return result
}

export function getRandomGossipIn(nodeIdxs, fanOut, myIdx) {
  const nn = nodeIdxs.length
  if (fanOut >= nn) {
    fanOut = nn - 1
  }
  if (fanOut < 1) {
    return []
  }
  const results = [(myIdx + 1) % nn]
  if (fanOut < 2) {
    return results
  }
  results.push((myIdx + nn - 1) % nn)
  if (fanOut < 3) {
    return results
  }
  while (results.length < fanOut) {
    const r = Math.floor(Math.random() * nn)
    if (r === myIdx) {
      continue
    }
    let k = 0
    for (; k < results.length; k++) {
      if (r === results[k]) {
        break
      }
    }
    if (k === results.length) {
      results.push(r)
    }
  }
  return results
}

export function reversed<T>(thing: Iterable<T>) {
  const arr = Array.isArray(thing) ? thing : Array.from(thing)
  let i = arr.length - 1
  const reverseIterator = {
    next: () => {
      const done = i < 0
      const value = done ? undefined : arr[i]
      i--
      return { value, done }
    },
  }
  return {
    [Symbol.iterator]: () => reverseIterator,
  }
}

/**
 * [TODO] Implement an iterator that goes through the array as if it were a ring
 * and starts with a random offset and direction.
 *
 * @param thing
 */
export function randomShifted<T>(thing: Iterable<T>) {
  const arr = Array.isArray(thing) ? thing : Array.from(thing)
  let i = arr.length - 1
  const reverseIterator = {
    next: () => {
      const done = i < 0
      const value = done ? undefined : arr[i]
      i--
      return { value, done }
    },
  }
  return {
    [Symbol.iterator]: () => reverseIterator,
  }
}

/*
inp is the input object to be checked
def is an object defining the expected input
{name1:type1, name1:type2, ...}
name is the name of the field
type is a string with the first letter of 'string', 'number', 'Bigint', 'boolean', 'array' or 'object'
type can end with '?' to indicate that the field is optional and not required
---
Example of def:
{fullname:'s', age:'s?',phone:'sn'}
---
Returns a string with the first error encountered or and empty string ''.
Errors are: "[name] is required" or "[name] must be, [type]"
*/
export function validateTypes(inp, def) {
  if (inp === undefined) return 'input is undefined'
  if (inp === null) return 'input is null'
  if (typeof inp !== 'object') return 'input must be object, not ' + typeof inp
  const map = {
    string: 's',
    number: 'n',
    boolean: 'b',
    bigint: 'B',
    array: 'a',
    object: 'o',
  }
  const imap = {
    s: 'string',
    n: 'number',
    b: 'boolean',
    B: 'bigint',
    a: 'array',
    o: 'object',
  }
  const fields = Object.keys(def)
  for (let name of fields) {
    const types = def[name]
    const opt = types.substr(-1, 1) === '?' ? 1 : 0
    if (inp[name] === undefined && !opt) return name + ' is required'
    if (inp[name] !== undefined) {
      if (inp[name] === null && !opt) return name + ' cannot be null'
      let found = 0
      let be = ''
      for (let t = 0; t < types.length - opt; t++) {
        let it = map[typeof inp[name]]
        it = Array.isArray(inp[name]) ? 'a' : it
        let is = types.substr(t, 1)
        if (it === is) {
          found = 1
          break
        } else be += ', ' + imap[is]
      }
      if (!found) return name + ' must be' + be
    }
  }
  return ''
}

/**
 * Checks whether the given thing is undefined
 */
export function isUndefined(thing: unknown) {
  return typeof thing === 'undefined'
}

export function isStartWith(inputStr: string, startStr: string) {
  if (!inputStr) return false
  if (!startStr) return false
  return inputStr.indexOf(startStr) === 0
}
