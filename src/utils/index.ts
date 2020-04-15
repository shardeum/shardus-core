import { join } from 'path'
import { readFileSync, readdirSync } from 'fs'

export const sleep = ms => {
  return new Promise(resolve => {
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

export const deepCopy = obj => {
  if (typeof obj !== 'object')
    throw Error('Given element is not of type object.')
  return JSON.parse(JSON.stringify(obj))
}

export const readJson = filename => {
  const file = readFileSync(filename).toString()
  const config = JSON.parse(file)
  return config
}

export const readJsonDir = dir => {
  // => filesObj
  const filesObj = {}
  readdirSync(dir).forEach(fileName => {
    const name = fileName.split('.')[0]
    filesObj[name] = readJson(join(dir, fileName))
  })
  return filesObj
}

/*
 * Binary search in JavaScript.
 * Returns the index of of the element in a sorted array or (-n-1) where n is the insertion point for the new element.
 *    If the return value is negative use 1-returned as the insertion point for the element
 * Parameters:
 *     ar - A sorted array
 *     el - An element to search for
 *     compare_fn - A comparator function. The function takes two arguments: (el, ae) and returns:
 *        a negative number  if el is less than ae;
 *        a positive number if el is greater than ae.
 *        0 if el is equal to ae;
 *        note that el is the element we are searching for and ae is an array element from the sorted array
 * The array may contain duplicate elements. If there are more than one equal elements in the array,
 * the returned value can be the index of any one of the equal elements.
 */
export function binarySearch(ar, el, compare_fn?: any) {
  if (compare_fn == null) {
    // Emulate the default Array.sort() comparator
    compare_fn = (a, b) => {
      // No need to do this JS, why convert numbers to strings before comparing them
      if (typeof a !== 'string' || typeof b !== 'string') {
        console.log(
          'compare function in binarySearch was changed, if nothing is broken remove this'
        )
      }
      //      if (typeof a !== 'string') a = String(a)
      //      if (typeof b !== 'string') b = String(b)
      return a > b ? 1 : a < b ? -1 : 0
    }
  }
  var m = 0
  var n = ar.length - 1
  while (m <= n) {
    var k = (n + m) >> 1
    var cmp = compare_fn(el, ar[k])
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

export const insertSorted = (arr, item, comparator?: any) => {
  let i = binarySearch(arr, item, comparator)
  if (i < 0) {
    i = 1 - i
  }
  arr.splice(i, 0, item)

  /*  We should use our  binary search function instead of recoding it again */

  /*
  if (comparator == null) {
    // Emulate the default Array.sort() comparator
    comparator = (a, b) => {
      if (typeof a !== 'string') a = String(a)
      if (typeof b !== 'string') b = String(b)
      return (a > b ? 1 : (a < b ? -1 : 0))
    }
  }

  // Get the index we need to insert the item at
  let min = 0
  let max = arr.length
  let index = Math.floor((min + max) / 2)
  while (max > min) {
    if (comparator(item, arr[index]) < 0) {
      max = index
    } else {
      min = index + 1
    }
    index = Math.floor((min + max) / 2)
  }
  // Insert the item
  arr.splice(index, 0, item)
  */
}

export const binarySearch_old = (arr, item, comparator) => {
  if (comparator == null) {
    // Emulate the default Array.sort() comparator
    comparator = (a, b) => {
      if (typeof a !== 'string') a = String(a)
      if (typeof b !== 'string') b = String(b)
      return a > b ? 1 : a < b ? -1 : 0
    }
  }

  // Get the index of the item
  let min = 0
  let max = arr.length
  let index = Math.floor((min + max) / 2)
  while (max > min) {
    const result = comparator(item, arr[index])
    if (result === 0) {
      return index
    } else if (result < 0) {
      max = index
    } else {
      min = index + 1
    }
    index = Math.floor((min + max) / 2)
  }
  return false
}

export const insertSorted_old = (arr, item, comparator?: any) => {
  if (comparator == null) {
    // Emulate the default Array.sort() comparator
    comparator = (a, b) => {
      if (typeof a !== 'string') a = String(a)
      if (typeof b !== 'string') b = String(b)
      return a > b ? 1 : a < b ? -1 : 0
    }
  }

  // Get the index we need to insert the item at
  let min = 0
  let max = arr.length
  let index = Math.floor((min + max) / 2)
  while (max > min) {
    if (comparator(item, arr[index]) < 0) {
      max = index
    } else {
      min = index + 1
    }
    index = Math.floor((min + max) / 2)
  }
  // Insert the item
  arr.splice(index, 0, item)
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
  const num1 = parseInt(hexString1.substring(0, 8), 16)
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

export const isObject = val => {
  if (val === null) {
    return false
  }
  return typeof val === 'function' || typeof val === 'object'
}

export const isString = x => {
  return Object.prototype.toString.call(x) === '[object String]'
}

export const isNumeric = x => {
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

let objToString = Object.prototype.toString
let objKeys =
  Object.keys ||
  function(obj) {
    let keys = []
    for (let name in obj) {
      keys.push(name)
    }
    return keys
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

// Returns an array of two arrays, one will all resolved promises, and one with all rejected promises
export const robustPromiseAll = async promises => {
  // This is how we wrap a promise to prevent it from rejecting directing in the Promise.all and causing a short circuit
  const wrapPromise = async promise => {
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
export function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[array[i], array[j]] = [array[j], array[i]]
  }
}

export function removeNodesByID(nodes, ids) {
  if (!Array.isArray(ids)) {
    return nodes
  }
  return nodes.filter(node => ids.indexOf(node.id) === -1)
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
