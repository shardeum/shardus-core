//import * as FastRandomIterator from "../../../src/utils/FastRandomIterator"
//import FastRandomIterator from "../../../src/utils/FastRandomIterator"
//import * as utils from '../utils'
const utils = require('../../../build/src/utils')
const FastRandomIterator = require('../../../build/src/utils/FastRandomIterator')

const Profiler = require('../../../build/src/utils/profiler')
const NestedCounters = require('../../../build/src/utils/nestedCounters')

function generateArray(size){
    
}

NestedCounters.nestedCountersInstance = new NestedCounters.default()
let profiler = new Profiler.default()

profiler.profileSectionStart('testTotal')

function unitTest(){
    let testSize = 200
    for(let y = 0; y <10; y++){
        let iterate = new FastRandomIterator.default(testSize)
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
        outputArray.sort((a,b)=> a-b )
        if(y === 0)
            console.log(utils.stringifyReduce(outputArray))
    
        for(let k = 0; k < testSize; k++){
            if(outputArray[k] != k){
                console.log("failed index")
                break
            }
        }
    }
    console.log("unit test ended")
}

unitTest()



let perfTestArraySize = 5000
let sampleTestSize = 50
let randomTestList = new Array(perfTestArraySize)
//randomTestList.fill({ar: new Array(10).fill({foo:"someObject", asdf:1, asdf2:3})})

randomTestList.fill({a:1})

function RandomShuffle1(){
    let copy = randomTestList.slice()
    utils.shuffleArray(copy)
}

function RandomShuffleFast(){
    let iterate = new FastRandomIterator.default(perfTestArraySize, -1 , -1)
    let nextIndex = 0
    for(let i=0; i<sampleTestSize; i++){
        nextIndex = iterate.getNextIndex()
    }
}

function RandomShuffleFastSimple(){
    let iterate = new FastRandomIterator.default(perfTestArraySize,-1, 1000000)
    let nextIndex = 0
    for(let i=0; i<sampleTestSize; i++){
        nextIndex = iterate.getNextIndex()
    }
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
profiler.profileSectionStart('RandomShuffle1')
for(let i=0; i<testLoops; i++){
    RandomShuffle1()
    RandomShuffle1()
    RandomShuffle1()
    RandomShuffle1()
    RandomShuffle1()
}
profiler.profileSectionEnd('RandomShuffle1')

profiler.profileSectionStart('RandomShuffleFast')
for(let i=0; i<testLoops; i++){
    RandomShuffleFast()
    RandomShuffleFast()
    RandomShuffleFast()
    RandomShuffleFast()
    RandomShuffleFast()
}
profiler.profileSectionEnd('RandomShuffleFast')

profiler.profileSectionStart('RandomShuffleFastSimple')
for(let i=0; i<testLoops; i++){
    RandomShuffleFastSimple()
    RandomShuffleFastSimple()
    RandomShuffleFastSimple()
    RandomShuffleFastSimple()
    RandomShuffleFastSimple()
}
profiler.profileSectionEnd('RandomShuffleFastSimple')


profiler.profileSectionEnd('testTotal')

console.log(profiler.printAndClearReport())