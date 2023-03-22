const minStrideSize = 10
const maxStrideSize = 100

export default class FastRandomIterator {
  strideSize: number
  indexStrides: { [key: number]: number[] } //Map<number, number[]>
  arraySize: number
  iteratorIndex: number

  indexList: number[] = null

  sparseSet: Set<number> = null

  constructor(arraySize: number, par = -1, strideSize = -1) {
    this.iteratorIndex = 0
    this.arraySize = arraySize

    let parForcesSimpleMode = false
    if (par > 0) {
      if (arraySize / par > 100) {
        this.sparseSet = new Set()
        return //use the simple sparse mode
      }
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

      //let forceSimpleCalc = (par * (strideSize / arraySize)) // using stride size was too complicated..
      const forceSimpleCalc = par / arraySize
      parForcesSimpleMode = forceSimpleCalc > 0.1 //if we will pick more than 10% of the array then just go with simple
    }

    if (arraySize < 100 || strideSize > arraySize || parForcesSimpleMode) {
      this.indexList = new Array(arraySize)
      for (let i = 0; i < arraySize; ++i) {
        this.indexList[i] = i
      }
    } else {
      if (par <= 0) {
        if (strideSize < 0) {
          strideSize = arraySize / 100
        }
        if (strideSize < minStrideSize) {
          strideSize = minStrideSize
        }
        if (strideSize > maxStrideSize) {
          strideSize = maxStrideSize
        }
      }

      this.strideSize = Math.floor(strideSize)

      this.indexStrides = Array(Math.ceil(arraySize / this.strideSize)).fill(false) //new Map()

      // let firstStride = new Array(this.strideSize)
      // for (let i = 0; i < this.strideSize; ++i) {
      //   firstStride[i] = i
      // }
      // this.indexStrides.set(0, firstStride)
    }
  }

  //to help with profiling use
  debugGetMode(): string {
    if (this.sparseSet != null) {
      return 'sparse'
    }
    if (this.indexList != null) {
      return 'fastSimple'
    }
    return 'fast'
  }

  //to help with profiling use
  debugForceSparse() {
    this.sparseSet = new Set()
  }

  getNextIndex(): number {
    if (this.iteratorIndex >= this.arraySize) {
      return -1
    }
    let nextIndex: number
    //if we are using the Sparse algorithm:
    if (this.sparseSet != null) {
      let nextIndex = Math.floor(Math.random() * this.arraySize)
      while (this.sparseSet.has(nextIndex)) {
        nextIndex = Math.floor(Math.random() * this.arraySize)
      }
      this.sparseSet.add(nextIndex)
      this.iteratorIndex++
      return nextIndex
    }

    // FastSimple and Simple methods start here
    const randomFetchIndex =
      Math.floor(Math.random() * (this.arraySize - this.iteratorIndex)) + this.iteratorIndex
    //The simple fast algorithm
    if (this.indexList != null) {
      nextIndex = this.indexList[randomFetchIndex]
      const indexValueToSwap = this.indexList[this.iteratorIndex]
      this.indexList[randomFetchIndex] = indexValueToSwap

      this.iteratorIndex++
      return nextIndex
    } else {
      //the Fast algorithm
      const currentStrideKey = Math.floor(this.iteratorIndex / this.strideSize)
      const hasCurrentStride = this.indexStrides[currentStrideKey] !== undefined //.has(currentStrideKey)
      const currentStrideStart = currentStrideKey * this.strideSize

      let currentStride: number[]
      if (hasCurrentStride === false) {
        // fill a new stride
        currentStride = new Array(this.strideSize)
        for (let i = 0; i < this.strideSize; ++i) {
          currentStride[i] = i + currentStrideStart
        }
        this.indexStrides[currentStrideKey] = currentStride // .set(currentStrideKey, currentStride)
      } else {
        currentStride = this.indexStrides[currentStrideKey] //.get(currentStrideKey)
      }

      const fetchStrideKey = Math.floor(randomFetchIndex / this.strideSize)
      const fetchStrideStart = fetchStrideKey * this.strideSize
      const hasFetchStride = this.indexStrides[fetchStrideKey] !== undefined //.has(fetchStrideKey)
      let fetchStride: number[]
      if (hasFetchStride === false) {
        // fill a new stride
        fetchStride = new Array(this.strideSize)
        for (let i = 0; i < this.strideSize; ++i) {
          fetchStride[i] = i + fetchStrideStart
        }
        this.indexStrides[fetchStrideKey] = fetchStride //.set(fetchStrideKey, fetchStride)
      } else {
        fetchStride = this.indexStrides[fetchStrideKey] //.get(fetchStrideKey)
      }

      const fetchStrideLocalDestIndex = randomFetchIndex - fetchStrideStart
      nextIndex = fetchStride[fetchStrideLocalDestIndex]

      const indexValueToSwap = currentStride[this.iteratorIndex - currentStrideStart]
      fetchStride[fetchStrideLocalDestIndex] = indexValueToSwap

      this.iteratorIndex++
      return nextIndex
    }
  }
}
