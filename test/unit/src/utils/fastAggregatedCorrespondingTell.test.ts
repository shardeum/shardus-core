import {
  getCorrespondingNodes,
  verifyCorrespondingSender,
} from '../../../../src/utils/fastAggregatedCorrespondingTell'

const verbose = false

describe('FACT Tests', () => {
  //push several test cases into an array
  const receiverTestCases = [
    // trivial case
    {
      startTargetIndex: 13,
      endTargetIndex: 23,
      transactionGroupSize: 50,
      senderStartRange: 33,
      senderEndRange: 43,
      sendGroupSize: 10,
    },
    // trivial case, half the sender size
    {
      startTargetIndex: 13,
      endTargetIndex: 23,
      transactionGroupSize: 50,
      senderStartRange: 35,
      senderEndRange: 40,
      sendGroupSize: 5,
    },
    // wrap around case
    {
      startTargetIndex: 45,
      endTargetIndex: 5,
      transactionGroupSize: 50,
      senderStartRange: 0,
      senderEndRange: 10,
      sendGroupSize: 10,
    },
    // smaller receiver group
    {
      startTargetIndex: 13,
      endTargetIndex: 18,
      transactionGroupSize: 50,
      senderStartRange: 0,
      senderEndRange: 10,
      sendGroupSize: 10,
    },
    // send to whole transaction group (disperse case)
    {
      startTargetIndex: 0,
      endTargetIndex: 50,
      transactionGroupSize: 50,
      senderStartRange: 0,
      senderEndRange: 10,
      sendGroupSize: 10,
    },
    // send to whole transaction group (disperse case)
    {
      startTargetIndex: 3000,
      endTargetIndex: 3128,
      transactionGroupSize: 5000,
      senderStartRange: 100,
      senderEndRange: 228,
      sendGroupSize: 128,
    },
    // send to whole transaction group (disperse case)
    {
      startTargetIndex: 15,
      endTargetIndex: 25,
      transactionGroupSize: 50,
      senderStartRange: 10,
      senderEndRange: 20,
      sendGroupSize: 10,
    },
  ]

  receiverTestCases.forEach(
    (
      {
        startTargetIndex,
        endTargetIndex,
        transactionGroupSize,
        senderStartRange,
        senderEndRange,
        sendGroupSize,
      },
      index
    ) => {
      test(`Test case ${index}: startTargetIndex: ${startTargetIndex}, endTargetIndex: ${endTargetIndex} transactionGroupSize:${transactionGroupSize} sendGroupSize:${sendGroupSize}`, () => {
        const receiverGroupSize = endTargetIndex - startTargetIndex
        const globalOffset = Math.round(Math.random() * 1000)
        const coverage = new Array(transactionGroupSize).fill(0)

        for (let senderNodeIndex = senderStartRange; senderNodeIndex < senderEndRange; senderNodeIndex++) {
          //get a list of destination nodes for this sender
          const destinationNodes = getCorrespondingNodes(
            senderNodeIndex,
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
          destinationNodes.forEach((receiverNodeIndex) => {
            coverage[receiverNodeIndex]++
            //NOTE, This is where we would send the payload
            //for tellCorrespondingNodes we would send all accounts we cover
            //for tellCorrespondingNodesFinalData we would look at the receiver storage range and send only the accounts are covered

            //verification check
            //extra step here, remove in production
            expect(
              verifyCorrespondingSender(
                receiverNodeIndex,
                senderNodeIndex,
                globalOffset,
                receiverGroupSize,
                sendGroupSize
              )
            ).toBe(true)
          })
        }

        // verify coverage
        for (let i = startTargetIndex; i < endTargetIndex; i++) {
          const wrappedIndex = i >= transactionGroupSize ? i % transactionGroupSize : i
          if (verbose) console.log(`Coverage ${i} ${wrappedIndex}: ${coverage[wrappedIndex]}`)
          expect(coverage[wrappedIndex]).toBeGreaterThan(0)
        }

        // check to make sure we did not cover anything outside of the target range
        for (let i = 0; i < transactionGroupSize; i++) {
          if (i < startTargetIndex || i >= endTargetIndex) {
            expect(coverage[i]).toBe(0)
          }
        }
      })
    }
  )
})
