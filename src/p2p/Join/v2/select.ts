/**
  * This module contains the logic for selecting the nodes that will be allowed
  * to join the network.
  */

import { getAllJoinRequestsMap, getStandbyNodesInfoMap } from ".";
import { calculateToAccept, computeSelectionNum } from "..";

const selectedPublicKeys: Set<string> = new Set();

export function executeNodeSelection(): void {
  const numToAccept = calculateToAccept()
  console.log(`selecting ${numToAccept} nodes to accept`)
  selectNodes(numToAccept)
}

/**
  * Selects the nodes to be allowed to join. 
  * Iterates through all standby nodes and pick the best ones by their scores
  * (`selectionNum`)
  *
  * @returns The list of public keys of the nodes that have been selected.
  */
export function selectNodes(maxAllowed: number): void {
  const standbyNodesInfo = getStandbyNodesInfoMap()
  const joinRequests = getAllJoinRequestsMap()
  console.log("selecting from standbyNodesInfo", standbyNodesInfo)
  console.log("selecting from joinRequests", joinRequests)

  // construct a list of objects that we'll sort by `selectionNum`. we'll use
  // the public key to get the join request associated with the public key and
  // inform the node later that it has been accepted
  const objs: { publicKey: string, selectionNum: string }[] = []
  for (const publicKey of standbyNodesInfo.keys()) {
    const joinRequest = joinRequests.get(publicKey)

    console.log("computing selection number for", publicKey)
    const selectionNumResult = computeSelectionNum(joinRequest)
    if (selectionNumResult.isErr()) {
      console.error(`failed to compute selection number for node ${publicKey}:`, JSON.stringify(selectionNumResult.error))
      continue
    }
    objs.push({ publicKey, selectionNum: selectionNumResult.value })
  }

  // sort the objects by their selection numbers
  objs.sort((a, b) =>
    a.selectionNum < b.selectionNum ? 1 : a.selectionNum > b.selectionNum ? -1 : 0)

  // add as many keys as we're allowed to the set
  while (selectedPublicKeys.size < maxAllowed && objs.length > 0)
    selectedPublicKeys.add(objs.splice(0, 1)[0].publicKey)
}


/**
  * Returns the list of public keys of the nodes that have been selected and
  * empties the list.
  */
export function drainSelectedPublicKeys(): string[] {
  const tmp = [...selectedPublicKeys.values()]
  selectedPublicKeys.clear()
  return tmp
}
