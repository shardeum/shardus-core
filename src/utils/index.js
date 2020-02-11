const { readFileSync, readdirSync } = require('fs')
const { join } = require('path')

const sleep = (ms) => {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

const getTime = (format = 'ms') => {
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

const deepCopy = (obj) => {
  if (typeof obj !== 'object') throw Error('Given element is not of type object.')
  return JSON.parse(JSON.stringify(obj))
}

const readJson = (filename) => {
  const file = /** @type {string} */(/** @type {unknown} */(readFileSync(filename)))
  const config = JSON.parse(file)
  return config
}

const readJsonDir = (dir) => { // => filesObj
  let filesObj = {}
  readdirSync(dir).forEach(fileName => {
    let name = fileName.split('.')[0]
    filesObj[name] = readJson(join(dir, fileName))
  })
  return filesObj
}

const binarySearch = (arr, item, comparator) => {
  if (comparator == null) {
    // Emulate the default Array.sort() comparator
    comparator = (a, b) => {
      if (typeof a !== 'string') a = String(a)
      if (typeof b !== 'string') b = String(b)
      return (a > b ? 1 : (a < b ? -1 : 0))
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

const insertSorted = (arr, item, comparator) => {
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
}

const computeMedian = (arr = [], sort = true) => {
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

const XOR = (hexString1, hexString2) => {
  const num1 = parseInt(hexString1.substring(0, 8), 16)
  const num2 = parseInt(hexString2.substring(0, 8), 16)
  return (num1 ^ num2) >>> 0
}

const getClosestHash = (targetHash, hashes) => {
  let closest = null
  let closestDist = 0
  for (const hash of hashes) {
    const dist = XOR(targetHash, hash)
    if (dist === closestDist) {
      console.error(new Error(`Two hashes came out to the same distance from target hash!\n 1st hash: ${closest}\n 2nd hash: ${hash}\n Target hash: ${targetHash}`))
      return null
    }
    if (dist > closestDist) closest = hash
    closestDist = dist
  }
  return closest
}

const setAlarm = (callback, timestamp) => {
  const now = Date.now()
  if (timestamp <= now) {
    callback()
    return
  }
  const toWait = timestamp - now
  setTimeout(callback, toWait)
}

const isObject = (val) => {
  if (val === null) {
    return false
  }
  return ((typeof val === 'function') || (typeof val === 'object'))
}

const isString = (x) => {
  return Object.prototype.toString.call(x) === '[object String]'
}

const isNumeric = (x) => {
  return isNaN(x) === false
}

const makeShortHash = (x, n = 4) => {
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

var objToString = Object.prototype.toString
var objKeys = Object.keys || function (obj) {
  var keys = []
  for (var name in obj) {
    keys.push(name)
  }
  return keys
}

const stringifyReduce = (val, isArrayProp) => {
  var i, max, str, keys, key, propVal, toStr
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
      let reduced = makeShortHash(val)
      return JSON.stringify(reduced)
    default:
      return isFinite(val) ? val : null
  }
}

const stringifyReduceLimit = (val, isArrayProp, limit = 100) => {
  var i, max, str, keys, key, propVal, toStr

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
        return stringifyReduceLimit(val.toJSON(), isArrayProp, limit)
      } else {
        toStr = objToString.call(val)
        if (toStr === '[object Array]') {
          str = '['
          max = val.length - 1
          for (i = 0; i < max; i++) {
            str += stringifyReduceLimit(val[i], true, limit - str.length) + ','
            if (str.length > limit) {
              return str + 'LIMIT'
            }
          }
          if (max > -1) {
            str += stringifyReduceLimit(val[i], true, limit - str.length)
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
            propVal = stringifyReduceLimit(val[key], false, limit - str.length)
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
      let reduced = makeShortHash(val)
      return JSON.stringify(reduced)
    default:
      return isFinite(val) ? val : null
  }
}

// Returns an array of two arrays, one will all resolved promises, and one with all rejected promises
const robustPromiseAll = async (promises) => {
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

const sortAsc = (a, b) => {
  return a === b ? 0 : a < b ? -1 : 1
}

const sortDec = (a, b) => {
  return a === b ? 0 : a > b ? -1 : 1
}

const sortHashAsc = (a, b) => {
  return a === b ? 0 : a.hash < b.hash ? -1 : 1
}

const sortAscProp = (a, b, propName) => {
  let aVal = a[propName]
  let bVal = b[propName]
  return aVal === bVal ? 0 : aVal < bVal ? -1 : 1
}

const sortDecProp = (a, b, propName) => {
  let aVal = a[propName]
  let bVal = b[propName]
  return aVal === bVal ? 0 : aVal > bVal ? -1 : 1
}

exports.sleep = sleep
exports.getTime = getTime
exports.deepCopy = deepCopy
exports.readJson = readJson
exports.readJsonDir = readJsonDir
exports.binarySearch = binarySearch
exports.insertSorted = insertSorted
exports.computeMedian = computeMedian
exports.XOR = XOR
exports.getClosestHash = getClosestHash
exports.setAlarm = setAlarm
exports.isObject = isObject
exports.isString = isString
exports.isNumeric = isNumeric
exports.makeShortHash = makeShortHash
exports.stringifyReduce = stringifyReduce
exports.stringifyReduceLimit = stringifyReduceLimit
exports.robustPromiseAll = robustPromiseAll
exports.sortAsc = sortAsc
exports.sortDec = sortDec
exports.sortAscProp = sortAscProp
exports.sortDecProp = sortDecProp
exports.sortHashAsc = sortHashAsc
