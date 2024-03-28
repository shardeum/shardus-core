/**
 * Transforms all `bigint` values in an object to strings in hexadecimal format.
 * This type recursively walks through the object, converting `bigint` to `string`.
 *
 * @template T - The type of the input object.
 */
export type BigIntToString<T> =
  T extends bigint ? string :
    T extends object ? { [K in keyof T]: BigIntToString<T[K]> } :
      T;

/**
 * Creates a deep clone of the input object and transforms all `bigint` values to strings in hexadecimal format.
 * This function is safe to use with objects containing circular references.
 *
 * @template T - The type of the input object.
 * @param {T} original - The object to clone and transform.
 * @returns {BigIntToString<T>} A new object with all `bigint` values converted to hex strings.
 */
export function cloneAndTransformBigIntsToHex<T>(original: T): BigIntToString<T> {
  const cloned = structuredClone(original);
  _transformBigIntsToHexInPlace(cloned);
  return cloned as BigIntToString<T>;
}

/**
 * Transforms all `bigint` values in an object to strings in hexadecimal format in place.
 * This is the public function intended for external use. It wraps `transformBigIntsToHexInPlace` to hide complexity.
 *
 * @param {any} obj - The object to transform in place. All `bigint` values will be converted to hex strings.
 */
export function transformBigIntsToHex(obj: any): void {
  _transformBigIntsToHexInPlace(obj, new WeakSet());
}

/**
 * Transforms all `bigint` values in an object to strings in hexadecimal format in place.
 * This function is safe to use with objects containing circular references.
 * It is designed to be called internally by `cloneAndTransformBigIntsToHex` or through its wrapper `transformBigIntsToHex`.
 *
 * @param {any} obj - The object to transform in place.
 * @param {WeakSet} [visited=new WeakSet()] - A set of already visited objects to handle circular references.
 */
function _transformBigIntsToHexInPlace(obj: any, visited = new WeakSet()): void {
  if (visited.has(obj)) {
    return;
  }

  if (typeof obj === 'object' && obj !== null) {
    visited.add(obj);

    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'bigint') {
        obj[key] = `0x${value.toString(16)}`;
      } else if (typeof value === 'object' && value !== null) {
        _transformBigIntsToHexInPlace(value, visited);
      }
    }
  }
}
