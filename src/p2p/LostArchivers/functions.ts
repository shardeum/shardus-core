/** Lost Archiver Detection Functions */

import { P2P } from '@shardus/types'
import * as Comms from '../Comms'
import { generateUUID } from '../Utils'
import { currentCycle, currentQuarter } from '../CycleCreator'
import { stringForKeys } from '../../utils'
import { info, initLogging } from './logging'
import { routes } from './routes'
import { ScheduledLostReport } from '../Lost'

type ScheduledLostArchiverReport = ScheduledLostReport<P2P.ArchiversTypes.JoinedArchiver>

/** CycleCreator Functions */

/* These functions must be defined by all modules that implement a 
     network action like going active, lost node detection, etc.
     These functions are called by CycleCreator
*/

export function init(): void {
  initLogging()

  // Init state
  reset()

  // Register routes
  for (const [name, handler] of Object.entries(routes.internal)) {
    Comms.registerInternal(name, handler)
  }
  for (const [name, handler] of Object.entries(routes.gossip)) {
    Comms.registerGossipHandler(name, handler)
  }
}

export function reset(): void {
  info('Reset function called')
}

export function getTxs(): P2P.TemplateTypes.Txs {
  info('getTxs function called')
  return
}

export function dropInvalidTxs(txs: P2P.TemplateTypes.Txs): P2P.TemplateTypes.Txs {
  info('dropInvalidTxs function called')
  return
}

/*
Given the txs and prev cycle record mutate the referenced record
*/
export function updateRecord(
  txs: P2P.TemplateTypes.Txs,
  record: P2P.CycleCreatorTypes.CycleRecord,
  prev: P2P.CycleCreatorTypes.CycleRecord
): void {
  info('updateRecord function called')
}

export function parseRecord(record: P2P.CycleCreatorTypes.CycleRecord): P2P.CycleParserTypes.Change {
  info('parseRecord function called')
  return
}

export function queueRequest(request: any): void {
  info('queueRequest function called')
}

export function sendRequests(): void {
  info('sendRequests function called')
}

/** Lost Archivers Functions */

/**
 * The accumulated lost reports from invocations of scheduleLostArchiverReport().
 * Key is 'publicKey-ip-port-cycle'.
 */
const scheduledForLostReport = new Map<string, ScheduledLostArchiverReport>()

export function scheduleLostArchiverReport(
  archiver: P2P.ArchiversTypes.JoinedArchiver,
  reason: string,
  requestId: string | null = null
): void {
  if (!requestId) requestId = generateUUID()
  /* prettier-ignore */ info(`scheduleLostArchiverReport(): target: ${stringForKeys(archiver, 'publicKey ip port')}, reason: ${reason}, requestId: ${requestId}, currentCycle: ${currentCycle}, currentQuarter: ${currentQuarter}`)
  const key = `${archiver.publicKey}-${archiver.ip}-${archiver.port}-${currentCycle}`
  if (scheduledForLostReport.has(key)) {
    const previousScheduleValue = scheduledForLostReport.get(key)
    /* prettier-ignore */ info(`Target node ${archiver.publicKey} already scheduled for lost report, previous report: ${JSON.stringify(previousScheduleValue)}`)
    // to-do: return here or fall through? lost node detection falls through, thereby overwriting the previous report; was that intentional?
  }
  scheduledForLostReport.set(key, {
    reason: reason,
    targetNode: archiver,
    timestamp: Date.now(),
    scheduledInCycle: currentCycle,
    requestId: requestId,
  })
}

/**
 * This function is called whenever communication with an Archiver
 * breaks down to let the network start the process of marking it as Lost.
 */
function reportLost(): void {
  // Mark the Archiver that you want to report as lost in your data structure to hold lost things
  // During the next Q1:
  // Determine the investigator for the given Archiver
  // Create an investigate tx
  // Send it to the investigator
}

function investigateArchiver(): void {
  // Trigger investigation of a reported lost Archiver
  // Hit the ping endpoint of the Archiver to check if its up or down
  // If the Archiver is up, do nothing and the lost process for it ends
  // If the Archiver is down
  // wait for the next Q1
  // create a down tx
  // gossip it to the rest of the network
}

function reportArchiverUp(): void {
  // After an Archiver tells us its still up
  // We need to gossip the up message to the rest of the network
}
