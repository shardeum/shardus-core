// import {
//   getCorrespondingNodes,
//   verifyCorrespondingSender,
// } from '../../../../src/utils/fastAggregatedCorrespondingTell'

const getCorrespondingNodes = (ourIndex, startTargetIndex, senderGroupSize, receiverGroupSize, globalOffset, verify): number[] => {
  const result = [];
  let i = 0;
  let j = 0;
  const txGroupSize = Math.max(senderGroupSize, receiverGroupSize);

  for (let a = 0; a < txGroupSize; a++) {
    const si = (i + startTargetIndex) % txGroupSize; // sender index
    const ri = ((j + globalOffset) % receiverGroupSize + startTargetIndex) % txGroupSize; // receiver index
    if (verify) { if (ri == ourIndex) result.push(si); }
    else { if (si == ourIndex) result.push(ri); }
    i = (i + 1) % senderGroupSize;
    j = (j + 1) % receiverGroupSize;
  }
  return result;
};

const verbose = true

describe('FACT Tests', () => {
  //push several test cases into an array
  const receiverTestCases = [
    // trivial case
    {
      startTargetIndex: 13,
      endTargetIndex: 23,
      transactionGroupSize: 50,
      senderStartRange: 0,
      senderEndRange: 50,
      sendGroupSize: 50,
    },
    // // trivial case, receiver = 2 x sender
    // {
    //   startTargetIndex: 13,
    //   endTargetIndex: 23,
    //   transactionGroupSize: 50,
    //   senderStartRange: 35,
    //   senderEndRange: 40,
    //   sendGroupSize: 5,
    // },
    // wrap around case
    {
      startTargetIndex: 45,
      endTargetIndex: 5,
      transactionGroupSize: 50,
      senderStartRange: 6,
      senderEndRange: 45,
      sendGroupSize: 50,
    },
    // smaller receiver group
    {
      startTargetIndex: 13,
      endTargetIndex: 18,
      transactionGroupSize: 50,
      senderStartRange: 0,
      senderEndRange: 10,
      sendGroupSize: 50,
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
      startTargetIndex: 0,
      endTargetIndex: 5000,
      transactionGroupSize: 5000,
      senderStartRange: 100,
      senderEndRange: 228,
      sendGroupSize: 128,
    },
    // send to whole transaction group (disperse case)
    {
      startTargetIndex: 0,
      endTargetIndex: 50,
      transactionGroupSize: 50,
      senderStartRange: 10,
      senderEndRange: 20,
      sendGroupSize: 10,
    },
    {
      //globalOffset           = 43776
      startTargetIndex: 2,
      endTargetIndex: 7,
      transactionGroupSize: 8,
      senderStartRange: 0,
      senderEndRange: 8,
      sendGroupSize: 8,
    }
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
        const receiverGroupSize = endTargetIndex > startTargetIndex ? endTargetIndex - startTargetIndex : transactionGroupSize - startTargetIndex + endTargetIndex
        const globalOffset = 0 //43776 // Math.round(Math.random() * 1000)
        const coverage = new Array(transactionGroupSize).fill(0)

        const senderIndicies: number[] = []
        if (senderStartRange < senderEndRange) {
          for (let i = senderStartRange; i < senderEndRange; i++) {
            senderIndicies.push(i)
          }
        } else {
          const useUnWrapped = true
          if (useUnWrapped) {
            //indicies can go past the end
            for (let i = senderStartRange; i < senderEndRange + transactionGroupSize; i++) {
              senderIndicies.push(i)
            }
          } else {
            // wrapped 
            for (let i = 0; i < senderEndRange; i++) {
              senderIndicies.push(i)
            }
            for (let i = senderStartRange; i < transactionGroupSize; i++) {
              senderIndicies.push(i)
            }
          }
          if (verbose) console.log(`wrapped sender ranges ${senderIndicies}`)
        }


        for (let senderNodeIndex = 0; senderNodeIndex < transactionGroupSize; senderNodeIndex++) {
          //get a list of destination nodes for this sender
          const destinationNodes = getCorrespondingNodes(senderNodeIndex, startTargetIndex, sendGroupSize, receiverGroupSize, globalOffset, false)

          if (verbose) console.log(`sender ${senderNodeIndex} send all payload to nodes ${destinationNodes}`, destinationNodes)
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

            let shouldUnwrapSender = false
            if (senderNodeIndex > transactionGroupSize) {
              senderNodeIndex = senderNodeIndex - transactionGroupSize
              shouldUnwrapSender = true
            }
            const eligibleSenderIndices: number[] = getCorrespondingNodes(receiverNodeIndex, startTargetIndex, sendGroupSize, receiverGroupSize, globalOffset, true)
            const senderEligible = eligibleSenderIndices.includes(senderNodeIndex)
            expect(senderEligible).toBe(true)
          })
        }

        // verify coverage
        if (verbose) console.log(`coverage matrix`, coverage)
        for (let i = startTargetIndex; i < endTargetIndex; i++) {
          const wrappedIndex = i >= transactionGroupSize ? i % transactionGroupSize : i
          if (verbose) console.log(`Coverage ${i} ${wrappedIndex}: ${coverage[wrappedIndex]}`)
          expect(coverage[wrappedIndex]).toBeGreaterThan(0)
        }

        // check to make sure we did not cover anything outside of the target range
        for (let i = 0; i < transactionGroupSize; i++) {
          if (endTargetIndex > startTargetIndex) {
            if (i < startTargetIndex || i >= endTargetIndex) {
              expect(coverage[i]).toBe(0)
            }
          } else if (startTargetIndex > endTargetIndex) {
            if (i >= endTargetIndex && i < startTargetIndex) {
              expect(coverage[i]).toBe(0)
            }
          }
        }
      })
    }
  )
})
