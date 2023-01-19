import { mod } from '../'

export function getLinearSeededGossip(nodeIdxs, myIdx, gossipFactor, startingSeed, seedFalloff, hop = 0) {
  const nodeCount = nodeIdxs.length
  const unique = []
  const gossipToList = []
  for (let i = 0; i < gossipFactor; i++) {
    gossipToList.push((gossipFactor * myIdx + i + 1) % nodeCount)
  }
  let extraFactor = startingSeed - hop * seedFalloff
  extraFactor = Math.min(extraFactor, nodeCount / 2)
  if (extraFactor > 0) {
    let i = 0
    let addedNode = 0
    while (addedNode < extraFactor && i < 2 * nodeCount) {
      const randomId = Math.floor(Math.random() * nodeCount)
      if (!gossipToList.includes(randomId)) {
        gossipToList.push(randomId)
        addedNode += 1
      }
      i += 1
    }
  }
  for (let i = 0; i < gossipToList.length; i++) {
    // eslint-disable-next-line security/detect-object-injection
    const next = gossipToList[i]
    if (next === myIdx) {
      continue
    } // make sure we don't send to self
    if (unique.includes(next)) {
      continue
    } // make sure we send only once
    unique.push(next)
  }
  return unique
}

function gossip_factor(n, f, i) {
  let fb
  fb = Math.floor(3 * Math.log2(n))
  if (fb + f > n) {
    fb = n - f - 0
  }
  if (fb > 20) {
    fb = 20
  }
  const r = n - i * fb
  if (r < fb) {
    fb = r
  }
  if (fb < 0) {
    fb = 0
  }
  fb += f - 1
  return fb
}

function gossip_offset(n, f, i) {
  let fb, r
  if (n < 2) {
    return i
  }
  fb = Math.floor(3 * Math.log2(n))
  if (fb + f > n) {
    fb = n - f - 0
  }
  if (fb > 20) {
    fb = 20
  }
  const j = Math.floor(n / fb)
  if (i <= j) {
    r = i * fb + i * (f - 1)
  } else {
    r = n + i * (f - 1)
  }
  return r
}

export function getLinearGossipBurstList(numberOfNodes, gossipFactor, myIdx, originIdx) {
  const list = []
  let offset, nodeIdx

  if (gossipFactor >= numberOfNodes) {
    gossipFactor = numberOfNodes - 1
  }

  const distance = mod(myIdx - originIdx, numberOfNodes)
  const factor0 = gossip_factor(numberOfNodes, gossipFactor, distance)
  offset = gossip_offset(numberOfNodes, gossipFactor, distance)
  offset = (originIdx + offset + 1) % numberOfNodes

  for (let i = 0; i < factor0; i++) {
    nodeIdx = (offset + i) % numberOfNodes
    // if (nodeIdx == myIdx) { continue }
    if (nodeIdx == myIdx) {
      offset += 1
      nodeIdx = (nodeIdx + 1) % numberOfNodes
    }
    list.push(nodeIdx)
  }
  return list
}

export function getLinearGossipList(numberOfNodes, gossipFactor, myIdx, isOrigin) {
  const list = []
  let nodeIdx
  if (gossipFactor >= numberOfNodes) {
    gossipFactor = numberOfNodes - 1
  }
  for (let k = 1; k <= gossipFactor; k++) {
    nodeIdx = (gossipFactor * myIdx + k) % numberOfNodes
    if (nodeIdx == myIdx) {
      continue
    }
    list.push(nodeIdx)
  }

  if (isOrigin) {
    // isOrigin is true if we are originating the gossip
    let originFactor: number = Math.floor(3 * Math.log2(numberOfNodes))
    if (originFactor + gossipFactor > numberOfNodes) {
      originFactor = numberOfNodes - gossipFactor - 1
    }
    if (originFactor > 20) {
      originFactor = 20
    }

    const offIdx = (gossipFactor * myIdx + 1) % numberOfNodes
    for (let k = 1; k <= originFactor; k++) {
      const nodeIdx = mod(offIdx - k, numberOfNodes)
      if (myIdx === nodeIdx) {
        continue
      }
      list.push(nodeIdx)
    }
  }
  return list
}

export function getRandomGossipIn(nodeIdxs, fanOut, myIdx) {
  const nn = nodeIdxs.length
  if (fanOut >= nn) {
    fanOut = nn - 1
  }
  if (fanOut < 1) {
    return []
  }
  const results = [(myIdx + 1) % nn]
  if (fanOut < 2) {
    return results
  }
  results.push((myIdx + nn - 1) % nn)
  if (fanOut < 3) {
    return results
  }
  while (results.length < fanOut) {
    const r = Math.floor(Math.random() * nn)
    if (r === myIdx) {
      continue
    }
    let k = 0
    for (; k < results.length; k++) {
      // eslint-disable-next-line security/detect-object-injection
      if (r === results[k]) {
        break
      }
    }
    if (k === results.length) {
      results.push(r)
    }
  }
  return results
}
