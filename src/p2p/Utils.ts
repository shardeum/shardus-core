import util from 'util'
import * as utils from '../utils'
import * as Network from '../network'

export type QueryFunction<Node, Response> = (node: Node) => Promise<Response>

export type VerifyFunction<Result> = (result: Result) => boolean

export type EqualityFunction<Value> = (val1: Value, val2: Value) => boolean

export type CompareFunction<Result> = (result: Result) => Comparison

export enum Comparison {
  BETTER,
  EQUAL,
  WORSE,
  ABORT 
}

export interface CompareQueryError<Node> {
  node: Node
  error: string
}

export type CompareFunctionResult<Node> = Array<CompareQueryError<Node>>

export interface SequentialQueryError<Node> {
  node: Node
  error: Error
  response?: unknown
}

export interface SequentialQueryResult<Node> {
  result: unknown
  errors: Array<SequentialQueryError<Node>>
}

export async function compareQuery<Node = unknown, Response = unknown>(
  nodes: Node[],
  queryFn: QueryFunction<Node, Response>,
  compareFn: CompareFunction<Response>,
  matches: number
): Promise<CompareFunctionResult<Node>> {
  let abort: boolean
  let startOver: boolean
  let errors: Array<CompareQueryError<Node>>
  let matched: number

  do {
    abort = false
    startOver = false
    errors = []
    matched = 0

    for (const node of nodes) {
      try {
        const response = await queryFn(node)

        switch (compareFn(response)) {
          case Comparison.BETTER:
            // We start over
            startOver = true
            break
          case Comparison.EQUAL:
            matched++
            if (matched >= matches) return errors
            break
          case Comparison.WORSE:
            // Try the next one
            break
          case Comparison.ABORT:
            // End everything and return 
            abort = true
            break
          default:
        }

        if (abort) break
        if (startOver) break
      } catch (error) {
        errors.push({
          node,
          error: JSON.stringify(error, Object.getOwnPropertyNames(error)),
        })
      }
    }
  } while (startOver)

  return errors
}

export async function sequentialQuery<Node = unknown, Response = unknown>(
  nodes: Node[],
  queryFn: QueryFunction<Node, Response>,
  verifyFn: VerifyFunction<Response> = () => true
): Promise<SequentialQueryResult<Node>> {
  nodes = [...nodes]
  utils.shuffleArray(nodes)

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

type TallyItem = 
{
  value: any // Response type is from a template
  count: number
  nodes: any[] // Shardus.Node[] Not using this because robustQuery uses a generic Node, maybe it should be non generic?
};

type RobustQueryResult = 
{
  topResult: any;
  winningNodes: any[];
  isRobustResult: boolean
}

/**
 * [TODO] robustQuery should handle being given an enourmous node list (Dont copy and shuffle it)
 * 
 * TODO replace console.log with a specific log funtion.
 * 
 * Note -
 * robustQuery should NOT be given a node list that includes yourself (Use NodeList.activeOthersByIdOrder).
 * OR
 * the queryFunction can return null if the node being queried is Self.id
 *
 * @param nodes
 * @param queryFn
 * @param equalityFn
 * @param redundancy
 * @param shuffleNodes
 */
export async function robustQuery<Node = unknown, Response = unknown>(
  nodes: Node[] = [],
  queryFn: QueryFunction<Node, Response>,
  equalityFn: EqualityFunction<Response> = util.isDeepStrictEqual,
  redundancy = 3,
  shuffleNodes = true,
  strictRedundancy = false
) : Promise<RobustQueryResult>
 {
  if (nodes.length === 0) throw new Error('No nodes given.')
  if (typeof queryFn !== 'function') {
    throw new Error(`Provided queryFn ${queryFn} is not a valid function.`)
  }
  // let originalRedundancy = redundancy
  if (redundancy < 1) {
    redundancy = 3
  }
  if (redundancy > nodes.length) {
    if(strictRedundancy){
      console.log(`robustQuery: isRobustResult=false. not enough nodes to meet strictRedundancy`)
      return {topResult: null, winningNodes: [], isRobustResult: false}
    }
    redundancy = nodes.length
  }

  class Tally {
    winCount: number
    equalFn: EqualityFunction<Response>
    items: TallyItem[]
    constructor(winCount: number, equalFn: EqualityFunction<Response>) {
      this.winCount = winCount
      this.equalFn = equalFn
      this.items = []
    }

    add(response: Response, node: Node) : TallyItem | null  {
      if (response === null) return null
      // We search to see if we've already seen this item before
      for (const item of this.items) {
        // If the value of the new item is not equal to the current item, we continue searching
        if (!this.equalFn(response, item.value)) continue
        // If the new item is equal to the current item in the list,
        // we increment the current item's counter and add the current node to the list
        item.count++
        item.nodes.push(node)
        // Here we check our win condition if the current item's counter was incremented
        // If we meet the win requirement, we return an array with the value of the item,
        // and the list of nodes who voted for that item
        if (item.count >= this.winCount) {
          return item
        }
        // Otherwise, if the win condition hasn't been met,
        // We return null to indicate no winner yet
        return null
      }
      // If we made it through the entire items list without finding a match,
      // We create a new item and set the count to 1
      let newItem = { value: response, count: 1, nodes: [node] }
      this.items.push(newItem)
      // Finally, we check to see if the winCount is 1,
      // and return the item we just created if that is the case
      if (this.winCount === 1) return newItem //return [newItem, [node]]
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
    getHighestCountItem() : TallyItem | null {
      if (!this.items.length) return null
      let highestCount = 0
      let highestIndex = 0
      let i = 0
      for (const item of this.items) {
        if (item.count > highestCount) {
          highestCount = item.count
          highestIndex = i
        }
        i += 1
      }
      return this.items[highestIndex]
    }
  }
  const responses = new Tally(redundancy, equalityFn)
  let errors = 0

  // [TODO] - Change the way we shuffle the array.
  //     This is not scaleable, if the size of the nodes array is over 100 we should create an array of
  //     indexes and shuffle that. Or maybe use a function that treats the array as a ring and starts at
  //     a random offset in the ring and a random direction. Or use a function that visits every element
  //     in the array once in a random order.
  // APF: I wrote up a fast way to pay for a random sort only as you need the next element.
  //      will go back later to add this. several spots in our code could use it.
  //      this also will save considerable memory
  nodes = [...nodes]
  if (shuffleNodes === true) {
    utils.shuffleArray(nodes)
  }

  const nodeCount = nodes.length

  const queryNodes = async (nodes: Node[]): Promise<TallyItem | null> => {
    // Wrap the query so that we know which node it's coming from
    const wrappedQuery = async node => {
      const response = await queryFn(node)
      return { response, node }
    }

    // We create a promise for each of the first `redundancy` nodes in the shuffled array
    const queries = []
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]
      queries.push(wrappedQuery(node))
    }
    const [results, errs] = await utils.robustPromiseAll(queries)

    let finalResult : TallyItem
    for (const result of results) {
      const { response, node } = result
      if (responses === null) continue  // ignore null response; can be null if we tried to query ourself
      finalResult = responses.add(response, node)
      if (finalResult) break
    }

    for (const err of errs) {
      console.log('robustQuery: queryNodes:', err)
      errors += 1
    }

    if (!finalResult) return null
    return finalResult
  }

  let finalResult : TallyItem = null
  let tries = 0
  while (!finalResult) {
    tries += 1
    const toQuery = redundancy - responses.getHighestCount()
    if (nodes.length < toQuery){
      console.log('robustQuery: stopping since we ran out of nodes to query.')
      break
    }
    const nodesToQuery = nodes.splice(0, toQuery)
    finalResult = await queryNodes(nodesToQuery)
    if (tries>=20){
      console.log('robustQuery: stopping after 20 tries.')
      break
    }
  }
  if (finalResult) {
    let isRobustResult = finalResult.count >= redundancy
    // console.log(`robustQuery: stopping since we got a finalResult:${JSON.stringify(finalResult)}`)
    return {topResult: finalResult.value, winningNodes: finalResult.nodes, isRobustResult}
  }
  else{
  // Note:  We return the item that had the most nodes reporting it. However, the caller should know
  //        The calling code can now check isRobustResult to see if a topResult is valid
    console.log(
    `robustQuery: Could not get ${redundancy} ${
      redundancy > 1 ? 'redundant responses' : 'response'
    } from ${nodeCount} ${
      nodeCount !== 1 ? 'nodes' : 'node'
    }. Encountered ${errors} query errors.`
    )
    console.trace()
    let highestCountItem = responses.getHighestCountItem()
    if(highestCountItem === null){
      //if there was no highestCountItem then we had no responses at all
      console.log(`robustQuery: isRobustResult=false. no responses at all`)
      return {topResult: null, winningNodes: [], isRobustResult: false}
    }
    //this isRobustResult should always be false if we get to this code.
    let isRobustResult = highestCountItem.count >= redundancy
    console.log(`robustQuery: isRobustResult=false. returning highest count response`)
    return {topResult: highestCountItem.value, winningNodes: highestCountItem.nodes, isRobustResult}
  }

  // NOTE: this function does not throw errors for situations where we don't have enough responses.
  // instead we return a structured result with enough information about how the query worked.
  // throwing errors was causing problems in past testing.
  // it is OK to throw errors for stuff that is an unexected code mistake in cases where the code would 
  //   fail right away.
}
