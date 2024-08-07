export function isUndefined(thing: unknown): boolean {
  return typeof thing === 'undefined';
}

export const isObject = (val): boolean => {
  if (val === null) {
    return false;
  }
  if (Array.isArray(val)) {
    return false;
  }
  return typeof val === 'function' || typeof val === 'object';
};

export const isString = (x): boolean => {
  return Object.prototype.toString.call(x) === '[object String]';
};

export const isNumeric = (x): boolean => {
  return isNaN(x) === false;
};
