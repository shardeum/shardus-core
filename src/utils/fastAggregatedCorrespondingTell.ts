//get the target nodes for a given corresponding sender
import { logFlags } from '../logger';

//this only has to be computed once time no matter how many facts are being shared
export function getCorrespondingNodes(
  ourIndex: number,
  startTargetIndex: number,
  endTargetIndex: number,
  globalOffset: number,
  receiverGroupSize: number,
  sendGroupSize: number,
  transactionGroupSize: number,
  note = ''
): number[] {
  if (logFlags.verbose) {
    console.log(
      `getCorrespondingNodes ${note} ${ourIndex} ${startTargetIndex} ${endTargetIndex} ${globalOffset} ${receiverGroupSize} ${sendGroupSize} ${transactionGroupSize}`
    );
  }
  let wrappedIndex: number;
  let targetNumber: number;
  let found = false;

  let unWrappedEndIndex = -1;
  // handle case where receiver group is split (wraps around)
  if (startTargetIndex > endTargetIndex) {
    unWrappedEndIndex = endTargetIndex;
    endTargetIndex = endTargetIndex + transactionGroupSize;
  }
  //wrap our index to the send group size
  ourIndex = ourIndex % sendGroupSize;

  //find our initial staring index into the receiver group (wrappedIndex)
  for (let i = startTargetIndex; i < endTargetIndex; i++) {
    wrappedIndex = i;
    if (i >= transactionGroupSize) {
      wrappedIndex = i - transactionGroupSize;
    }
    targetNumber = (i + globalOffset) % receiverGroupSize;
    if (targetNumber === ourIndex) {
      found = true;
      break;
    }
  }
  if (!found) {
    //return empty array
    return [];
  }

  const destinationNodes: number[] = [];
  //this loop is at most O(k) where k is  receiverGroupSize / sendGroupSize
  //effectively it is constant time it is required so that a smaller
  //group can send to a larger group
  while (targetNumber < receiverGroupSize) {
    //send all payload to this node
    const destinationNode = wrappedIndex;

    destinationNodes.push(destinationNode);
    //console.log(`sender ${ourIndex} send all payload to node ${destinationNode} targetNumber ${targetNumber} `)

    // //in-place verification check
    // let sendingNodeIndex  = ourIndex
    // let receivingNodeIndex = destinationNode
    // //extra step here, remove in production
    // verifySender(receivingNodeIndex, sendingNodeIndex)

    //this part is a bit tricky.
    //we are incrementing two indexes that control our loop
    //wrapped index will have various corrections so that it can
    //wrap past the end of a split span, or wrap within the range
    //of the receiver group
    targetNumber += sendGroupSize;
    wrappedIndex += sendGroupSize;

    //wrap to front of transaction group
    if (wrappedIndex >= transactionGroupSize) {
      wrappedIndex = wrappedIndex - transactionGroupSize;
    }
    //wrap to front of receiver group
    if (wrappedIndex >= endTargetIndex) {
      wrappedIndex = wrappedIndex - receiverGroupSize;
    }
    //special case to stay in bounds when we have a split index and
    //the unWrappedEndIndex is smaller than the start index.
    //i.e.  startTargetIndex = 45, endTargetIndex = 5  for a 50 node group
    if (unWrappedEndIndex != -1 && wrappedIndex >= unWrappedEndIndex) {
      const howFarPastUnWrapped = wrappedIndex - unWrappedEndIndex;
      wrappedIndex = startTargetIndex + howFarPastUnWrapped;
    }
  }
  if (logFlags.verbose) {
    console.log(`note: ${note} destinationNodes ${destinationNodes}`);
  }
  return destinationNodes;
}

export function verifyCorrespondingSender(
  receivingNodeIndex: number,
  sendingNodeIndex: number,
  globalOffset: number,
  receiverGroupSize: number,
  sendGroupSize: number,
  receiverStartIndex = 0,
  receiverEndIndex = 0,
  transactionGroupSize = 0,
  shouldUnwrapSender = false,
  note = ''
): boolean {
  if (logFlags.verbose) {
    console.log(
      `verifyCorrespondingSender ${note} ${receivingNodeIndex} ${sendingNodeIndex} ${globalOffset} ${receiverGroupSize} ${sendGroupSize} ${receiverStartIndex} ${receiverEndIndex} ${transactionGroupSize}`
    );
  }
  //note, in the gather case, we need to check the address range of the sender node also, to prove
  //that it does cover the given account range
  let unwrappedReceivingNodeIndex = receivingNodeIndex;

  // handle case where receiver group is split (wraps around)
  if (receiverStartIndex > unwrappedReceivingNodeIndex) {
    unwrappedReceivingNodeIndex = unwrappedReceivingNodeIndex + transactionGroupSize;
  }
  let unwrappedSendingNodeIndex = sendingNodeIndex;
  if (shouldUnwrapSender) {
    unwrappedSendingNodeIndex = sendingNodeIndex + transactionGroupSize;
  }

  // use unwrappedReceivingNodeIndex to calculate the target index
  const targetIndex = ((unwrappedReceivingNodeIndex + globalOffset) % receiverGroupSize) % sendGroupSize;
  const targetIndex2 = unwrappedSendingNodeIndex % sendGroupSize;
  if (targetIndex === targetIndex2) {
    if (logFlags.verbose)
      console.log(
        `note: ${note} verification passed ${targetIndex} === ${targetIndex2}  ${unwrappedSendingNodeIndex}->${receivingNodeIndex}`
      );
    return true;
  } else {
    console.log(
      `note: ${note} X verification failed ${targetIndex} !== ${targetIndex2} sender: ${unwrappedSendingNodeIndex} receiver: ${receivingNodeIndex}`
    );
    return false;
  }
}
