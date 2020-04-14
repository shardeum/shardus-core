import util from 'util'
import * as utils from '../utils'
import * as Network from '../network'

export type QueryFunction<Node, Response> = (node: Node) => Promise<Response>

export type VerifyFunction<Result> = (result: Result) => boolean

export type EqualityFunction<Value> = (val1: Value, val2: Value) => boolean

export interface SequentialQueryError<Node> {
  node: Node
  error: Error
  response?: unknown
}

export interface SequentialQueryResult<Node> {
  result: unknown
  errors: Array<SequentialQueryError<Node>>
}

export async function sequentialQuery<Node = unknown, Response = unknown>(
  nodes: Node[],
  queryFn: QueryFunction<Node, Response>,
  verifyFn: VerifyFunction<Response> = () => true
): Promise<SequentialQueryResult<Node>> {
  nodes = [...nodes]
  shuffleArray(nodes)

  let result: Response
  const errors: Array<SequentialQueryError<Node>> = []

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

export async function robustQuery<Node = unknown, Response = unknown>(
  nodes: Node[] = [],
  queryFn: QueryFunction<Node, Response>,
  equalityFn: EqualityFunction<Response> = util.isDeepStrictEqual,
  redundancy = 3,
  shuffleNodes = true
) {
  if (nodes.length === 0) throw new Error('No nodes given.')
  if (typeof queryFn !== 'function') {
    throw new Error(`Provided queryFn ${queryFn} is not a valid function.`)
  }
  if (redundancy < 1) redundancy = 3
  if (redundancy > nodes.length) redundancy = nodes.length

  class Tally {
    winCount: number
    equalFn: EqualityFunction<Response>
    items: Array<{
      value: Response
      count: number
      nodes: Node[]
    }>
    constructor(winCount: number, equalFn: EqualityFunction<Response>) {
      this.winCount = winCount
      this.equalFn = equalFn
      this.items = []
    }
    add(newItem: Response, node: Node) {
      // We search to see if we've already seen this item before
      for (const item of this.items) {
        // If the value of the new item is not equal to the current item, we continue searching
        if (!this.equalFn(newItem, item.value)) continue
        // If the new item is equal to the current item in the list,
        // we increment the current item's counter and add the current node to the list
        item.count++
        item.nodes.push(node)
        // Here we check our win condition if the current item's counter was incremented
        // If we meet the win requirement, we return an array with the value of the item,
        // and the list of nodes who voted for that item
        if (item.count >= this.winCount) {
          return [item.value, item.nodes]
        }
        // Otherwise, if the win condition hasn't been met,
        // We return null to indicate no winner yet
        return null
      }
      // If we made it through the entire items list without finding a match,
      // We create a new item and set the count to 1
      this.items.push({ value: newItem, count: 1, nodes: [node] })
      // Finally, we check to see if the winCount is 1,
      // and return the item we just created if that is the case
      if (this.winCount === 1) return [newItem, [node]]
    }
    getHighestCount() {
      if (!this.items.length) return 0
      let highestCount = 0
      for (const item of this.items) {
        if (item.count > highestCount) {
          highestCount = item.count
        }
      }
      return highestCount
    }
  }
  const responses = new Tally(redundancy, equalityFn)
  let errors = 0

  nodes = [...nodes]
  if (shuffleNodes === true) {
    shuffleArray(nodes)
  }
  const nodeCount = nodes.length

  const queryNodes = async (nodes: Node[]) => {
    // Wrap the query so that we know which node it's coming from
    const wrappedQuery = async node => {
      const response = await queryFn(node)
      return { response, node }
    }

    const rejectQuery = async node => {
      const response = 'Tried to query self'
      return { response, node }
    }

    // We create a promise for each of the first `redundancy` nodes in the shuffled array
    const queries = []
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]

      // Return a bogus response if you tried to query yourself
      const ourExternalIp = Network.ipInfo.externalIp
      const ourExternalPort = Network.ipInfo.externalPort
      const ourInternalIp = Network.ipInfo.externalIp
      const outInternalPort = Network.ipInfo.externalPort
      if (node && node['ip'] && node['port']) {
        if (node['ip'] === ourExternalIp && node['port'] === ourExternalIp) {
          console.log('DBG', 'TRIED TO ROBUSTQUERY SELF', node)
          queries.push(rejectQuery(node))
          continue
        }
      }
      if (node && node['externalIp'] && node['externalPort']) {
        if (node['externalIp'] === ourExternalIp && node['externalPort'] === ourExternalPort) {
          console.log('DBG', 'TRIED TO ROBUSTQUERY SELF', node)
          queries.push(rejectQuery(node))
          continue
        }
      }
      if (node && node['internalIp'] && node['internalPort']) {
        if (node['internalIp'] === ourInternalIp && node['internalPort'] === outInternalPort) {
          console.log('DBG', 'TRIED TO ROBUSTQUERY SELF', node)
          queries.push(rejectQuery(node))
          continue
        }
      }

      queries.push(wrappedQuery(node))
    }
    const [results, errs] = await utils.robustPromiseAll(queries)

    let finalResult
    for (const result of results) {
      const { response, node } = result
      finalResult = responses.add(response, node)
      if (finalResult) break
    }

    for (const err of errs) {
      console.log('p2p/Utils:robustQuery:queryNodes:', err)
      errors += 1
    }

    if (!finalResult) return null
    return finalResult
  }

  let finalResult = null
  while (!finalResult) {
    const toQuery = redundancy - responses.getHighestCount()
    if (nodes.length < toQuery) break
    const nodesToQuery = nodes.splice(0, toQuery)
    finalResult = await queryNodes(nodesToQuery)
  }
  if (finalResult) {
    return finalResult
  }

  // TODO: Don't throw an error, should just return what had the most
  throw new Error(
    `Could not get ${redundancy} ${
      redundancy > 1 ? 'redundant responses' : 'response'
    } from ${nodeCount} ${
      nodeCount !== 1 ? 'nodes' : 'node'
    }. Encountered ${errors} query errors.`
  )
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
