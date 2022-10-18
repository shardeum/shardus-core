import { logFlags } from '../../logger'

type Comparator<T, E = T> = (a: E, b: T) => number

// From: https://stackoverflow.com/a/12646864
export function shuffleArray<T>(array: T[]) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[array[i], array[j]] = [array[j], array[i]]
  }
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

export function insertSorted<T>(arr: T[], item: T, comparator?: Comparator<T>) {
  let i = binarySearch(arr, item, comparator)
  if (i < 0) {
    i = -1 - i
  }
  arr.splice(i, 0, item)
}

/**
 * Binary find lowest
 * Returns the index of the lowest element in the array. The array is monotonically increasing to the right, but
 *     can have a break in the middle. For example
 * [ 5, 8, 1, 2, 4]
 * Notice the break is at index 1 when the value drops from 8 to 1, but is other increasing to the right
 * The index to be returned in this case is 2 which is the indes of the lowest value.
 * In the following example the index to be returned is also 2.
 * [ 5, 8, 1, 1, 4]
 * So when the lowest value is repeated we should return the indes of the left most lowest element.
 * In the following example the index to be returned is 0.
 * [ 2, 3, 5, 7, 8]
 * The simple way of doing this is to scan the whole array to find the left most lowest element.
 * However if the array is very long it is faster to use a binary search to find it.
 * This is used when we refresh nodes.
 *
 * Parameters:
 *     ar - A sorted array
 *     compare_fn - A comparator function. The function takes two arguments: (a, b) and returns:
 *        a positive number if a is greater than b.
 *        a negative number if a is less than b.
 *        0 if a is equal to b;
 * The array may contain duplicate elements. If there are more than one lowest elements in the array,
 * the returned value will be the index of the left most lowest element
 */
export function binaryLowest<T>(ar: T[], comparator?: Comparator<T>) {
  if (ar.length < 1) return -1
  if (comparator == null) {
    // Emulate the default Array.sort() comparator
    comparator = (a, b) => {
      return a > b ? 1 : a < b ? -1 : 0
    }
  }
  if (ar.length < 2) return 0
  let m = 0
  let n = ar.length - 1
  if (comparator(ar[m], ar[n]) < 0) return m
  while (m <= n) {
    const k = (n + m) >> 1
    const cmp = comparator(ar[m], ar[k])
    if (logFlags.console) console.log(ar)
    if (logFlags.console) console.log(m, k, ar[m], ar[k], cmp)
    if (cmp > 0) {
      n = k
    } else if (cmp < 0) {
      m = k
    } else {
      if (k + 1 === n) return n
      m = k
    }
  }
  return m
}

/**
 * Binary search in JavaScript.
 * Returns the index of of the element in a sorted array or (-n-1) where n is the insertion point for the new element.
 *   If the return value is negative use 1-returned as the insertion point for the element
 * Parameters:
 *     arr - A sorted array
 *     el - An element to search for
 *     compare_fn - A comparator function. The function takes two arguments: (el, ae) and returns:
 *       a negative number  if el is less than ae;
 *       a positive number if el is greater than ae.
 *       0 if el is equal to ae;
 *       note that el is the element we are searching for and ae is an array element from the sorted array
 * The array may contain duplicate elements. If there are more than one equal elements in the array,
 * the returned value can be the index of any one of the equal elements.
 *
 * @param arr
 * @param el
 * @param comparator
 */
export function binarySearch<T, E = Partial<T>>(arr: T[], el: E, comparator?: Comparator<T, typeof el>) {
  if (comparator == null) {
    // Emulate the default Array.sort() comparator
    comparator = (a, b) => {
      return a.toString() > b.toString() ? 1 : a.toString() < b.toString() ? -1 : 0
    }
  }
  let m = 0
  let n = arr.length - 1
  while (m <= n) {
    const k = (n + m) >> 1
    const cmp = comparator(el, arr[k])
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
