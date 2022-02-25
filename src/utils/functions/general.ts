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

// @param {LiteralObject} `obj` object to be genrate schema for
// @return {LiteralObject} will return schema object
// This function generate a schema (object) of the object it has been fed
export function generateObjectSchema(obj) {
  const schema = {}

  if (Array.isArray(obj)) {
    throw new Error(
      'Object schema generation function does not accept array as argument'
    )
  }

  for (const [key, value] of Object.entries(obj)) {
    if (obj.hasOwnProperty(key) && obj[key] !== null) {
      if (value.constructor === Object) {
        schema[key] = generateObjectSchema(value)
      } else if (Array.isArray(value)) {
        schema[key] = generateArraySchema(value)
      } else {
        schema[key] = typeof value
      }
    }
  }
  return schema
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
// [new Date(), 'false', 1]     -> 'any[]'
export function generateArraySchema(arr: unknown[]): string {
  let schema: string

  for (let i = 0; i < arr.length; i++) {
    // let's return 'any' when array is holding multiple types 
    if (i > 0 && arr[i].constructor !== arr[i - 1].constructor) {
      return 'any[]'
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
  }

  return schema
}

// @param {LiteralObject} idol, This is the object the function will hold standard to
// @param {LiteralObject} admirer, This is the object the function compare against standard object idol
// Note: these positional parameter matter at which position the object is passed to
// This first parameter idol object will be idolized 
// and the function will determine if the second parameter (admirer) object fit the idolized object schema
// Example if idol is { id: [1, false, 'str'] } ( schema will be { id: 'any[]' } )
// and admirer is { id: ['str', 'str'] } (schema will be { id: 'string[]' } )
// the function will returns true
// The function will returns an error object if you switch position in parameter of the same two object
export function compareObjectShape(idol, admirer) {
  let isValid
  let error
  let defectoChain = []

  const idol_schema = generateObjectSchema(idol)
  const admirer_schema = generateObjectSchema(admirer)

  if (JSON.stringify(idol_schema) === JSON.stringify(admirer_schema)){
    isValid = true
    return { isValid, error }
  }

  // this function compare prop types
  // this function is not meant to be call outside of this block
  const smartComparator = (idol_type, admirer_type) => {
    if (typeof idol_type === 'object' && idol_type.constructor === Object) {
      return JSON.stringify(idol_type) === JSON.stringify(admirer_type)
    } else if (idol_type === 'any[]' && typeof admirer_type === 'string' && admirer_type.includes('[]')) {
      return true
    } else {
      return idol_type === admirer_type
    }
  }

  // this function is not meant to be call outside of this block
  // worshipped represent idolized schema
  // worshipper represent admirer's schema
  const defectoHunter = (worshipped, worshipper) => {
    const l1 = Object.keys(worshipped).length
    const l2 = Object.keys(worshipper).length

    //this variable represent whichever object that has the most properpties(key)
    const bigger_obj = l1 >= l2 ? worshipped : worshipper

    for (const key in bigger_obj) {
      const DEFECTOR_FOUND =
        smartComparator(worshipped[key], worshipper[key]) === false

      if (DEFECTOR_FOUND) {
        // save the path to the prop , Example: ['server', 'log']
        defectoChain.push(key)
        if (worshipped.hasOwnProperty(key) && worshipped[key].constructor === Object) {
          return defectoHunter(worshipped[key], worshipper[key])
        } else {
          return { [key]: worshipper[key] }
        }
      }
    }
    // when no defective is found
    return false
  }

  error = {
    defectiveProp: defectoHunter(idol_schema, admirer_schema),
    defectiveChain: defectoChain,
  }

  // couldn't find defective
  if (error.defectiveProp === false) {
    defectoChain = []
    isValid = true
    error = undefined
  } else {
    isValid = false
  }

  return { isValid, error }
}
