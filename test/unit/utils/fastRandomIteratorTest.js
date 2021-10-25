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
unitTest(1, 1, 1)
unitTest(1, 1, -1)

let perfTestArraySize = 50000
let sampleTestSize = 100 //50

let sparseActivated = false
//randomTestList.fill({ar: new Array(10).fill({foo:"someObject", asdf:1, asdf2:3})})
let randomTestList = new Array(perfTestArraySize)
randomTestList.fill({a:1})

function BuiltIn_ArrayShuffle(){
    let copy = randomTestList.slice() //have to copy the array to not mutate it! (alternative would be to create an array in indexes)
    utils.shuffleArray(copy)
    let sum = 0
    for(let i=0; i<sampleTestSize; i++){
        let picked = copy[i]
        sum += picked
    }
}

function FastRandomIterator_ForcedFast(){
    //this will force it to fast.  kinda hacky
    let iterate = new FastRandomIterator.default(perfTestArraySize, -1 , -1)
    let nextIndex = 0
    let sum = 0
    for(let i=0; i<sampleTestSize; i++){
        nextIndex = iterate.getNextIndex()
        sum += nextIndex
    }
}

function FastRandomIterator_ForcedFastSimple(){
    //this will force it to fastSimple.  kinda hacky
    let iterate = new FastRandomIterator.default(perfTestArraySize,-1, 1000000)
    let nextIndex = 0
    let sum = 0
    for(let i=0; i<sampleTestSize; i++){
        nextIndex = iterate.getNextIndex()
        sum += nextIndex
    }
}

function Random_LocalSparse(){
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

function FastRandomIterator_Auto(){
    let iterate = new FastRandomIterator.default(perfTestArraySize,sampleTestSize)
    let nextIndex = 0
    let sum = 0
    for(let i=0; i<sampleTestSize; i++){
        nextIndex = iterate.getNextIndex()
        sum += nextIndex
    }
}
function FastRandomIterator_GetAutoType(){
    let iterate = new FastRandomIterator.default(perfTestArraySize,sampleTestSize)
    return iterate.debugGetMode()
}


function FastRandomIterator_ForcedSparse(){
    //this only activates sparse some of the time.. 
    let iterate = new FastRandomIterator.default(perfTestArraySize,sampleTestSize, 1000000)
    iterate.debugForceSparse()
    let nextIndex = 0
    let sum = 0
    for(let i=0; i<sampleTestSize; i++){
        nextIndex = iterate.getNextIndex()
        sum += nextIndex
    }

    sparseActivated = (iterate.sparseSet != null)
}

function randomIteratorInit_Don(size){
    Replace = new Map()
    Size = size
}

function randomIterator_Don(){
    var i, r, last
    if (Size == 0){ return -1 }
    r = Math.floor(Math.random() * Size)
    i = r
    Size -= 1
    if (Replace.has(r)){
        r = Replace.get(r)
    }
    last = Size
    if (Replace.has(last)){ last = Replace.get(last) }
    Replace.set(i, last)
    return r
}

function RandomIterator_Don(){
    var Size = 0
    var Replace = new Map()
    let arraySize = perfTestArraySize
    randomIteratorInit_Don(arraySize)
    let sum = 0
    for(let i=0; i<sampleTestSize; i++){
        let picked = randomIterator_Don()
        sum += picked //sum is used in every test to make sure that the index is used in some way
    }
}


function isPrime(num) {
    let sq_root = Math.sqrt(num);
    for(let i = 2; i <= sq_root; i++) {
        if (num % i == 0) {
            return 0;
        }
    }
    return 1;
}
let largerPrime = new Map()
function primeLargerThan(num) {
    let input = num

    if(largerPrime.has(input)){
        return largerPrime.get(input)
    }

    do {
        num++;    // you want to find a prime number greater than the argument  
    } while (!isPrime(num)) 
    largerPrime.set(input, num) 
    return num
}


function PrimeNumberIterator(){
    //this only activates sparse some of the time.. 
    let arraySize = perfTestArraySize
    let P = primeLargerThan(arraySize)
    let N = perfTestArraySize
    m = 8; // multiplier 1 to N-1
    t = 5; // offset  0 to N-1

    let nextIndex = 0
    let sum = 0
    for(let i=0; i<sampleTestSize; i++){
        //for(i=0;i<N;i++){
            r = i;
            do{
                r = (m*r + t)%P;
            } while(r >= N);
            //console.log(i, r);
        //}
        nextIndex = r
        sum += nextIndex
    }

}

// N = 12; // Size of array
// P = 13; // Lowest prime > N

// // m and t can be picked randomly
// m = 8; // multiplier 1 to N-1
// t = 5; // offset  0 to N-1

// for(i=0;i<N;i++){
//   r = i;
//   do{
//     r = (m*r + t)%P;
//   } while(r >= N);
//   console.log(i, r);
// }



// perf test
// let par = sampleTestSize
// let arraySize = perfTestArraySize
// old par work
// let strideSize = -1
// let minStrideSize = 10
// let maxStrideSize = 100
// if (strideSize < 0) {
//     strideSize = arraySize / 100
//   }
//   if (strideSize < minStrideSize) {
//     strideSize = minStrideSize
//   }
//   if (strideSize > maxStrideSize) {
//     strideSize = maxStrideSize
//   }

// this.strideSize = Math.floor(strideSize)

// let rating = (par * (strideSize / arraySize))
// console.log(`par:${par} rating:${rating}   ${rating >= 1} `)

function forceGC(){
    try {
        if (global.gc) {global.gc();}
    } catch (e) {
        console.log("`node --expose-gc index.js`");
        //process.exit();
    }
}


function RunPerfTests(arrayCount, arrayPicks){

    NestedCounters.nestedCountersInstance = new NestedCounters.default()
    let profiler = new Profiler.default()

    perfTestArraySize = arrayCount
    sampleTestSize = arrayPicks
    let testLoops = 1000
    //profiler.profileSectionStart('testTotal')
    randomTestList = new Array(perfTestArraySize)
    randomTestList.fill({a:1})


    console.log(`\narraySize:${perfTestArraySize} numPicks:${sampleTestSize}  testIterationsPerType:${testLoops * 5}:`)

    //perf tests
    forceGC()

    profiler.profileSectionStart('RandomShuffle-array.shuffle()')
    for(let i=0; i<testLoops; i++){
        BuiltIn_ArrayShuffle()
        BuiltIn_ArrayShuffle()
        BuiltIn_ArrayShuffle()
        BuiltIn_ArrayShuffle()
        BuiltIn_ArrayShuffle()
    }
    profiler.profileSectionEnd('RandomShuffle-array.shuffle()')

    forceGC()

    profiler.profileSectionStart('FastRandomIterator-Fast')
    for(let i=0; i<testLoops; i++){
        FastRandomIterator_ForcedFast()
        FastRandomIterator_ForcedFast()
        FastRandomIterator_ForcedFast()
        FastRandomIterator_ForcedFast()
        FastRandomIterator_ForcedFast()
    }
    profiler.profileSectionEnd('FastRandomIterator-Fast')

    forceGC()

    profiler.profileSectionStart('FastRandomIterator-FastSimple')
    for(let i=0; i<testLoops; i++){
        FastRandomIterator_ForcedFastSimple()
        FastRandomIterator_ForcedFastSimple()
        FastRandomIterator_ForcedFastSimple()
        FastRandomIterator_ForcedFastSimple()
        FastRandomIterator_ForcedFastSimple() //FastRandomIterator_ForcedFastSimple
    }
    profiler.profileSectionEnd('FastRandomIterator-FastSimple')

    forceGC()

    // sort of a control case 
    // profiler.profileSectionStart('manual-Sparse')
    // for(let i=0; i<testLoops; i++){
    //     Random_LocalSparse()
    //     Random_LocalSparse()
    //     Random_LocalSparse()
    //     Random_LocalSparse()
    //     Random_LocalSparse()
    // }
    // profiler.profileSectionEnd('manual-Sparse')

    // forceGC()

    profiler.profileSectionStart('FastRandomIterator-Sparse')
    for(let i=0; i<testLoops; i++){
        FastRandomIterator_ForcedSparse()
        FastRandomIterator_ForcedSparse()
        FastRandomIterator_ForcedSparse()
        FastRandomIterator_ForcedSparse()
        FastRandomIterator_ForcedSparse()
    }
    profiler.profileSectionEnd('FastRandomIterator-Sparse')

    forceGC()
    
    let autoType = FastRandomIterator_GetAutoType()
    profiler.profileSectionStart('FastRandomIterator-Auto:'+autoType)
    for(let i=0; i<testLoops; i++){
        FastRandomIterator_Auto()
        FastRandomIterator_Auto()
        FastRandomIterator_Auto()
        FastRandomIterator_Auto()
        FastRandomIterator_Auto()
    }
    profiler.profileSectionEnd('FastRandomIterator-Auto:'+autoType)
    
    forceGC()

    profiler.profileSectionStart('RandomIterator_Don')
    for(let i=0; i<testLoops; i++){
        RandomIterator_Don()
        RandomIterator_Don()
        RandomIterator_Don()
        RandomIterator_Don()
        RandomIterator_Don()
    }
    profiler.profileSectionEnd('RandomIterator_Don')

    forceGC()

    profiler.profileSectionStart('PrimeNumberIterator')
    for(let i=0; i<testLoops; i++){
        PrimeNumberIterator()
        PrimeNumberIterator()
        PrimeNumberIterator()
        PrimeNumberIterator()
        PrimeNumberIterator()
    }
    profiler.profileSectionEnd('PrimeNumberIterator')
    
    forceGC()
    //profiler.profileSectionEnd('testTotal')

    console.log(profiler.printAndClearReport())

    //console.log(`arraySize:${perfTestArraySize} numPicks:${sampleTestSize}  testIterationsPerType:${testLoops * 5} sparseActivated:${sparseActivated} `)
}


RunPerfTests(50000, 100)
RunPerfTests(50000, 5)
RunPerfTests(500, 100)
RunPerfTests(500, 500)
RunPerfTests(1000000, 100)
