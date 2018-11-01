class State {
  constructor (crypto) {
    this.crypto = crypto
    this.nodes = {}
    this.cycles = []
  }

  /* addNode (node) {

  } */

  /* addNodes (nodes) {
    for (const node of nodes) {
      this.addNode(node)
    }
  } */

  /* getNodes () {
    return this.nodes
  } */

  getCycleMarker () {
    // should return null if no cycle markers yet
    return this.crypto.hash({ bla: 'kek' }) // This should be removed once cycles are actually implemented
    // return this.cycles[this.cycles.length - 1].cycleMarker
  }
}

module.exports = State
