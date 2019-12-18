
const StateManager = require('../../../src/state-manager')

const crypto = require('shardus-crypto-utils')
const utils = require('../../../src/utils')

const Profiler = require('../../../src/utils/profiler.js')
let profiler = new Profiler()
// const utils = require('../../../utils')

// / <reference types='../../../src/state-manager' />
/**
 * @typedef {import('../../../src/state-manager').GenericHashSetEntry} GenericHashSetEntry
 */

/** @type {GenericHashSetEntry[]} */
let hashSetList = []
/** @type {GenericHashSetEntry[]} */
let hashSetList2 = []

function generateVariants (numElements, elementSizeInBytes, numVariants, lossRate) {
  let results = new Array(numVariants + 2)
  let key = []

  let fullString = crypto.randomBytes(numElements * elementSizeInBytes)
  let dupeCheck = {}
  let dupeCount = 0
  for (let j = 0; j < numVariants + 2; ++j) {
    results[j] = []
  }

  for (let i = 0; i < numElements; ++i) {
    let votes = 0

    let msg = fullString.slice(i * elementSizeInBytes * 2, i * elementSizeInBytes * 2 + elementSizeInBytes * 2)

    if (dupeCheck[msg] != null) {
      dupeCount++
    }
    dupeCheck[msg] = true

    for (let j = 0; j < numVariants; ++j) {
      let rand = Math.random()
      if (lossRate > rand) {
        continue
      }
      let resultArray = results[j]
      votes++
      resultArray.push(msg)
    }

    if (votes >= numVariants * 0.625) {
      results[numVariants].push(msg)
      results[numVariants + 1].push(msg)
    } else {
      results[numVariants + 1].push('__'.repeat(elementSizeInBytes))
    }
  }

  return { results, key, dupeCount }
}

// function dupeCount(list){
//   let dupeCheck = {}
//   let dupeCount = 0
//   for(let val in list){
//     if(dupeCheck[val] != null){
//       dupeCount++
//     }
//     dupeCheck[val] = true
//   }
//   return dupeCount
// }

// Generate test sets with known perfect answers.
// compare old vs. new algorithm.
// evaluate repair instructions.

// hashSetList.push(/** @type {GenericHashSetEntry} */{ hash: 'b1', votePower: 1, hashSet: '94e384c2faea3b762d3c858568ec6933d1a08f55f3bd036f7768675f5d79f3c86f9a93bfba4f99b69159d71cae6c4d0da8391ad262b7', lastValue: '', errorStack: [], corrections: [], indexOffset: 0, waitForIndex: -1 })
// hashSetList.push(/** @type {GenericHashSetEntry} */{ hash: 'b2', votePower: 100, hashSet: '9abc94e384c2faea3b762d3c858568ec6933d1a08f55f3bd036f7768675f5d79f3c86f9a93bfba4f99b69159d71cae6c4d0da8391ad2', lastValue: '', errorStack: [], corrections: [], indexOffset: 0, waitForIndex: -1 })

// let output = StateManager.solveHashSets(hashSetList, 10)

// hashSetList2.push(/** @type {GenericHashSetEntry} */{ hash: 'b4', votePower: 1, hashSet: '9abc94e384c2faea3b762d3c858568ec6933d1a08f55f3bd036f7768675f5d79f3c86f9a93bfba4f99b69159d71cae6c4d0da8391ad2', lastValue: '', errorStack: [], corrections: [], indexOffset: 0, waitForIndex: -1 })
// hashSetList2.push(/** @type {GenericHashSetEntry} */{ hash: 'forced', votePower: 1000, hashSet: '9abc94e384c2faea3b762d3c858568ec6933d1a08f55f3bd036f7768675f5d79f3c86f9a93bfba4f99b69159d71cae6c4d0da8391ad262b7', lastValue: '', errorStack: [], corrections: [], indexOffset: 0, waitForIndex: -1 })

// some test code to make sure solveHashSets2 works good.
// let output3 = StateManager.solveHashSets2(hashSetList2, 40, 0.625, output)
// let output2 = StateManager.solveHashSets(hashSetList2, 40, 0.625, output)

let useDataRes = false
let extendedValidation = true

let log = false
let hashBytesSize = 2
let testLoops = 100
let oldWins = 0
let newWins = 0
let passedIndexApplicationNew = 0
let numVariants = 20
let failedWithDupes = 0
let passedWithDupes = 0
let failed = 0
for (let testIdx = 0; testIdx < testLoops; ++testIdx) {
  hashSetList = []

  let res = null // generateVariants(1000, 16, numVariants, 0.41)

  // @ts-ignore
  if (useDataRes === false) {
    res = generateVariants(2000, hashBytesSize, numVariants, 0.03)
  } else {
    res = JSON.parse('{"results":[["281a7958d02fc91cb3a812ff442de707","3b0e241e4c39a66e823cc503ae00ef44","6cb1270c8ff38aecaa34a79403c0c2f7","55403088d5636488d3ff17d7d90c052e","1054295199c9e0021b60624e06e5bbef","7083d528b2f48e19a6b06d9bec7e6746","3b4f8edc1e1664785018db142da8d490","2b9b723ffda79294df9f7111580c1103","fe18f9e937ad612f1246c26d5da4c910","c31cd675319677309f726bb4ef492001","8ed3461bcd80517eec52618202b3c3e7","800b3975d690b20aa2e5858aa6cc412d","5df063cb219cfe31701479786a1f879d","da210d7a649543b1d2b4aa8142f38022","53912f96abf0da3f26e807e8bef79ef3","445750581958cc0e9c9755f7f8482784","54d3396c139c0a6c2a2c83555e6fa72f","eb0796baa8e1f5fe23ba0cf5b016c7b8","3197cc220e454797b0e9a2567d58d4e1","7a067a906112b0de0d1fd8abe10c05e5","8c91523b12cb3d3c3ce1602d630625e1","051a8e6fc91f117ed453884491907d8d","d4193394bd55cd4ce57f819c8f6c495e","bc02704b00503c3795da26b93556c743","11ce62fc6e1875b3a8e3a4b11672c4e5"],["281a7958d02fc91cb3a812ff442de707","3b0e241e4c39a66e823cc503ae00ef44","6cb1270c8ff38aecaa34a79403c0c2f7","1153af4fe3dae8b50f754a0aed53ff7d","779980ea84b8a5eac2dc3d07013377e5","55403088d5636488d3ff17d7d90c052e","7083d528b2f48e19a6b06d9bec7e6746","3b4f8edc1e1664785018db142da8d490","2b9b723ffda79294df9f7111580c1103","fe18f9e937ad612f1246c26d5da4c910","c31cd675319677309f726bb4ef492001","d88e97556cce2be87593f88c39aa353a","8ed3461bcd80517eec52618202b3c3e7","da210d7a649543b1d2b4aa8142f38022","53912f96abf0da3f26e807e8bef79ef3","445750581958cc0e9c9755f7f8482784","54d3396c139c0a6c2a2c83555e6fa72f","eb0796baa8e1f5fe23ba0cf5b016c7b8","3197cc220e454797b0e9a2567d58d4e1","7a067a906112b0de0d1fd8abe10c05e5","8c91523b12cb3d3c3ce1602d630625e1","051a8e6fc91f117ed453884491907d8d","d4193394bd55cd4ce57f819c8f6c495e","bc02704b00503c3795da26b93556c743","11ce62fc6e1875b3a8e3a4b11672c4e5"],["281a7958d02fc91cb3a812ff442de707","6cb1270c8ff38aecaa34a79403c0c2f7","1153af4fe3dae8b50f754a0aed53ff7d","779980ea84b8a5eac2dc3d07013377e5","55403088d5636488d3ff17d7d90c052e","1054295199c9e0021b60624e06e5bbef","7083d528b2f48e19a6b06d9bec7e6746","3b4f8edc1e1664785018db142da8d490","2b9b723ffda79294df9f7111580c1103","fe18f9e937ad612f1246c26d5da4c910","c31cd675319677309f726bb4ef492001","1b78c74d6179b449f54d74b490cb463c","d88e97556cce2be87593f88c39aa353a","8ed3461bcd80517eec52618202b3c3e7","800b3975d690b20aa2e5858aa6cc412d","5df063cb219cfe31701479786a1f879d","da210d7a649543b1d2b4aa8142f38022","53912f96abf0da3f26e807e8bef79ef3","445750581958cc0e9c9755f7f8482784","54d3396c139c0a6c2a2c83555e6fa72f","eb0796baa8e1f5fe23ba0cf5b016c7b8","3197cc220e454797b0e9a2567d58d4e1","7a067a906112b0de0d1fd8abe10c05e5","8c91523b12cb3d3c3ce1602d630625e1","051a8e6fc91f117ed453884491907d8d","d4193394bd55cd4ce57f819c8f6c495e","07cf8492a0df5aae182979be0ab73758","11ce62fc6e1875b3a8e3a4b11672c4e5"],["281a7958d02fc91cb3a812ff442de707","3b0e241e4c39a66e823cc503ae00ef44","6cb1270c8ff38aecaa34a79403c0c2f7","1153af4fe3dae8b50f754a0aed53ff7d","779980ea84b8a5eac2dc3d07013377e5","55403088d5636488d3ff17d7d90c052e","1054295199c9e0021b60624e06e5bbef","7083d528b2f48e19a6b06d9bec7e6746","3b4f8edc1e1664785018db142da8d490","2b9b723ffda79294df9f7111580c1103","fe18f9e937ad612f1246c26d5da4c910","c31cd675319677309f726bb4ef492001","d88e97556cce2be87593f88c39aa353a","8ed3461bcd80517eec52618202b3c3e7","800b3975d690b20aa2e5858aa6cc412d","5df063cb219cfe31701479786a1f879d","da210d7a649543b1d2b4aa8142f38022","53912f96abf0da3f26e807e8bef79ef3","445750581958cc0e9c9755f7f8482784","54d3396c139c0a6c2a2c83555e6fa72f","eb0796baa8e1f5fe23ba0cf5b016c7b8","3197cc220e454797b0e9a2567d58d4e1","7a067a906112b0de0d1fd8abe10c05e5","8c91523b12cb3d3c3ce1602d630625e1","051a8e6fc91f117ed453884491907d8d","d4193394bd55cd4ce57f819c8f6c495e","bc02704b00503c3795da26b93556c743"],["281a7958d02fc91cb3a812ff442de707","3b0e241e4c39a66e823cc503ae00ef44","6cb1270c8ff38aecaa34a79403c0c2f7","1153af4fe3dae8b50f754a0aed53ff7d","779980ea84b8a5eac2dc3d07013377e5","55403088d5636488d3ff17d7d90c052e","1054295199c9e0021b60624e06e5bbef","7083d528b2f48e19a6b06d9bec7e6746","3b4f8edc1e1664785018db142da8d490","2b9b723ffda79294df9f7111580c1103","fe18f9e937ad612f1246c26d5da4c910","c31cd675319677309f726bb4ef492001","d88e97556cce2be87593f88c39aa353a","8ed3461bcd80517eec52618202b3c3e7","800b3975d690b20aa2e5858aa6cc412d","5df063cb219cfe31701479786a1f879d","da210d7a649543b1d2b4aa8142f38022","53912f96abf0da3f26e807e8bef79ef3","445750581958cc0e9c9755f7f8482784","54d3396c139c0a6c2a2c83555e6fa72f","eb0796baa8e1f5fe23ba0cf5b016c7b8","3197cc220e454797b0e9a2567d58d4e1","7a067a906112b0de0d1fd8abe10c05e5","8c91523b12cb3d3c3ce1602d630625e1","051a8e6fc91f117ed453884491907d8d","d4193394bd55cd4ce57f819c8f6c495e","bc02704b00503c3795da26b93556c743","11ce62fc6e1875b3a8e3a4b11672c4e5"],["281a7958d02fc91cb3a812ff442de707","3b0e241e4c39a66e823cc503ae00ef44","6cb1270c8ff38aecaa34a79403c0c2f7","1153af4fe3dae8b50f754a0aed53ff7d","779980ea84b8a5eac2dc3d07013377e5","55403088d5636488d3ff17d7d90c052e","1054295199c9e0021b60624e06e5bbef","7083d528b2f48e19a6b06d9bec7e6746","3b4f8edc1e1664785018db142da8d490","2b9b723ffda79294df9f7111580c1103","fe18f9e937ad612f1246c26d5da4c910","c31cd675319677309f726bb4ef492001","________________________________","d88e97556cce2be87593f88c39aa353a","8ed3461bcd80517eec52618202b3c3e7","800b3975d690b20aa2e5858aa6cc412d","5df063cb219cfe31701479786a1f879d","da210d7a649543b1d2b4aa8142f38022","53912f96abf0da3f26e807e8bef79ef3","445750581958cc0e9c9755f7f8482784","54d3396c139c0a6c2a2c83555e6fa72f","eb0796baa8e1f5fe23ba0cf5b016c7b8","3197cc220e454797b0e9a2567d58d4e1","7a067a906112b0de0d1fd8abe10c05e5","8c91523b12cb3d3c3ce1602d630625e1","051a8e6fc91f117ed453884491907d8d","d4193394bd55cd4ce57f819c8f6c495e","bc02704b00503c3795da26b93556c743","________________________________","11ce62fc6e1875b3a8e3a4b11672c4e5"]],"key":[]}')
    // for (let result of res.results) {
    //   console.log(JSON.stringify(result))
    // }
    numVariants = res.results.length - 2
  }
  if (log) {
    for (let result of res.results) {
      console.log(JSON.stringify(result))
    }
  }
  for (let i = 0; i < numVariants; ++i) {
    let msgList = res.results[i]
    hashSetList.push(/** @type {GenericHashSetEntry} */{ hash: `node${i}`, votePower: 1, hashSet: msgList.join(''), lastValue: '', errorStack: [], corrections: [], indexOffset: 0, waitForIndex: -1, ownVotes: [] })
  }

  let solutionHashSet = /** @type {GenericHashSetEntry} */{ hash: `solution`, votePower: 1, hashSet: res.results[numVariants].join(''), lastValue: '', errorStack: [], corrections: [], indexOffset: 0, waitForIndex: -1, ownVotes: [] }

  profiler.profileSectionStart('solveHashSets')
  let output = [] // StateManager.solveHashSets(hashSetList)
  profiler.profileSectionEnd('solveHashSets')

  // StateManager.solveHashSets(hashSetList)

  if (log) {
    for (let hashSetEntry of hashSetList) {
      console.log(JSON.stringify(hashSetEntry))
    }
    console.log(JSON.stringify(output))
    console.log(JSON.stringify(res.results[numVariants + 1]))
    console.log(JSON.stringify(res.results[numVariants]))
  }

  profiler.profileSectionStart('solveHashSets2')
  let output2 = StateManager.solveHashSets2(hashSetList)
  profiler.profileSectionEnd('solveHashSets2')
  if (log)console.log(JSON.stringify(output2))

  let realResults = res.results[numVariants].join('')
  let oldRes = output.join('')
  let newRes = output2.join('')

  if (realResults === oldRes) {
    oldWins++
  }
  if (realResults === newRes) {
    newWins++

    if (extendedValidation) {
      for (let testIdx = 0; testIdx < numVariants; ++testIdx) {
        // let testIdx = 2
        StateManager.expandIndexMapping(hashSetList[testIdx], output)
        // console.log(`indexMap:${hashSetList[testIdx].indexMap} extraMap:${hashSetList[testIdx].extraMap}`)
        let result = StateManager.testHashsetSolution(hashSetList[testIdx], solutionHashSet)

        if (result) {
          passedIndexApplicationNew++
        }
      }

      // break
    }
    if (res.dupeCount > 0) {
      passedWithDupes++
    }
    
  } else {
    failed++
    if (res.dupeCount > 0) {
      failedWithDupes++
    }

    // @ts-ignore
    // if (useDataRes === false) {
    //   console.log('dumping test set.')
    //   console.log(JSON.stringify(res))
    //   break
    // } else {
    //   console.log('dumping output2.')
    //   console.log(JSON.stringify(output2))
    //   break
    // }
  }

  // let hashSetEntry = hashSetList[2]
  // console.log(`corrections: ${JSON.stringify(hashSetEntry.corrections)}`)
}

console.log(`oldwins:${oldWins},  newwins:${newWins}    passedIndexApplicationNew:${passedIndexApplicationNew / (numVariants * 1.00)} failed:${failed} failedWithDupes:${failedWithDupes} passedWithDupes:${passedWithDupes}`)
profiler.printAndClearReport()
// StateManager.expandIndexMapping(hashSetList[0], output)
// if (hashSetList2.length > 0) {
//   StateManager.expandIndexMapping(hashSetList2[0], output)
// }

// console.log(JSON.stringify(hashSetList[0].indexMap))
// hashSetList[0].extraMap.sort(function (a, b) { return a - b })

// console.log(JSON.stringify(hashSetList[0].extraMap))
// if (hashSetList2.length > 0) {
//   hashSetList2[0].extraMap.sort(function (a, b) { return a - b })
//   console.log(JSON.stringify(hashSetList2[0].indexMap))
//   console.log(JSON.stringify(hashSetList2[0].extraMap))
// }

// let hashSet = ''
// for (let hash of output) {
//   hashSet += hash
// }
// console.log('solution:  ' + (hashSet.length / 2) + ' ' + hashSet)
// if (hashSetList2.length > 0) {
//   let hashSet2 = ''
//   for (let hash of output2) {
//     hashSet2 += hash
//   }
//   console.log('solution2: ' + (hashSet2.length / 2) + ' ' + hashSet2)
// }
// StateManager.testHashsetSolution(hashSetList2[0], hashSetList2[1])
