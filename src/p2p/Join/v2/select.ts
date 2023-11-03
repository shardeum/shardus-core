/**
 * This module contains the logic for selecting the nodes that will be allowed
 * to join the network.
 */

import { crypto, shardus } from '../../Context'
import * as Self from '../../Self'
import * as CycleChain from '../../CycleChain'
import * as NodeList from '../../NodeList'
import * as http from '../../../http'
import { getStandbyNodesInfoMap } from ".";
import { calculateToAcceptV2 } from "../../ModeSystemFuncs";
import { fastIsPicked } from "../../../utils";
import { getOurNodeIndex, getOurNodeIndexFromSyncingList } from "../../Utils";
import { nestedCountersInstance } from "../../../utils/nestedCounters";
import { logFlags } from "../../../logger";

const selectedPublicKeys: Set<string> = new Set()

/** The number of nodes that will try to contact a single joining node about its selection. */
const NUM_NOTIFYING_NODES = 5

/**
 * Decides how many nodes to accept into the network, then selects nodes that
 * will be allowed to join. If this node isn't active yet, selection will be
 * skipped.
 */
export function executeNodeSelection(): void {
  if (!Self.isActive && !Self.getIsFirst()) {
    /* prettier-ignore */ if (logFlags.p2pNonFatal && logFlags.console) console.warn('not selecting nodes because we are not active yet')
    return
  }

  const { add } = calculateToAcceptV2(CycleChain.newest)
  /* prettier-ignore */ if (logFlags.p2pNonFatal && logFlags.console) console.log(`selecting ${add} nodes to accept`)
  selectNodes(add)
}

/**
 * Selects the nodes to be allowed to join.
 * Iterates through all standby nodes and pick the best ones by their scores
 * (`selectionNum`)
 *
 * @returns The list of public keys of the nodes that have been selected.
 */
export function selectNodes(maxAllowed: number): void {
  const standbyNodesInfo = getStandbyNodesInfoMap()
  /* prettier-ignore */ if (logFlags.p2pNonFatal && logFlags.console) console.log('selecting from standbyNodesInfo', standbyNodesInfo)

  // construct a list of objects that we'll sort by `selectionNum`. we'll use
  // the public key to get the join request associated with the public key and
  // inform the node later that it has been accepted
  const objs: {
    publicKey: string
    selectionNum: string
    appJoinData?: Record<string, any> | null //appJoinData is required for golden ticket
  }[] = []
  for (const [publicKey, info] of standbyNodesInfo) {
    objs.push({
      publicKey,
      selectionNum: info.selectionNum,
      appJoinData: info.appJoinData,
    })
  }

  // sort the objects by their selection numbers
  objs.sort((a, b) => (a.selectionNum < b.selectionNum ? 1 : a.selectionNum > b.selectionNum ? -1 : 0))

  // add as many keys as we're allowed to the set
  for (let i = 0; i < objs.length && selectedPublicKeys.size < maxAllowed; i++) {
    // eslint-disable-next-line security/detect-object-injection
    selectedPublicKeys.add(objs[i].publicKey)
  }

  // If golden ticket is enabled, add nodes with adminCert + golden ticket to selectedPublicKeys if they are not already there
  if (shardus.config.p2p.goldenTicketEnabled === true) {
    for (const obj of objs) {
      if (obj.appJoinData?.adminCert?.goldenTicket === true && !selectedPublicKeys.has(obj.publicKey)) {
        /* prettier-ignore */ if (logFlags.p2pNonFatal && logFlags.console) console.log('selecting golden ticket nodes from standbyNodesInfo')
        selectedPublicKeys.add(obj.publicKey)
      }
    }
/**
  * Notifies the nodes that have been selected that they have been selected by
  * calling their `accepted` endpoints.`
  */
export async function notifyNewestJoinedConsensors(): Promise<void> {
  const counter = CycleChain.getNewest().counter

  if (!Self.isActive) {
    if (Self.isRestartNetwork && Self.isFirst) {
      nestedCountersInstance.countEvent('joinV2', `C${counter}: notifyNewestJoinedConsensors: isRestartNetwork && isFirst`)
      notifyingNewestJoinedConsensors()
      // // decide if we should be in charge of notifying joining nodes
      // const params = {
      //   getOurNodeIndex: CycleChain.getNewest().mode === 'restart' ? 0 : getOurNodeIndex(),
      //   activeByIdOrderLength:
      //     CycleChain.getNewest().mode === 'restart' ? 1 : NodeList.activeByIdOrder.length,
      //   NUM_NOTIFYING_NODES,
      //   CycleChainNewestCounter: CycleChain.newest.counter,
      // }
      // console.log(`C${counter} fastIsPicked params: ${JSON.stringify(params)}`)
      // const shouldNotify = fastIsPicked(
      //   CycleChain.getNewest().mode === 'restart' ? 1 : getOurNodeIndex(),
      //   CycleChain.getNewest().mode === 'restart' ? 0 : NodeList.activeByIdOrder.length,
      //   NUM_NOTIFYING_NODES,
      //   CycleChain.newest.counter
      // )
      // console.log(`C${counter} shouldNotify: ${shouldNotify}`)
    } else console.warn(`C${counter} not notifying nodes because we are not active yet`)
    return
  }

  // decide if we should be in charge of notifying joining nodes
  const params = {
    getOurNodeIndex: getOurNodeIndex(),
    activeByIdOrderLength: NodeList.activeByIdOrder.length,
    NUM_NOTIFYING_NODES,
    CycleChainNewestCounter: CycleChain.newest.counter
  }
  console.log(`C${counter} fastIsPicked params: ${JSON.stringify(params)}`)
  const shouldNotify = fastIsPicked(
    getOurNodeIndex(),
    NodeList.activeByIdOrder.length,
    NUM_NOTIFYING_NODES,
    CycleChain.newest.counter
  )

  // if so, do so
  if (shouldNotify) {
    nestedCountersInstance.countEvent('joinV2', `C${counter}: notifyNewestJoinedConsensors: shouldNotify`)
    notifyingNewestJoinedConsensors()
  }
}

export async function notifyingNewestJoinedConsensors(): Promise<void> {
  const marker = CycleChain.getCurrentCycleMarker()
  const counter = CycleChain.getNewest().counter

  for (const joinedConsensor of CycleChain.newest.joinedConsensors) {
    const publicKey = joinedConsensor.publicKey

    // no need to notify ourselves
    if (publicKey === crypto.keypair.publicKey) continue
    console.log(`C${counter} notifying node`, publicKey, 'that it has been selected')

    // sign an acceptance offer
    const offer = crypto.sign({
      cycleMarker: marker,
      activeNodePublicKey: crypto.keypair.publicKey,
    })

    // make the call, but don't await. it might take a while.
    http
      .post(`http://${joinedConsensor.externalIp}:${joinedConsensor.externalPort}/accepted`, offer)
      .catch((e) => {
        nestedCountersInstance.countEvent(
          'joinV2',
          `C${counter}: notifyingNewestJoinedConsensors: http post failed`
        )
        console.error(`C${counter} failed to notify node ${publicKey} that it has been selected:`, e)
      })
  }
}
/**
  * Returns the list of public keys of the nodes that have been selected and
  * empties the list.
  */
export function drainSelectedPublicKeys(): string[] {
  const tmp = [...selectedPublicKeys.values()]
  selectedPublicKeys.clear()
  return tmp
}

export function forceSelectSelf(): void {
  selectedPublicKeys.add(crypto.keypair.publicKey)
}
