import { NodeInfo } from './p2p-types'

export type QueryFunction = (node: NodeInfo) => Promise<unknown>

export type VerifyFunction = (result: unknown) => boolean

export interface SequentialQueryError {
  node: NodeInfo
  error: Error
  response?: unknown
}

export interface SequentialQueryResult {
  result: unknown
  errors: SequentialQueryError[]
}

export async function sequentialQuery(
  nodes: NodeInfo[],
  queryFn: QueryFunction,
  verifyFn: VerifyFunction = () => true
): Promise<SequentialQueryResult> {
  nodes = [...nodes]
  shuffleArray(nodes)

  let result
  const errors: SequentialQueryError[] = []

  for (const node of nodes) {
    try {
      const response = await queryFn(node)
      if (verifyFn(response) === false) {
        errors.push({
          node,
          error: new Error('Response failed verifyFn'),
          response,
        })
        continue
      }
      result = response
    } catch (error) {
      errors.push({
        node,
        error,
      })
    }
  }

  return {
    result,
    errors,
  }
}

// From: https://stackoverflow.com/a/12646864
export function shuffleArray<T>(array: T[]) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[array[i], array[j]] = [array[j], array[i]]
  }
}

export function reversed<T>(thing: Iterable<T>) {
  const arr = Array.isArray(thing) ? thing : Array.from(thing)
  let i = arr.length - 1
  const reverseIterator = {
    next: () => {
      const done = i < 0
      const value = done ? undefined : arr[i]
      i--
      return { value, done }
    },
  }
  return {
    [Symbol.iterator]: () => reverseIterator,
  }
}
