export const deepCopy = (obj) => {
  if (typeof obj !== 'object') {
    throw Error('Given element is not of type object.')
  }
  return JSON.parse(JSON.stringify(obj))
}

export const mod = (n, m) => {
  return ((n % m) + m) % m
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

export const debugExpand = (value: string) => {
  let res = value.slice(0, 4) + '0'.repeat(55) + value.slice(5, 5 + 5)
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

export function errorToStringFull(error){
  return `${error.name}: ${error.message} at ${error.stack}`
}


export function sumObject(sumObject, toAddObject){
  for (const [key, val] of Object.entries(sumObject)) {
    let otherVal = toAddObject[key]
    if(otherVal == null){
      continue
    }
    switch (typeof val) {
      case 'number':
        sumObject[key] = val + otherVal
        break
      default:
        break
    }
  }
}
