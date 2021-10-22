//import * as FastRandomIterator from "../../../src/utils/FastRandomIterator"
//import FastRandomIterator from "../../../src/utils/FastRandomIterator"
//import * as utils from '../utils'
const utils = require('../../../build/src/utils')
const FastRandomIterator = require('../../../build/src/utils/FastRandomIterator')

const Profiler = require('../../../build/src/utils/profiler')
const NestedCounters = require('../../../build/src/utils/nestedCounters')

function generateArray(size){
    
}



/////////Off topic hack test of some p2p code////////////
// let progress = []
// const progressHistory = 5
// const maxAttempts = 10
// let attempt = 0

// let newCounter = 60
// let oldCounter = 59

// for(let i=0; i<maxAttempts; i++ ){
//     progress[attempt % progressHistory] = newCounter - oldCounter
//     let res = progress.reduce((prev, curr) => prev + curr, 0)
//     console.log(`res: ${res}`)
//     if (res <= 0) {
//       //warn(`syncNewCycles: no progress in the last ${progressHistory} attempts`)
//       console.log('oops')
//       return
//     }
//     attempt++
// }
// return

////////////////

NestedCounters.nestedCountersInstance = new NestedCounters.default()
let profiler = new Profiler.default()

profiler.profileSectionStart('testTotal')

function unitTest(testSize, redunancy, passedRedundancy=-1){
    let iterate
    for(let y = 0; y <10; y++){
        iterate = new FastRandomIterator.default(testSize, passedRedundancy)
        let outputArray = []
        let nextIndex = 0
        while(nextIndex >= 0){
            nextIndex = iterate.getNextIndex()
            if(nextIndex >= 0){
                outputArray.push(nextIndex)
            }
        }   
        //console.log(utils.stringifyReduce(outputArray))
        if(outputArray.length != testSize){
            console.log("failed length")
        }
        // if(y === 0)
        //     console.log(utils.stringifyReduce(outputArray))

        outputArray.sort((a,b)=> a-b )
        // if(y === 0)
        //     console.log(utils.stringifyReduce(outputArray))
    
        for(let k = 0; k < testSize; k++){
            if(outputArray[k] != k){
                console.log("failed index")
                throw Error("failed")
            }
        }
    }
    console.log(`unit test passed: ${iterate.debugGetMode()}  array size:${testSize} picks:${redunancy}`)
}

// let testSize = 1019//200
// let redunancy = 3

unitTest(1019, 3 , 3) //previously this broke the calculations
unitTest(101, 101, 101)
unitTest(1010, 11, 11)
unitTest(5, 5, -1)
unitTest(101, 101, -1)

let perfTestArraySize = 10000
let sampleTestSize = 20 //50
let randomTestList = new Array(perfTestArraySize)
let sparseActivated = false
//randomTestList.fill({ar: new Array(10).fill({foo:"someObject", asdf:1, asdf2:3})})

randomTestList.fill({a:1})

function RandomShuffle1(){
    let copy = randomTestList.slice()
    utils.shuffleArray(copy)
    let sum = 0
    for(let i=0; i<sampleTestSize; i++){
        let picked = copy[i]
        sum += picked
    }
}

function RandomShuffleFast(){
    let iterate = new FastRandomIterator.default(perfTestArraySize, -1 , -1)
    let nextIndex = 0
    let sum = 0
    for(let i=0; i<sampleTestSize; i++){
        nextIndex = iterate.getNextIndex()
        sum += nextIndex
    }
}

function RandomShuffleFastSimple(){
    let iterate = new FastRandomIterator.default(perfTestArraySize,-1, 1000000)
    let nextIndex = 0
    let sum = 0
    for(let i=0; i<sampleTestSize; i++){
        nextIndex = iterate.getNextIndex()
        sum += nextIndex
    }
}

function RandomShuffleSparseManual(){
    let picked = new Set()
    let nextIndex = 0
    let arraySize = perfTestArraySize
    let sum = 0
    for(let i=0; i<sampleTestSize; i++){
        let iteratorIndex = i
        let randomFetchIndex = Math.floor(Math.random() * (arraySize))//Math.floor(Math.random() * (arraySize - iteratorIndex)) + iteratorIndex
        while(picked.has(randomFetchIndex)){
            randomFetchIndex = Math.floor(Math.random() * (arraySize))//Math.floor(Math.random() * (arraySize - iteratorIndex)) + iteratorIndex
        }
        picked.add(randomFetchIndex)
        sum += randomFetchIndex
    }
}

function RandomShuffleSparse(){
    //this only activates sparse some of the time.. 
    let iterate = new FastRandomIterator.default(perfTestArraySize,sampleTestSize, 1000000)
    let nextIndex = 0
    let sum = 0
    for(let i=0; i<sampleTestSize; i++){
        nextIndex = iterate.getNextIndex()
        sum += nextIndex
    }

    sparseActivated = (iterate.sparseSet != null)
}


// par tests.
let par = sampleTestSize
let arraySize = perfTestArraySize
let strideSize = -1
let minStrideSize = 10
let maxStrideSize = 100
if (strideSize < 0) {
    strideSize = arraySize / 100
  }
  if (strideSize < minStrideSize) {
    strideSize = minStrideSize
  }
  if (strideSize > maxStrideSize) {
    strideSize = maxStrideSize
  }

this.strideSize = Math.floor(strideSize)

let rating = (par * (strideSize / arraySize))
console.log(`par:${par} rating:${rating}   ${rating >= 1} `)

//perf tests
let testLoops = 1000
profiler.profileSectionStart('RandomShuffle-array.shuffle')
for(let i=0; i<testLoops; i++){
    RandomShuffle1()
    RandomShuffle1()
    RandomShuffle1()
    RandomShuffle1()
    RandomShuffle1()
}
profiler.profileSectionEnd('RandomShuffle-array.shuffle')

profiler.profileSectionStart('FastRandomIterator-Fast')
for(let i=0; i<testLoops; i++){
    RandomShuffleFast()
    RandomShuffleFast()
    RandomShuffleFast()
    RandomShuffleFast()
    RandomShuffleFast()
}
profiler.profileSectionEnd('FastRandomIterator-Fast')

profiler.profileSectionStart('FastRandomIterator-FastSimple')
for(let i=0; i<testLoops; i++){
    RandomShuffleFastSimple()
    RandomShuffleFastSimple()
    RandomShuffleFastSimple()
    RandomShuffleFastSimple()
    RandomShuffleFastSimple()
}
profiler.profileSectionEnd('FastRandomIterator-FastSimple')


profiler.profileSectionStart('manual-Sparse')
for(let i=0; i<testLoops; i++){
    RandomShuffleSparseManual()
    RandomShuffleSparseManual()
    RandomShuffleSparseManual()
    RandomShuffleSparseManual()
    RandomShuffleSparseManual()
}
profiler.profileSectionEnd('manual-Sparse')

profiler.profileSectionStart('FastRandomIterator-Sparse')
for(let i=0; i<testLoops; i++){
    RandomShuffleSparse()
    RandomShuffleSparse()
    RandomShuffleSparse()
    RandomShuffleSparse()
    RandomShuffleSparse()
}
profiler.profileSectionEnd('FastRandomIterator-Sparse')


profiler.profileSectionEnd('testTotal')

console.log(profiler.printAndClearReport())

console.log(`arraySize:${perfTestArraySize} numPicks:${sampleTestSize}  testIterationsPerType:${testLoops * 5} sparseActivated:${sparseActivated} `)
