export function transformBigIntsToHex(obj: any, visited = new WeakSet()): any {
  if (typeof obj === 'bigint') {
    return `0x${obj.toString(16)}`
  } else if (Array.isArray(obj)) {
    if (visited.has(obj)) {
      return '[Circular]'
    }
    visited.add(obj)
    return obj.map((item) => transformBigIntsToHex(item, visited))
  } else if (obj !== null && typeof obj === 'object') {
    if (visited.has(obj)) {
      return '[Circular]'
    }
    visited.add(obj)
    const result = {}
    for (const [key, value] of Object.entries(obj)) {
      result[key] = transformBigIntsToHex(value, visited)
    }
    return result
  } else {
    return obj
  }
}
