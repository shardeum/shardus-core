export function removeNodesByID(nodes, ids) {
  if (!Array.isArray(ids)) {
    return nodes
  }
  return nodes.filter((node) => ids.indexOf(node.id) === -1)
}
