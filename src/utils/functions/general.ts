import { P2P } from '@shardus/types'
import { Ordering, safeStringify } from '..'
import { Response } from 'express-serve-static-core'
import { DevSecurityLevel } from '../../shardus/shardus-types'

const replacer = (key: string, value: any): any => {
  if (typeof value === 'bigint') {
    return { __BigInt__: value.toString() }
  }
  if (value instanceof Uint8Array) {
    return { __Uint8Array__: Array.from(value) }
  }
  return value
}

/**
 * this helper replacer is lossy and only for logging
 * @param _key
 * @param value
 * @returns
 */
export const appdata_replacer = <T, K, V>(
  _key,
  value: Map<K, V> | T
): { dataType: 'stringifyReduce_map_2_array'; value: [K, V][] } | T | string => {
  const originalObject = value

  if (originalObject instanceof Map) {
    return {
      dataType: 'stringifyReduce_map_2_array',
      value: Array.from(originalObject.entries()),
    }
  } else if (typeof originalObject === 'bigint') {
    // Convert BigInt to string
    return originalObject.toString()
  } else if (originalObject instanceof Uint8Array) {
    //this is lossy but usefull for logs
    const buffer = Buffer.from(originalObject)
    return buffer.toString('hex')
  } else {
    return value as T
  }
}
const reviver = (key: string, value: any): any => {
  if (value && value.__BigInt__) {
    return BigInt(value.__BigInt__)
  }
  if (value && value.__Uint8Array__ instanceof Array) {
    return new Uint8Array(value.__Uint8Array__)
  }
  return value
}

export const deepCopy = <T>(obj: T): T => {
  if (typeof obj !== 'object') {
    throw Error('Given element is not of type object.')
  }
  return JSON.parse(JSON.stringify(obj, replacer), reviver)
}

export const mod = (n, m): number => {
  return ((n % m) + m) % m
}

/**
 * lerp from v0 to v1 by a
 * @param v0 the start value
 * @param v1 the end value
 * @param a the amount to lerp by (0-1) 0 being v0 and 1 being v1. 0.5 being halfway between v0 and v1
 * @returns
 */
export const lerp = (v0: number, v1: number, a: number): number => {
  return v0 * (1 - a) + v1 * a
}

export function propComparator<T>(prop: keyof T): (a: T, b: T) => Ordering {
  // eslint-disable-next-line security/detect-object-injection
  const comparator = (a: T, b: T): Ordering => (a[prop] > b[prop] ? 1 : a[prop] < b[prop] ? -1 : 0)
  return comparator
}

export function propComparator2<T>(prop: keyof T, prop2: keyof T): (a: T, b: T) => Ordering {
  /* eslint-disable security/detect-object-injection */
  const comparator = (a: T, b: T): Ordering =>
    a[prop] === b[prop]
      ? a[prop2] === b[prop2]
        ? 0
        : a[prop2] > b[prop2]
        ? 1
        : -1
      : a[prop] > b[prop]
      ? 1
      : -1
  /* eslint-enable security/detect-object-injection */
  return comparator
}

export const XOR = (hexString1, hexString2): number => {
  // tslint:disable-next-line: ban
  const num1 = parseInt(hexString1.substring(0, 8), 16)
  // tslint:disable-next-line: ban
  const num2 = parseInt(hexString2.substring(0, 8), 16)
  return (num1 ^ num2) >>> 0
}

export const getClosestHash = (targetHash, hashes): string => {
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

export const makeShortHash = (x, n = 4): string => {
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
export const short = (x: string, n = 4): string => {
  if (!x) {
    return x
  }
  return x.slice(0, n * 2)
}

export const debugExpand = (value: string): string => {
  const res = value.slice(0, 4) + '0'.repeat(55) + value.slice(5, 5 + 5)
  return res
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
export function validateTypes(inp, def): string {
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
  for (const name of fields) {
    /* eslint-disable security/detect-object-injection */
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
        const is = types.substr(t, 1)
        if (it === is) {
          found = 1
          break
        } else be += ', ' + imap[is]
      }
      if (!found) return name + ' must be' + be
    }
    /* eslint-enable security/detect-object-injection */
  }
  return ''
}

export function errorToStringFull(error): string {
  return `${error.name}: ${error.message} at ${error.stack}`
}

export function sumObject(sumObject, toAddObject): void {
  for (const [key, val] of Object.entries(sumObject)) {
    // eslint-disable-next-line security/detect-object-injection
    const otherVal = toAddObject[key]
    if (otherVal == null) {
      continue
    }
    switch (typeof val) {
      case 'number':
        // eslint-disable-next-line security/detect-object-injection
        sumObject[key] = val + otherVal
        break
      default:
        break
    }
  }
}

// @param {LiteralObject} `obj` object to be genrate schema for
// @return {LiteralObject} will return schema object
// This function generate a schema (object) of the object it has been fed
export function generateObjectSchema(obj, options = { arrTypeDiversity: false }): object {
  const schema = {}

  if (Array.isArray(obj)) {
    throw new Error('Object schema generation function does not accept array as argument')
  }

  for (const [key, value] of Object.entries(obj)) {
    /* eslint-disable security/detect-object-injection */
    if (Object.prototype.hasOwnProperty.call(obj, key) && obj[key] !== null) {
      if (key === 'devPublicKeys' && isDevPublicKeysValid(schema[key])) {
        schema[key] = '{ [publicKey: string]: DevSecurityLevel }'
      } else if (value.constructor === Object) {
        schema[key] = generateObjectSchema(value, { arrTypeDiversity: options.arrTypeDiversity })
      } else if (Array.isArray(value)) {
        schema[key] = generateArraySchema(value, { diversity: options.arrTypeDiversity })
      } else {
        schema[key] = typeof value
      }
    }
    /* eslint-enable security/detect-object-injection */
  }
  return schema
}

//Validate devPublicKeys object
function isDevPublicKeysValid(devPublicKeys: { [publicKey: string]: DevSecurityLevel }): boolean {
  for (const key in devPublicKeys) {
    // Check if the value associated with the key is of type DevSecurityLevel (number)
    // eslint-disable-next-line security/detect-object-injection
    if (typeof devPublicKeys[key] !== 'number') {
      return false // If any value is not of the expected type, return false
    }
  }
  return true // If all values are of the expected type, return true
}

// @param {Array} arr, the array to generate schema
// @return {String} will return schema array, Example: `string[]`
// This function generate a schema (array) of the array it has been fed
// SYMBOLS
// [1, 2, 4]                    -> 'number[]'
// ['john','doe']               -> 'string[]'
// [(str)=>str, console.log()]  -> 'function[]'
// [{id: 1}, {id: 2}]           -> '{}[]'
// [new Date(), new Date()]     -> 'object[]'
// [[1,3,2],[1,3,4]]            -> 'array[]'
// [new Date(), 'false', 1]     -> 'any[]' if options.diversity set true
export function generateArraySchema(arr: unknown[], options = { diversity: false }): string {
  let schema: string

  for (let i = 0; i < arr.length; i++) {
    // let's return 'any' when array is holding multiple types
    /* eslint-disable security/detect-object-injection */
    if (i > 0 && arr[i].constructor !== arr[i - 1].constructor) {
      if (options.diversity) {
        return 'any[]'
      } else {
        throw new Error(
          'Array schema generation does not allowed type diversities in an array unless specified'
        )
      }
    }

    // declare conditions for readability
    const IS_MULTI_DIMENSIONAL = Array.isArray(arr[i])
    if (arr[i].constructor === Object) {
      schema = '{}[]'
    } else if (IS_MULTI_DIMENSIONAL) {
      schema = 'array[]'
    } else {
      schema = `${typeof arr[i]}[]`
    }
    /* eslint-enable security/detect-object-injection */
  }

  return schema
}

// @param {LiteralObject} idol, This is the object the function will hold standard to
// @param {LiteralObject} admirer, This is the object the function compare against standard object idol
// Note: these positional parameter matter at which position the object is passed to
// This first parameter idol object will be idolized
// and the function will determine if the second parameter (admirer) object fit the idolized object schema
// Note idol object does not accept type diversive array like this { arr: ['doe', 1, false] } will throw errors.
export function compareObjectShape(
  idol,
  admirer
): { isValid: true; error?: { defectoChain: string[]; defectiveChain: Array<string> } } {
  let isValid
  let error = undefined
  const defectoChain = []

  let idol_schema
  try {
    idol_schema = generateObjectSchema(idol, { arrTypeDiversity: false })
  } catch (e) {
    throw new Error('Type varies array detected inside idol object')
  }
  const admirer_schema = generateObjectSchema(admirer, { arrTypeDiversity: true })

  if (JSON.stringify(idol_schema) === JSON.stringify(admirer_schema)) {
    isValid = true
    return { isValid, error }
  }

  // this function compare prop types
  // this function is not meant to be call outside of this block
  const smartComparator = (idol_type, admirer_type): boolean => {
    if (typeof idol_type === 'object' && idol_type.constructor === Object) {
      return JSON.stringify(idol_type) === JSON.stringify(admirer_type)
    } else {
      return idol_type === admirer_type
    }
  }

  // this function is not meant to be call outside of this block
  // worshipped represent idolized schema
  // worshipper represent admirer's schema
  const defectoHunter = (worshipped, worshipper): { [x: string]: object } => {
    const l1 = Object.keys(worshipped).length
    const l2 = Object.keys(worshipper).length

    //this variable represent whichever object that has the most properpties(key)
    const bigger_obj = l1 >= l2 ? worshipped : worshipper

    for (const key in bigger_obj) {
      /* eslint-disable security/detect-object-injection */
      const DEFECTOR_FOUND = smartComparator(worshipped[key], worshipper[key]) === false

      if (DEFECTOR_FOUND) {
        // save the path to the prop , Example: ['server', 'log']
        defectoChain.push(key)
        if (Object.prototype.hasOwnProperty.call(worshipped, key) && worshipped[key].constructor === Object) {
          return defectoHunter(worshipped[key], worshipper[key])
        } else {
          return { [key]: worshipper[key] }
        }
      }
      /* eslint-enable security/detect-object-injection */
    }
  }

  error = {
    defectiveProp: defectoHunter(idol_schema, admirer_schema),
    defectiveChain: defectoChain,
  }
  isValid = false
  return { isValid, error }
}

// version checker
export function isEqualOrNewerVersion(oldVer: string, newVer: string): boolean {
  if (oldVer === newVer) {
    return true
  }
  const oldParts = oldVer.split('.')
  const newParts = newVer.split('.')
  for (let i = 0; i < newParts.length; i++) {
    // eslint-disable-next-line security/detect-object-injection
    const a = ~~newParts[i] // parse int
    if (oldParts.length <= i) return false
    // eslint-disable-next-line security/detect-object-injection
    const b = ~~oldParts[i] // parse int
    if (a > b) return true
    if (a < b) return false
  }
  return false
}

// adapted from stack overflow post
export function humanFileSize(size: number): string {
  const i = Math.max(size == 0 ? 0 : Math.floor(Math.log(size) / Math.log(1024)), 4)
  const value = Number(size / Math.pow(1024, i)).toFixed(2)
  // eslint-disable-next-line security/detect-object-injection
  return value + ' ' + ['B', 'kB', 'MB', 'GB', 'TB'][i]
}

export function fastIsPicked(ourIndex: number, groupSize: number, numToPick: number, offset = 0): boolean {
  let isPicked = false
  const fstride = groupSize / numToPick
  const finalOffset = ourIndex + offset
  let steps = finalOffset / fstride
  steps = Math.round(steps)
  const fendPoint = steps * fstride
  const endpoint = Math.round(fendPoint)
  if (endpoint === finalOffset) {
    isPicked = true
  }
  return isPicked
}

//Write a function that uses fastIsPicked to return an arrray of all the indexes that are picked
export function getIndexesPicked(groupSize: number, numToPick: number, offset = 0): number[] {
  const indexesPicked = []
  for (let i = 0; i < groupSize; i++) {
    if (fastIsPicked(i, groupSize, numToPick, offset)) {
      indexesPicked.push(i)
    }
  }
  return indexesPicked
}

//Selects a specific number of unique indexes from an array, starting at an offset and using a dynamic stride for spacing
export function selectIndexesWithOffeset(arraySize: number, numberToPick: number, offset: number): number[] {
  let currentIndex = mod(offset, arraySize)
  const strideAmount = Math.max(1, (offset + 1337) % Math.ceil(arraySize / numberToPick))
  const selectedIndexes = new Set<number>()

  while (selectedIndexes.size < numberToPick) {
    currentIndex += strideAmount
    if (currentIndex >= arraySize) {
      currentIndex -= arraySize
    }

    //linear probing if this index is already in the list.  This prevents being stuck forever
    //..assuming the input parameters are valid
    while (selectedIndexes.has(currentIndex)) {
      currentIndex++
      if (currentIndex >= arraySize) {
        currentIndex = 0
      }
    }

    selectedIndexes.add(currentIndex)
  }
  return Array.from(selectedIndexes)
}

/**
 * Try to print a variety of possible erros for debug purposes
 * @param err
 * @param printStack
 * @returns
 */
export function formatErrorMessage(err: unknown, printStack: boolean = true): string {
  let errMsg = 'An error occurred'

  if (typeof err === 'string') {
    errMsg = err
  } else if (err instanceof Error) {
    errMsg = err.message

    if (printStack && err.stack) {
      errMsg += ` \nStack trace:\n${err.stack}`
    }
  } else if (typeof err === 'object' && err !== null) {
    //chat gpt reccomended this fancy part but the linter doesn't like it

    // const keys = Object.keys(err)
    // if (keys.length > 0) {
    //   errMsg = 'Error properties:\n'
    //   const errObj = err as object
    //   for (const key of keys) {
    //     errMsg += `${key}: ${errObj[key]}\n`
    //   }
    // } else {
    errMsg = `Unknown error: ${JSON.stringify(err)}`
    // }
  } else {
    errMsg = `Unknown error: ${err}`
  }

  return errMsg
}

/**
 * checks if a hex-string is a valid shardus address by
 * checking if it's 64 chars long & 32-bytes in size
 */
export function isValidShardusAddress(hexStrings: string[]): boolean {
  for (let i = 0; i < hexStrings.length; i++) {
    // eslint-disable-next-line security/detect-object-injection
    if (!(hexStrings[i].length === 64) || !(Buffer.from(hexStrings[i], 'hex').length === 32)) return false
  }
  return true
}

export function logNode(node: P2P.NodeListTypes.Node): string {
  return `Node ID : ${node.id} Node Address : ${node.address} externalPort : ${node.externalPort} externalIP : ${node.externalIp}`
}

/**
 * Equivalent to .json() but gets the size for us
 * @param res
 * @param obj
 * @returns
 */
export function jsonHttpResWithSize(
  res: Response<unknown, Record<string, unknown>, number>,
  obj: object
): number {
  // res.setHeader('Content-Length', str.length)
  // res.setHeader('Content-Type', 'application/json')
  const str = safeStringify(obj)
  res.write(str)
  res.end()
  return str.length
}

/**
 * Returns a string for the given object, using the given keys, usually for logging and debugging purposes.
 * Keys can be null or undefined, in which case all keys are used.
 * Keys can be a single string of comma- or space-separated keys.
 * Keys can be an array of keys.
 * If the object is an array, the keys are applied to each element of the array.
 * Do not pass in data with circular references.
 * Does not throw exceptions which would be bad for logging, but instead returns a string with the exception info.
 * Examples:
 * stringForKeys(node, 'publicKey ip host')
 * stringForKeys(nodelist, 'publicKey ip host')
 */
export function stringForKeys(obj: unknown, keys: ArrayLike<string> | string | null = null): string {
  if (obj === undefined) return 'undefined'
  if (obj === null) return 'null'
  try {
    if (Array.isArray(obj)) return `[${obj.map((item) => stringForKeys(item, keys)).join(', ')}]`
    // at this point, obj is really an object
    if (keys == null) keys = Object.keys(obj)
    else if (typeof keys == 'string') keys = keys.split(/[ ,]+/)
    // justification for the suppression below: the keys are not originated by user input, but developer source code
    const items = Array.from(keys)
      .map((key) => (obj[key] === undefined ? 'undefined' : JSON.stringify(obj[key]))) // eslint-disable-line security/detect-object-injection
      .join(', ')
    return `{${items}}`
  } catch (e) {
    // throwing an exception would be bad for logging/debugging, so we just return a string
    let objStr: string
    try {
      objStr = JSON.stringify(obj)
    } catch (e) {
      objStr = '(stringForKeys(): exception for JSON.stringify())'
    }
    return `(stringForKeys(): exception: ${e}, obj: ${objStr})`
  }
}

export function getPrefixInt(hexAddress: string, length = 8): number {
  // if (hexAddress.length !== 64) {
  //   throw new Error("Input hex address should be exactly 64 characters long.");
  // }

  if (length < 1 || length > 8) {
    throw new Error("Length parameter should be between 1 and 8.");
  }

  const prefixHex = hexAddress.slice(0, length);
  const prefixInt = parseInt(prefixHex, 16);

  if (isNaN(prefixInt)) {
    throw new Error("Invalid hex characters in the input.");
  }

  return prefixInt;
}
