import {
  getCorrespondingNodes,
  verifyCorrespondingSender,
} from '../../../../src/utils/fastAggregatedCorrespondingTell'

const verbose = false

//But also an example of how to use the above functions

//push several test cases into an array
const receiverTestCases: { [key: string]: number }[] = []

// trivial case
receiverTestCases.push({
  startTargetIndex: 13,
  endTargetIndex: 23,
  transactionGroupSize: 50,
  senderStartRange: 33,
  senderEndRange: 43,
  sendGroupSize: 10,
})

// trivial case, half the sender size
receiverTestCases.push({
  startTargetIndex: 13,
  endTargetIndex: 23,
  transactionGroupSize: 50,
  senderStartRange: 35,
  senderEndRange: 40,
  sendGroupSize: 5,
})

// wrap around case
receiverTestCases.push({
  startTargetIndex: 45,
  endTargetIndex: 5,
  transactionGroupSize: 50,
  senderStartRange: 0,
  senderEndRange: 10,
  sendGroupSize: 10,
})

// smaller receiver group
receiverTestCases.push({
  startTargetIndex: 13,
  endTargetIndex: 18,
  transactionGroupSize: 50,
  senderStartRange: 0,
  senderEndRange: 10,
  sendGroupSize: 10,
})

// send to whole transaction group (disperse case)
receiverTestCases.push({
  startTargetIndex: 0,
  endTargetIndex: 50,
  transactionGroupSize: 50,
  senderStartRange: 0,
  senderEndRange: 10,
  sendGroupSize: 10,
})

// larger case
receiverTestCases.push({
  startTargetIndex: 3000,
  endTargetIndex: 3128,
  transactionGroupSize: 5000,
  senderStartRange: 100,
  senderEndRange: 228,
  sendGroupSize: 128,
})

let testNumber = 0
for (const test of receiverTestCases) {
  testNumber++
  const {
    startTargetIndex,
    endTargetIndex,
    transactionGroupSize,
    senderStartRange,
    senderEndRange,
    sendGroupSize,
  } = test
  const receiverGroupSize = endTargetIndex - startTargetIndex
  const globalOffset = Math.round(Math.random() * 1000)

  console.log(
    `test case ${testNumber} startTargetIndex:${startTargetIndex} endTargetIndex:${endTargetIndex} transactionGroupSize:${transactionGroupSize} sendGroupSize:${sendGroupSize} globalOffset:${globalOffset}`
  )

  const coverage = new Array(transactionGroupSize).fill(0)
  for (let sendTest = senderStartRange; sendTest < senderEndRange; sendTest++) {
    //console.log(`sendTest ${sendTest}`)
    const ourIndex = sendTest

    //get a list of destination nodes for this sender
    const destinationNodes = getCorrespondingNodes(
      ourIndex,
      startTargetIndex,
      endTargetIndex,
      globalOffset,
      receiverGroupSize,
      sendGroupSize,
      transactionGroupSize
    )

    //cheap hack to test that verification can refute things
    //globalOffset++

    //this is the list of nodes that we should send to,
    //in this test we will increment a coverage array
    for (const i of destinationNodes) {
      // eslint-disable-next-line security/detect-object-injection
      coverage[i]++

      //NOTE, This is where we would send the payload
      //for tellCorrespondingNodes we would send all accounts we cover
      //for tellCorrespondingNodesFinalData we would look at the receiver storage range and send only the accounts are covered

      //verification check
      const sendingNodeIndex = ourIndex
      const receivingNodeIndex = i
      //extra step here, remove in production
      verifyCorrespondingSender(
        receivingNodeIndex,
        sendingNodeIndex,
        globalOffset,
        receiverGroupSize,
        sendGroupSize
      )
    }
  }

  //each sender evaluates on its own, so wrapping math not a concern, but we could still test for it
  //this was tested before but would need a little more work to use make it dynamically
  //turned on/off based on the sender group wrapping or not
  // for(let sendTest=0; sendTest < 5; sendTest++){
  //     //console.log(`sendTest ${sendTest}`)
  //     ourIndex = sendTest
  //     ourIndex = ourIndex % sendGroupSize

  //     //get a list of destination nodes for this sender
  //     let destinationNodes = getDestinationNodes(ourIndex, startTargetIndex, endTargetIndex, globalOffset, receiverGroupSize, sendGroupSize)

  //     for(let i of destinationNodes){
  //         coverage[i]++
  //     }
  // }

  //verify coverage
  for (let i = startTargetIndex; i < endTargetIndex; i++) {
    let wrappedIndex = i
    if (i >= transactionGroupSize) {
      wrappedIndex = i % transactionGroupSize
    }
    // eslint-disable-next-line security/detect-object-injection
    if (verbose) console.log(`coverage ${i} ${wrappedIndex}   ${coverage[wrappedIndex]}`)
  }

  //check to make sure we did not cover anything outside of the target range
  for (let i = 0; i < transactionGroupSize; i++) {
    if (i < startTargetIndex || i >= endTargetIndex) {
      // eslint-disable-next-line security/detect-object-injection
      if (coverage[i] != 0) console.log(`bad coverage ${i} ${coverage[i]}`)
    }
  }

  //todo exhaustive search for non verified senders
  //this actually requires an additional coarse external means to rule out senders
  //i.e. check if they are in the execution group for tellCorrespondingNodesFinalData
  //     check if they the node covers the storage range of accounts sent for tellCorrespondingNodes
  //the above coarse check is and-ed with verifyCorrespondingSender

  //a hacky/cheap way to test is to change the globalOffset before verification
}
