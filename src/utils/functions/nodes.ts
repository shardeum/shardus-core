import { Node } from "../../shardus/shardus-types"

export function removeNodesByID(nodes, ids): Node[] {
  if (!Array.isArray(ids)) {
    return nodes
  }
  return nodes.filter((node) => ids.indexOf(node.id) === -1)
}
