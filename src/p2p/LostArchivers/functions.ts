import { P2P } from '@shardus/types'

import { generateUUID } from '../Utils'
import { getRandom, stringForKeys } from '../../utils'
import { currentCycle, currentQuarter } from '../CycleCreator'
import { config, crypto, network } from '../Context'
import { ScheduledLostReport } from '../Lost'
import * as Comms from '../Comms'
import * as NodeList from '../NodeList'
import * as Self from '../Self'
import * as http from '../../http'

import { info, initLogging } from './logging'
import { routes } from './routes'
import { ArchiverInvestigateTransaction } from './txs'
import { ActiveNode } from '@shardus/types/build/src/p2p/SyncTypes'

type ScheduledLostArchiverReport = ScheduledLostReport<ActiveNode>

/** CycleCreator Functions */

/* These functions must be defined by all modules that implement a 
     network action like going active, lost node detection, etc.
     These functions are called by CycleCreator
*/

export function init(): void {
  initLogging()
  info('init() called')

  // Init state
  reset()

  // Register routes
  for (const route of routes.external) {
    network._registerExternal(route.method, route.name, route.handler)
  }
  for (const route of routes.internal) {
    Comms.registerInternal(route.name, route.handler)
  }
  for (const [name, handler] of Object.entries(routes.gossip)) {
    Comms.registerGossipHandler(name, handler)
  }
}

export function reset(): void {
  info('reset() called')
}

export function getTxs(): P2P.TemplateTypes.Txs {
  info('getTxs() called')
  return
}

export function dropInvalidTxs(txs: P2P.TemplateTypes.Txs): P2P.TemplateTypes.Txs {
  info('dropInvalidTxs() called')
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

/**
 * This is called once per cycle at the start of Q1 by CycleCreator.
 */
export function sendRequests(): void {
  info('sendRequests function called')
  info(
    `currentCycle: ${currentCycle}, delayLostReportByNumOfCycles: ${config.p2p.delayLostReportByNumOfCycles}`
  )
  scheduledForLostReport.forEach((value: ScheduledLostArchiverReport, key: string) => {
    info(`key: ${key}, value: ${JSON.stringify(value)}`)
    if (value.scheduledInCycle < currentCycle - config.p2p.delayLostReportByNumOfCycles) {
      /* prettier-ignore */ info(`Reporting lost: requestId: ${value.requestId}, scheduled in cycle: ${value.scheduledInCycle}, reporting in cycle ${currentCycle}, originally reported at ${value.timestamp}`)
      triggerInvestigation(value)
      scheduledForLostReport.delete(key)
    }
  })
  // to-do: original Lost.ts then loops through `lost` map here
}

/** Lost Archivers Functions */

/**
 * The accumulated lost reports from invocations of scheduleLostArchiverReport().
 * Key is 'publicKey-ip-port-cycle'.
 */
const scheduledForLostReport = new Map<string, ScheduledLostArchiverReport>()

/**
 * This function is called whenever communication with an Archiver
 * breaks down to let the network start the process of marking it as Lost.
 */
export function scheduleLostArchiverReport(
  archiver: ActiveNode,
  reason: string,
  requestId: string | null = null
): void {
  // to-do: this needs to be invoked from more places in Archivers.ts
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

function triggerInvestigation(report: ScheduledLostArchiverReport): void {
  const targetNode = report.targetNode
  if (NodeList.activeByIdOrder.length === 1) {
    // to-do: when we're the only node left, should we just mark the archiver as down? maybe the network is getting started/warmed up
    return
  }
  // the report is not gossiped to other nodes, so we don't need a deterministic pick,
  // but we do have to make sure we don't pick ourselves
  let investigator: P2P.NodeListTypes.Node
  do {
    // to-do: question: do we know in Q1 that the activeByIdOrder is up to date?
    investigator = getRandom(NodeList.activeByIdOrder, 1)[0]
    // to-do: should the while condition have "... || !isPingable(investigator)"?
  } while (investigator.id === Self.id)
  const tx: ArchiverInvestigateTransaction = {
    publicKey: targetNode.publicKey,
    ip: targetNode.ip,
    port: targetNode.port,
  }
  Comms.tell([investigator], 'investigate-tx', crypto.sign(tx))
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

/**
 * Returns true if the archiver can be pinged.
 */
async function pingArchiver(host: string, port: number): Promise<boolean> {
  // the /nodeInfo endpoint is used to ping the archiver because it's cheap
  return (await getArchiverInfo(host, port)) !== null
}

/**
 * Returns the JSON object from the archiver's nodeInfo endpoint, or null if the archiver is not reachable.
 * Keys include publicKey, ip, port, version and time.
 */
async function getArchiverInfo(host: string, port: number): Promise<object> | null {
  /*
  Example:
    {
      "publicKey": "840e7b59a95d3c5f5044f4bc62ab9fa94bc107d391001141410983502e3cde63",
      "ip": "45.79.43.36",
      "port": 4000,
      "version": "3.3.8",
      "time": 1697852551464
    }
  */
  try {
    return await http.get<object>(`http://${host}:${port}/nodeInfo`)
  } catch (e) {
    return null
  }
}
