/*eslint-disable*/

var fs = require('fs')
var path = require('path')
const StateManager = require('../../../src/state-manager')

let stateManager = new StateManager(false)

let testInput = null
try {
  var localDir = path.resolve('./test/unit/state-manager/')
  var data = fs.readFileSync(path.join(localDir, 'debugInput2.txt'), 'utf8')
  //console.log(data)

  testInput = JSON.parse(data)
} catch (e) {
  console.log('Error:', e.stack)
}

console.count('asdf')

// (repairTracker, ourPartitionObj, ourLastResultHash, ourHashSet,  txListOverride
stateManager._mergeRepairDataIntoLocalState2(
  testInput.repairTracker,
  null,
  null,
  testInput.ourHashSet,
  testInput.txList
)

console.count('asdf')

// keep this
