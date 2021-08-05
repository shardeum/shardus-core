export function isUndefined(thing: unknown) {
  return typeof thing === 'undefined'
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
