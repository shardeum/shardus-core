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

/**
 * Creates a generator that yields the values of a given Map in random order.
 *
 * The function first creates an array of keys from the map, then shuffles 
 * this array using the Fisher-Yates algorithm. Finally, it yields the map's
 * values in the order of the shuffled keys. The original Map is not modified.
 *
 * Note: This function is not space efficient for large maps as it creates 
 * an additional array for the keys.
 *
 * @template K - The type of the keys of the map.
 * @template V - The type of the values of the map.
 * @param {Map<K, V>} map - The map whose values are to be yielded in random order.
 * @yields {V} - The next value from the map in random order.
 *
 * @example
 * let map = new Map<string, number>();
 * map.set('a', 1);
 * map.set('b', 2);
 * map.set('c', 3);
 * map.set('d', 4);
 * let iter = shuffleMapIterator(map);
 * for (let value of iter) {
 *     console.log(value);  // Prints values in random order
 * }
 */
export function* shuffleMapIterator<K, V>(map: Map<K, V>): IterableIterator<V> {
  // Create an array of keys from the map
  let keys = Array.from(map.keys());

  // Shuffle the keys array
  for (let i = keys.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [keys[i], keys[j]] = [keys[j], keys[i]];
  }

  // Yield values from the map in the order of the shuffled keys
  for (let key of keys) {
      yield map.get(key)!;
  }
}