import { P2P } from '@shardus/types'
import { NodeStatus, SignedObject } from '@shardus/types/build/src/p2p/P2PTypes'
import * as events from 'events'
import * as log4js from 'log4js'
import * as http from '../http'
import { logFlags } from '../logger'
import * as network from '../network'
import * as snapshot from '../snapshot'
import * as utils from '../utils'
import { isInvalidIP } from '../utils/functions/checkIP'
import { nestedCountersInstance } from '../utils/nestedCounters'
import * as Archivers from './Archivers'
import * as Comms from './Comms'
import * as Context from './Context'
import * as CycleCreator from './CycleCreator'
import { calcIncomingTimes } from './CycleCreator'
import * as GlobalAccounts from './GlobalAccounts'
import * as Join from './Join'
import * as JoinV2 from './Join/v2'
import * as Acceptance from './Join/v2/acceptance'
import * as NodeList from './NodeList'
import * as Sync from './Sync'
import { getNewestCycle } from './Sync'
import * as SyncV2 from './SyncV2/'
import { getRandomAvailableArchiver, SeedNodesList } from './Utils'
import * as CycleChain from './CycleChain'
import rfdc from 'rfdc'
import { shardusGetTime } from '../network'
import getCallstack from '../utils/getCallstack'
const deepCopy = rfdc()

/** STATE */

const startTimestamp = Date.now()

export const emitter = new events.EventEmitter()

let p2pLogger: log4js.Logger

export let id: string
export let isFirst: boolean
export let isActive = false
export let allowConnectionToFirstNode = false
export let ip: string
export let port: number

export let p2pJoinTime = 0
export let p2pSyncStart = 0
export let p2pSyncEnd = 0

export let p2pIgnoreJoinRequests = true

let mode = null
/*
  Records the state of the node (INITIALIZING -> STANDBY -> SYNCING -> ACTIVE)
  INITIALIZING -> STANDBY = Node is trying to get its join request accepted
  STANDBY -> SYNCING = Node has accepted its join request and is syncing
  SYNCING -> ACTIVE = Node has synced and is now active
*/
let state = P2P.P2PTypes.NodeStatus.INITIALIZING

/** ROUTES */

/** FUNCTIONS */

export function init(): void {
  // Setup our IP and port so modules like Sync can use it
  ip = network.ipInfo.externalIp
  port = network.ipInfo.externalPort

  // Init submodules
  Comms.init()
  Archivers.init()
  CycleCreator.init()
  GlobalAccounts.init()
  NodeList.init()
  Sync.init()

  // initialize SyncV2 if enabled
  if (Context.config.p2p.useSyncProtocolV2) {
    SyncV2.init()
  }

  // initialize JoinV2 if enabled
  if (Context.config.p2p.useJoinProtocolV2) {
    JoinV2.init()
  }

  // Create a logger for yourself
  p2pLogger = Context.logger.getLogger('p2p')

  // kick-start the status history. debug end-point is /status-history
  updateNodeState(P2P.P2PTypes.NodeStatus.INITIALIZING) // requires p2pLogger through warn()
}

export function startupV2(): Promise<boolean> {
  const promise = new Promise<boolean>((resolve, reject) => {
    const publicKey = Context.crypto.getPublicKey()
    let attemptJoiningTimer = null
    let attemptJoiningRunning = false
    let cycleDuration = Context.config.p2p.cycleDuration

    // Function to set node's status to SYNCING, perform sync functions, and finish startup
    const enterSyncingState = async (): Promise<void> => {
      try {
        // set status SYNCING
        updateNodeState(P2P.P2PTypes.NodeStatus.SYNCING)

        p2pSyncStart = shardusGetTime()

        if (logFlags.p2pNonFatal) info('Emitting `joined` event.')

        // Should fire after being accepted into the network
        emitter.emit('joined', id, publicKey)

        nestedCountersInstance.countEvent('p2p', 'joined')
        // Sync cycle chain from network
        await syncCycleChain()

        // Enable internal routes
        Comms.setAcceptInternal(true)

        // Start creating cycle records
        await CycleCreator.startCycles()
        p2pSyncEnd = shardusGetTime()
        p2pJoinTime = (p2pSyncEnd - p2pSyncStart) / 1000

        nestedCountersInstance.countEvent('p2p', `sync time ${p2pJoinTime} seconds`)

        if (logFlags.p2pNonFatal) info('Emitting `initialized` event.' + p2pJoinTime)
        emitter.emit('initialized')

        // Break loop
        return resolve(true)
      } catch (err) {
        // Log syncing error and abort startup
        /* prettier-ignore */ if (logFlags.important_as_fatal) console.log('error in startupV2 > enterSyncingState: ', utils.formatErrorMessage(err))
        /* prettier-ignore */ if (logFlags.important_as_fatal) warn('Error while syncing to network:')
        /* prettier-ignore */ if (logFlags.important_as_fatal) warn(utils.formatErrorMessage(err))
        //warn(err.stack)
        throw new Error('Fatal: Error while syncing to network:' + err.message)
      }
    }

    // This funciton will be called repeatedly until the node is accepted to become an active node
    // It has two phases the first phase is to wait for isOnStandbyList to be come true
    // which indicates we are now on the standby list (per the consenced cycle record)
    // Then the node will wait for and "id" the presense of an id indicates we have been selected to become an active node
    const attemptJoining = async (): Promise<void> => {
      // Prevent scheduler from running multiple times
      if (attemptJoiningRunning) {
        return
      }
      attemptJoiningRunning = true

      // Clear existing scheduler timer
      if (attemptJoiningTimer) {
        clearTimeout(attemptJoiningTimer)
      }

      try {
        // Get active nodes from Archiver
        const activeNodes = await contactArchiver()

        // Determine if you're the first node
        if (utils.isUndefined(isFirst)) {
          isFirst = discoverNetwork(activeNodes)
          if (isFirst) {
            // Join your own network and give yourself an ID
            id = await Join.firstJoin()
            // set status SYNCING
            await enterSyncingState()
            attemptJoiningRunning = false
            return
          }
        }

        // Remove yourself from activeNodes if you are present in them
        const ourIdx = activeNodes.findIndex(
          (node) => node.ip === network.ipInfo.externalIp && node.port === network.ipInfo.externalPort
        )
        if (ourIdx > -1) {
          activeNodes.splice(ourIdx, 1)
        }

        // Get latest cycle record from active nodes
        const latestCycle = await Sync.getNewestCycle(activeNodes)
        cycleDuration = latestCycle.duration
        mode = latestCycle.mode || null

        // Query network for node status
        const resp = await Join.fetchJoinedV2(activeNodes)

        // note the list below is in priority order of what operation is the most important
        // mainly this matters on something like our node being selected to join but also on the
        // same cycle could be cut due to version

        // If we see and id with a real value then our node has been selected to go active
        // start the syncing process and stop looping the attemptJoining function
        if (resp?.id) {
          id = resp.id
          await enterSyncingState()
          attemptJoiningRunning = false
          return
        }

        // If we see that isOnStandbyList is true then we are on standby.
        // If our state is not STANDBY yet set it to STANDBY (this is mainly for operator CLI purposes)
        // Note that attemptJoining isn't just to get on the standby list, but also
        // we will be checking above to see when our node is selected to go active
        if (resp?.isOnStandbyList === true) {
          if (state !== P2P.P2PTypes.NodeStatus.STANDBY) {
            updateNodeState(P2P.P2PTypes.NodeStatus.STANDBY)
          }
          // Call scheduler after 5 cycles... does this mean it may be 5 cycles before we realized we were
          // accepted to go active?
          attemptJoiningTimer = setTimeout(() => {
            attemptJoining()
          }, 5 * cycleDuration * 1000)
          attemptJoiningRunning = false
          return
        }

        // If we are in state stanby but suddenly isOnStandbyList becomes false again
        // then we have been kicked from the stanby list.  The node should exit with error
        if (state === P2P.P2PTypes.NodeStatus.STANDBY) {
          if (resp?.isOnStandbyList === false) {
            nestedCountersInstance.countEvent('p2p', 'detected standby list removal of our node')
            /* prettier-ignore */ if (logFlags.important_as_fatal) console.log('startupV2 our node has been removed from the standby list and will restart')

            console.log(`self:startupV2.  standby=>not standby.  restarting`)
            //  todo this may not be the correct UX
            const message = `validator removed from standby list`
            emitter.emit('invoke-exit', `removed from standby list`, getCallstack(), message, true)
            attemptJoiningRunning = false
            return
          }
        }

        // If we see that isOnStandbyList is false then we are not on standby.
        // we should call joinNetworkV2 to try to get on the standby list
        // note this may not actually result in a message to the network, as the dapp
        // may need to check stain and take other actions before it isReadyToJoin
        if (resp?.isOnStandbyList === false) {
          await joinNetworkV2(activeNodes)
          // Call scheduler after 2 cycles
          attemptJoiningTimer = setTimeout(() => {
            attemptJoining()
          }, 2 * cycleDuration * 1000)
          attemptJoiningRunning = false
          return
        }

        // iff we need to ever jump out of standby ??
        // if (state === P2P.P2PTypes.NodeStatus.STANDBY) {
        //   //check our own version against the latest version
        //   //quite if we are wrong.
        // }

        //this should help us feel safer that attemptJoining will not finish until we are ready for it to do so
        nestedCountersInstance.countEvent('p2p', 'attemptJoining: error got too far without an action')
        throw new Error(
          'Should not reach this point. Throwing non-fatal error which will restart attemptJoining'
        )
      } catch (err) {
        // Log joining error
        /* prettier-ignore */ if (logFlags.important_as_fatal) console.log(`error in startupV2 > attemptJoining:`, utils.formatErrorMessage(err))
        /* prettier-ignore */ if (logFlags.important_as_fatal) warn(`Error while joining network:`)
        /* prettier-ignore */ if (logFlags.important_as_fatal) warn(utils.formatErrorMessage(err))
        //warn(err.stack)

        // Abort startup if error is fatal
        if (err.message.startsWith('Fatal:')) {
          attemptJoiningRunning = false
          /* prettier-ignore */ if (logFlags.fatal) warn(`Fatal error while joining network. re-throw to cause shutdown`)
          throw err
        }

        // Schedule another attempt to join
        /* prettier-ignore */ if (logFlags.important_as_fatal) info(`Trying to join again in ${cycleDuration} seconds...`)

        attemptJoiningTimer = setTimeout(() => {
          attemptJoining()
        }, cycleDuration * 1000)
      } finally {
        attemptJoiningRunning = false
      }
    }

    // If startInWitness config is set to true, start witness mode and end
    if (Context.config.p2p.startInWitnessMode) {
      if (logFlags.p2pNonFatal) info('Emitting `witnessing` event.')
      emitter.emit('witnessing', publicKey)
      return resolve(true)
    }

    // Emit the joining event
    if (logFlags.p2pNonFatal) info('Emitting `joining` event.')
    emitter.emit('joining', publicKey)

    // register listener for acceptance
    // The accepted flow is deprecated
    // Acceptance.getEventEmitter().on('accepted', () => {
    //   if (state === P2P.P2PTypes.NodeStatus.SYNCING || state === P2P.P2PTypes.NodeStatus.ACTIVE) {
    //     return
    //   }
    //   attemptJoining()
    // })

    // Start by joining the network
    attemptJoining()
  })

  return promise
}

// export async function startup(): Promise<boolean> {
//   const publicKey = Context.crypto.getPublicKey()

//   // If startInWitness config is set to true, start witness mode and end
//   if (Context.config.p2p.startInWitnessMode) {
//     if (logFlags.p2pNonFatal) info('Emitting `witnessing` event.')
//     emitter.emit('witnessing', publicKey)
//     return true
//   }

//   // Attempt to join the network until you know if you're first and have an id
//   if (logFlags.p2pNonFatal) info('Emitting `joining` event.')
//   emitter.emit('joining', publicKey)

//   let firstTime = true
//   do {
//     try {
//       // Get active nodes from Archiver
//       const activeNodes = await contactArchiver()

//       // Start in witness mode if conditions are met
//       if (await witnessConditionsMet(activeNodes)) {
//         if (logFlags.p2pNonFatal) info('Emitting `witnessing` event.')
//         emitter.emit('witnessing', publicKey)
//         return true
//       } else {
//         //not in witness mode
//       }
//       // Otherwise, try to join the network
//       ;({ isFirst, id } = await joinNetwork(activeNodes, firstTime))
//       console.log('isFirst:', isFirst, 'id:', id)
//     } catch (err) {
//       console.log('error in Join network: ', err)
//       if (!Context.config.p2p.useJoinProtocolV2) {
//         updateNodeState(P2P.P2PTypes.NodeStatus.STANDBY)
//       }
//       if (err.message.startsWith('Fatal:')) {
//         throw err
//       }
//       /* prettier-ignore */ if (logFlags.important_as_fatal) warn('Error while joining network:')
//       /* prettier-ignore */ if (logFlags.important_as_fatal) warn(utils.formatErrorMessage(err))
//       //warn(err.stack)
//       /* prettier-ignore */ if (logFlags.important_as_fatal) info(`Trying to join again in ${Context.config.p2p.cycleDuration} seconds...`)
//       await utils.sleep(Context.config.p2p.cycleDuration * 1000)
//     }
//     firstTime = false
//   } while (utils.isUndefined(isFirst) || utils.isUndefined(id))

//   p2pSyncStart = shardusGetTime()

//   /* prettier-ignore */ if (logFlags.important_as_fatal) info('Emitting `joined` event.')
//   emitter.emit('joined', id, publicKey)
//   updateNodeState(P2P.P2PTypes.NodeStatus.SYNCING)

//   nestedCountersInstance.countEvent('p2p', 'joined')
//   // Sync cycle chain from network
//   await syncCycleChain()

//   // Enable internal routes
//   Comms.setAcceptInternal(true)

//   // Start creating cycle records
//   await CycleCreator.startCycles()
//   p2pSyncEnd = shardusGetTime()
//   p2pJoinTime = (p2pSyncEnd - p2pSyncStart) / 1000

//   nestedCountersInstance.countEvent('p2p', `sync time ${p2pJoinTime} seconds`)

//   /* prettier-ignore */ if (logFlags.important_as_fatal) info('Emitting `initialized` event.' + p2pJoinTime)
//   emitter.emit('initialized')

//   return true
// }

/**
 * should deprecate this!
 * @param activeNodes
 * @returns
 */
// async function witnessConditionsMet(activeNodes: P2P.P2PTypes.Node[]): Promise<boolean> {
//   try {
//     // 1. node has old data
//     if (snapshot.oldDataPath) {
//       const latestCycle = await getNewestCycle(activeNodes)
//       // 2. network is in safety mode
//       if (latestCycle.safetyMode === true) {
//         // 3. active nodes >= max nodes
//         if (latestCycle.active >= Context.config.p2p.maxNodes) {
//           return true
//         }
//       }
//     }
//   } catch (e) {
//     /* prettier-ignore */ if (logFlags.important_as_fatal) warn('witnessConditionsMet', utils.formatErrorMessage(e))
//   }
//   return false
// }

export interface StatusHistoryEntry {
  /**
   * The status of the node taken from the module variable `state`.
   */
  moduleStatus: P2P.P2PTypes.NodeStatus

  /**
   * The status of the node taken from the node list, which ends up being the previous status before the update.
   */
  nodeListStatus: P2P.P2PTypes.NodeStatus

  timestamp: number
  isoDateTime: string
  newestCycleCounter: number
  quarter: number
  uptime: string

  /**
   * The optional argument to updateNodeState() explaining why or from where the state is being changed.
   */
  because: string
}

const statusHistory: StatusHistoryEntry[] = []

export function getStatusHistoryCopy(): StatusHistoryEntry[] {
  // return a copy so it cannot be mutated
  return deepCopy(statusHistory)
}

export function updateNodeState(updatedState: NodeStatus, because = ''): void {
  state = updatedState
  const pubKey = (Context.crypto && Context.crypto.getPublicKey()) || null
  const entry: StatusHistoryEntry = {
    moduleStatus: state,
    nodeListStatus:
      (pubKey &&
        NodeList.byPubKey &&
        NodeList.byPubKey.get(pubKey) &&
        NodeList.byPubKey.get(pubKey).status) ||
      null,
    timestamp: shardusGetTime(),
    isoDateTime: new Date().toISOString(),
    uptime: utils.readableDuration(startTimestamp),
    newestCycleCounter: (CycleChain.getNewest() && CycleChain.getNewest().counter) || null,
    quarter: CycleCreator.currentCycle,
    because: because,
  }

  /* prettier-ignore */ nestedCountersInstance.countEvent( 'p2p', `stateupdate: ${updatedState} c:${entry.newestCycleCounter}` )

  // changing status is infrequent, so log it always
  /* prettier-ignore */ if (logFlags.important_as_fatal) warn(`Node status changed to ${updatedState}:\n${JSON.stringify(entry, null, 2)}`)
  statusHistory.push(entry)
}

async function joinNetworkV2(activeNodes): Promise<void> {
  // Get latest cycle record from active nodes
  const latestCycle = await Sync.getNewestCycle(activeNodes)
  mode = latestCycle.mode || null
  const publicKey = Context.crypto.getPublicKey()
  const isReadyToJoin = await Context.shardus.app.isReadyToJoin(latestCycle, publicKey, activeNodes, mode)
  if (!isReadyToJoin) {
    /* prettier-ignore */ nestedCountersInstance.countEvent( 'p2p', `joinNetworkV2:isReadyToJoin:false` )
    // Wait for Context.config.p2p.cycleDuration and try again
    throw new Error('Node not ready to join')
  }

  // Create join request from latest cycle
  const request = await Join.createJoinRequest(latestCycle.previous)

  //we can't use allowBogon lag yet because its value is detected later.
  //it is possible to throw out any invalid IPs at this point
  if (Context.config.p2p.rejectBogonOutboundJoin || Context.config.p2p.forceBogonFilteringOn) {
    if (isInvalidIP(request.nodeInfo.externalIp)) {
      throw new Error(`Fatal: Node cannot join with invalid external IP: ${request.nodeInfo.externalIp}`)
    }
  }

  // Figure out when Q1 is from the latestCycle
  const { startQ1 } = calcIncomingTimes(latestCycle)
  /* prettier-ignore */ if (logFlags.important_as_fatal) info(`Next cycles Q1 start ${startQ1}; Currently ${shardusGetTime()}`)

  // Wait until a Q1 then send join request to active nodes
  let untilQ1 = startQ1 - shardusGetTime()
  //make untilQ1 in the future if needed
  while (untilQ1 < 0) {
    untilQ1 += latestCycle.duration * 1000
  }
  let offsetTime = 500

  //random in between 0 and 2000.  trying to debug why we are rejected from dapps
  offsetTime = Math.floor(Math.random() * Context.config.p2p.randomJoinRequestWait) //TODO make config and set default value back to 2000ms or lower

  /* prettier-ignore */ if (logFlags.important_as_fatal) info(`Waiting ${untilQ1} + ${offsetTime} ms for Q1 before sending join...`)
  await utils.sleep(untilQ1 + offsetTime) // Not too early

  // send join request
  await Join.submitJoinV2(activeNodes, request)
}

// async function joinNetwork(
//   activeNodes: P2P.P2PTypes.Node[],
//   firstTime: boolean
// ): Promise<{ isFirst: boolean; id: string }> {
//   // Check if you're the first node
//   const isFirst = discoverNetwork(activeNodes)
//   if (isFirst) {
//     // Join your own network and give yourself an ID
//     const id = await Join.firstJoin()
//     // Return id and isFirst
//     return { isFirst, id }
//   }

//   // Remove yourself from activeNodes if you are present in them
//   const ourIdx = activeNodes.findIndex(
//     (node) => node.ip === network.ipInfo.externalIp && node.port === network.ipInfo.externalPort
//   )
//   if (ourIdx > -1) {
//     activeNodes.splice(ourIdx, 1)
//   }

//   // Check joined before trying to join, if not first time
//   if (firstTime === false) {
//     // Check if joined by trying to set our node ID
//     const id = await Join.fetchJoined(activeNodes)
//     if (id) {
//       return { isFirst: false, id }
//     }
//   }

//   // Get latest cycle record from active nodes
//   const latestCycle = await Sync.getNewestCycle(activeNodes)
//   mode = latestCycle.mode || null
//   const publicKey = Context.crypto.getPublicKey()
//   const isReadyToJoin = await Context.shardus.app.isReadyToJoin(latestCycle, publicKey, activeNodes, mode)
//   if (!isReadyToJoin) {
//     // Wait for Context.config.p2p.cycleDuration and try again
//     throw new Error('Node not ready to join')
//   }

//   // Create join request from latest cycle
//   const request = await Join.createJoinRequest(latestCycle.previous)

//   //we can't use allowBogon lag yet because its value is detected later.
//   //it is possible to throw out any invalid IPs at this point
//   if (Context.config.p2p.rejectBogonOutboundJoin || Context.config.p2p.forceBogonFilteringOn) {
//     if (isInvalidIP(request.nodeInfo.externalIp)) {
//       throw new Error(`Fatal: Node cannot join with invalid external IP: ${request.nodeInfo.externalIp}`)
//     }
//   }

//   // Figure out when Q1 is from the latestCycle
//   const { startQ1, startQ4 } = calcIncomingTimes(latestCycle)
//   if (logFlags.important_as_fatal) info(`Next cycles Q1 start ${startQ1}; Currently ${shardusGetTime()}`)

//   // create the Promise that we will `await` to wait for the 'accepted' event,
//   // in case of Join v2. this registers the listener ahead of time
//   const trigger = acceptedTrigger()

//   // only submit join requests if we are using the old protocol or if we have not yet successfully submitted a join request
//   if (!Context.config.p2p.useJoinProtocolV2 || !Join.getHasSubmittedJoinRequest()) {
//     // Wait until a Q1 then send join request to active nodes
//     let untilQ1 = startQ1 - shardusGetTime()
//     while (untilQ1 < 0) {
//       untilQ1 += latestCycle.duration * 1000
//     }

//     if (logFlags.important_as_fatal) info(`Waiting ${untilQ1 + 500} ms for Q1 before sending join...`)
//     await utils.sleep(untilQ1 + 500) // Not too early

//     await Join.submitJoin(activeNodes, request)
//   }

//   if (Context.config.p2p.useJoinProtocolV2) {
//     // if using join protocol v2, simply wait for the 'accepted' event to fire
//     await trigger

//     // then, we can fetch the id from the network and return
//     const id = await Join.fetchJoined(activeNodes)
//     return { isFirst, id }
//   } else {
//     // otherwise, wait until a Q4 before we loop ..
//     // This is a bit faster than before and should allow nodes to try joining
//     // without skipping a cycle
//     if (logFlags.p2pNonFatal) info('Waiting approx. one cycle then checking again...')
//     let untilQ4 = startQ4 - shardusGetTime()
//     while (untilQ4 < 0) {
//       untilQ4 += latestCycle.duration * 1000
//     }
//     await utils.sleep(untilQ4 + 500)
//   }

//   return {
//     isFirst: undefined,
//     id: undefined,
//   }
// }

async function syncCycleChain(): Promise<void> {
  // You're already synced if you're first
  if (isFirst) return
  let synced = false
  while (!synced) {
    // Once joined, sync to the network
    try {
      if (logFlags.p2pNonFatal) info('Getting activeNodes from archiver to sync to network...')
      const activeNodes = await contactArchiver()

      // Remove yourself from activeNodes if you are present in them
      const ourIdx = activeNodes.findIndex(
        (node) => node.ip === network.ipInfo.externalIp && node.port === network.ipInfo.externalPort
      )
      if (ourIdx > -1) {
        activeNodes.splice(ourIdx, 1)
      }

      if (logFlags.p2pNonFatal) info('Attempting to sync to network...')
      if (Context.config.p2p.useSyncProtocolV2) {
        // attempt syncing with the v2 protocol and handle the result. the first
        // callback will run if the result is `Ok`, the second if it is `Err`
        // TODO this can be very very expensive.  In a local test it was getting called repeatedly due to
        // a local error.  we may need some limits on how many times we try to sync
        await SyncV2.syncV2(activeNodes).match(
          () => (synced = true),
          (err) => {
            throw err
          }
        )
      } else {
        synced = await Sync.sync(activeNodes)
      }
    } catch (err) {
      synced = false
      /* prettier-ignore */ nestedCountersInstance.countEvent( 'p2p', `syncCycleChain: ex: ${err.message}` )
      /* prettier-ignore */ if (logFlags.important_as_fatal) warn('syncCycleChain:', utils.formatErrorMessage(err))
      if (logFlags.p2pNonFatal) info('Trying again in 2 sec...')
      await utils.sleep(2000)
    }
  }
}

async function contactArchiver(): Promise<P2P.P2PTypes.Node[]> {
  const maxRetries = 3
  let retry = maxRetries
  const failArchivers: string[] = []
  let archiver: P2P.SyncTypes.ActiveNode
  let activeNodesSigned: P2P.P2PTypes.SignedObject<SeedNodesList>

  while (retry > 0) {
    try {
      archiver = getRandomAvailableArchiver()
      if (!failArchivers.includes(archiver.ip)) failArchivers.push(archiver.ip)
      activeNodesSigned = await getActiveNodesFromArchiver(archiver)
      break // To stop this loop if it gets the response without failing
    } catch (e) {
      if (retry === 1) {
        throw Error(`Could not get seed list from seed node server ${failArchivers}`)
      }
    }
    retry--
  }

  // This probably cant happen but adding it for completeness
  if (activeNodesSigned == null || activeNodesSigned.nodeList == null) {
    throw Error(
      `Fatal: activeNodesSigned == null || activeNodesSigned.nodeList == null Archiver: ${archiver.ip}`
    )
  }

  if (activeNodesSigned.nodeList.length === 0) {
    throw new Error(
      `Fatal: getActiveNodesFromArchiver returned an empty list after ${
        maxRetries - retry
      } attempts from seed node servers ${failArchivers}`
    )
  }
  if (!Context.crypto.verify(activeNodesSigned, archiver.publicKey)) {
    info(`Got signed seed list: ${JSON.stringify(activeNodesSigned)}`)
    throw Error(
      `Fatal: _getSeedNodes seed list was not signed by archiver!. Archiver: ${archiver.ip}:${archiver.port}, signature: ${activeNodesSigned.sign}`
    )
  }

  const joinRequest: P2P.ArchiversTypes.Request | undefined = activeNodesSigned.joinRequest as
    | P2P.ArchiversTypes.Request
    | undefined
  if (joinRequest) {
    const accepted = Archivers.addArchiverJoinRequest(joinRequest)
    if (accepted.success === false) {
      throw Error('Fatal: _getSeedNodes archivers join request not accepted by us!')
    }
    if (Context.config.p2p.experimentalSnapshot && Context.config.features.archiverDataSubscriptionsUpdate) {
      const firstNodeDataRequest = {
        dataRequestCycle: activeNodesSigned.dataRequestCycle as number,
      }
      Archivers.addDataRecipient(joinRequest.nodeInfo, firstNodeDataRequest)
      // Using this flag due to isFirst check is not working as expected yet in the first consensor-archiver connection establishment
      allowConnectionToFirstNode = true
      return activeNodesSigned.nodeList
    }
  }
  const dataRequestCycle = activeNodesSigned.dataRequestCycle
  const dataRequestStateMetaData = activeNodesSigned.dataRequestStateMetaData

  const dataRequest = []
  if (dataRequestCycle) {
    dataRequest.push(dataRequestCycle)
  }
  if (dataRequestStateMetaData) {
    dataRequest.push(dataRequestStateMetaData)
  }
  if (joinRequest && dataRequest.length > 0) {
    Archivers.addDataRecipient(joinRequest.nodeInfo, dataRequest)
  }
  return activeNodesSigned.nodeList
}

function discoverNetwork(seedNodes: P2P.P2PTypes.Node[]): boolean {
  // Check if we are first seed node
  const isFirstSeed = checkIfFirstSeedNode(seedNodes)
  if (!isFirstSeed) {
    if (logFlags.p2pNonFatal) info('You are not the first seed node...')
    return false
  }
  if (logFlags.p2pNonFatal) info('You are the first seed node!')
  return true
}

function checkIfFirstSeedNode(seedNodes: P2P.P2PTypes.Node[]): boolean {
  if (!seedNodes.length) throw new Error('Fatal: No seed nodes in seed list!')
  if (seedNodes.length > 1) return false
  const seed = seedNodes[0]
  if (network.ipInfo.externalIp === seed.ip && network.ipInfo.externalPort === seed.port) {
    return true
  }
  return false
}

async function getActiveNodesFromArchiver(
  archiver: P2P.SyncTypes.ActiveNode
): Promise<P2P.P2PTypes.SignedObject<SeedNodesList>> {
  const nodeListUrl = `http://${archiver.ip}:${archiver.port}/nodelist`
  const nodeInfo = getPublicNodeInfo()
  let seedListSigned: P2P.P2PTypes.SignedObject<SeedNodesList>
  try {
    seedListSigned = await http.post(
      nodeListUrl,
      Context.crypto.sign({
        nodeInfo,
      }),
      false,
      10000
    )
  } catch (e) {
    /* prettier-ignore */ nestedCountersInstance.countRareEvent( 'archiver_nodelist', 'Could not get seed list from seed node server' )
    /* prettier-ignore */ if (logFlags.important_as_fatal) warn(`Could not get seed list from seed node server ${nodeListUrl}: ` + e.message)
    throw Error(e.message)
  }
  if (logFlags.p2pNonFatal) info(`Got signed seed list: ${JSON.stringify(seedListSigned)}`)
  return seedListSigned
}

export async function getFullNodesFromArchiver(
  archiver: P2P.SyncTypes.ActiveNode = Context.config.p2p.existingArchivers[0]
): Promise<SignedObject<{ nodeList: P2P.NodeListTypes.Node[] }>> {
  const nodeListUrl = `http://${archiver.ip}:${archiver.port}/full-nodelist`
  let fullNodeList: SignedObject<{ nodeList: P2P.NodeListTypes.Node[] }>
  try {
    fullNodeList = await http.get(nodeListUrl)
  } catch (e) {
    throw Error(`Fatal: Could not get seed list from seed node server ${nodeListUrl}: ` + e.message)
  }
  if (logFlags.p2pNonFatal) info(`Got signed full node list: ${JSON.stringify(fullNodeList)}`)
  return fullNodeList
}

//todo should move to p2p types
export type NodeInfo = {
  id: string
  publicKey: string
  curvePublicKey: string
} & network.IPInfo & {
    status: P2P.P2PTypes.NodeStatus
  }

export function getPublicNodeInfo(reportIntermediateStatus = false): NodeInfo {
  const publicKey = Context.crypto.getPublicKey()
  const curvePublicKey = Context.crypto.convertPublicKeyToCurve(publicKey)
  const status = { status: getNodeStatus(publicKey, reportIntermediateStatus) }
  const nodeInfo = Object.assign({ id, publicKey, curvePublicKey }, network.ipInfo, status)
  return nodeInfo
}

function getNodeStatus(pubKey: string, reportIntermediateStatus = false): P2P.P2PTypes.NodeStatus {
  const current = NodeList.byPubKey
  if (current.get(pubKey)) return current.get(pubKey).status
  return reportIntermediateStatus ? state : null
}

export function getThisNodeInfo(): {
  publicKey: string
  externalIp: string
  externalPort: number
  internalIp: string
  internalPort: number
  address: string
  joinRequestTimestamp: number
  activeTimestamp: number
  syncingTimestamp: number
} {
  const { externalIp, externalPort, internalIp, internalPort } = network.ipInfo
  const publicKey = Context.crypto.getPublicKey()
  // TODO: Change this to actual selectable address
  const address = publicKey
  const joinRequestTimestamp = utils.getTime('s')
  const activeTimestamp = 0
  const syncingTimestamp = 0
  const nodeInfo = {
    publicKey,
    externalIp,
    externalPort,
    internalIp,
    internalPort,
    address,
    joinRequestTimestamp,
    activeTimestamp,
    syncingTimestamp,
  }
  if (logFlags.p2pNonFatal) info(`Node info of this node: ${JSON.stringify(nodeInfo)}`)
  return nodeInfo
}

export function setActive(): void {
  isActive = true
}

export function setp2pIgnoreJoinRequests(value: boolean): void {
  p2pIgnoreJoinRequests = value
}

function info(...msg: string[]): void {
  const entry = `Self: ${msg.join(' ')}`
  p2pLogger.info(entry)
}

function warn(...msg: string[]): void {
  const entry = `Self: ${msg.join(' ')}`
  p2pLogger.warn(entry)
}

// debug functions
export function setIsFirst(val: boolean): void {
  isFirst = val
}

export function getIsFirst(): boolean {
  return isFirst
}

function acceptedTrigger(): Promise<void> {
  return new Promise((resolve) => {
    Acceptance.getEventEmitter().once('accepted', () => {
      resolve()
    })
  })
}
