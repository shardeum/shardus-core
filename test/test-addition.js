const utils = require('../src/utils')

const DESIRED = 100
const PERCENT_DELTA_ALLOWED = 30

async function main () {
  let totalNodes = 0
  let totalCycles = 0
  while (totalNodes < DESIRED) {
    let delta = DESIRED - totalNodes
    let toAdd = Math.floor((PERCENT_DELTA_ALLOWED / 100) * delta)
    if (toAdd < 1) toAdd = 1
    console.log(`To add: ${toAdd}`)
    totalNodes = totalNodes + toAdd
    console.log(`Total nodes: ${totalNodes}`)
    totalCycles += 1
    console.log(`Total cycles: ${totalCycles}`)
    await utils.sleep(1000)
  }
}

main()
