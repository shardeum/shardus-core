export function reversed<T>(thing: Iterable<T>) {
  const arr = Array.isArray(thing) ? thing : Array.from(thing)
  let i = arr.length - 1
  const reverseIterator = {
    next: () => {
      const done = i < 0
      // eslint-disable-next-line security/detect-object-injection
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
      // eslint-disable-next-line security/detect-object-injection
      const value = done ? undefined : arr[i]
      i--
      return { value, done }
    },
  }
  return {
    [Symbol.iterator]: () => reverseIterator,
  }
}
