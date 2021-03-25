const minStrideSize = 10
const maxStrideSize = 100

class FastRandomIterator {
  strideSize: number
  indexStrides: Map<number, number[]>
  arraySize: number
  iteratorIndex: number

  indexList: number[] = null

  constructor(arraySize: number, strideSize: number = -1) {
    this.iteratorIndex = 0
    this.arraySize = arraySize

    if (arraySize < 100 || strideSize > arraySize) {
      this.indexList = new Array(arraySize)
      for (let i = 0; i < arraySize; ++i) {
        this.indexList[i] = i
      }
    } else {
      this.indexStrides = new Map()
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

      // let firstStride = new Array(this.strideSize)
      // for (let i = 0; i < this.strideSize; ++i) {
      //   firstStride[i] = i
      // }
      // this.indexStrides.set(0, firstStride)


    }
  }

  getNextIndex(): number {
    if(this.iteratorIndex >= this.arraySize){
      return -1
    }

    let randomFetchIndex =
      Math.floor(Math.random() * (this.arraySize - this.iteratorIndex )) + this.iteratorIndex

    let nextIndex
    if (this.indexList != null) {
      
      nextIndex = this.indexList[randomFetchIndex]
      let indexValueToSwap = this.indexList[this.iteratorIndex]
      this.indexList[randomFetchIndex] = indexValueToSwap

      this.iteratorIndex++
      return nextIndex

    } else {
      let currentStrideKey = Math.floor(this.iteratorIndex / this.strideSize)
      let hasCurrentStride = this.indexStrides.has(currentStrideKey)
      let currentStrideStart = currentStrideKey * this.strideSize

      let currentStride : number[]
      if (hasCurrentStride === false) {
        // fill a new stride
        currentStride = new Array(this.strideSize)
        for (let i = 0; i < this.strideSize; ++i) {
          currentStride[i] = i + currentStrideStart
        }
        this.indexStrides.set(currentStrideKey, currentStride)
      } else {
        currentStride = this.indexStrides.get(currentStrideKey)
      }


      let fetchStrideKey = Math.floor(randomFetchIndex / this.strideSize)
      let fetchStrideStart = fetchStrideKey * this.strideSize
      let hasFetchStride = this.indexStrides.has(fetchStrideKey)
      let fetchStride : number[]
      if (hasFetchStride === false) {
        // fill a new stride
        fetchStride = new Array(this.strideSize)
        for (let i = 0; i < this.strideSize; ++i) {
          fetchStride[i] = i + fetchStrideStart
        }
        this.indexStrides.set(fetchStrideKey, fetchStride)
      } else {
        fetchStride = this.indexStrides.get(fetchStrideKey)
      }
      
      let fetchStrideLocalDestIndex = randomFetchIndex - fetchStrideStart
      nextIndex = fetchStride[fetchStrideLocalDestIndex]

      let indexValueToSwap = currentStride[this.iteratorIndex - currentStrideStart]
      fetchStride[fetchStrideLocalDestIndex] = indexValueToSwap

      this.iteratorIndex++
      return nextIndex
    }
  }
}

export default FastRandomIterator
