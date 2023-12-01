// TODO lots to do here!


/** FUNCTIONS */

import { P2P } from "@shardus/types"
import { logger } from "../Context"
import { routes } from "./routes"
import { p2pLogger } from "./data"

let p2pLogger

/** CycleCreator Functions */

/* These functions must be defined by all modules that implement a 
     network action like going active, lost node detection, etc.
     These functions are called by CycleCreator
*/

export function init(): void {
  // Init logger
  p2pLogger = logger.getLogger('p2p')

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
  p2pLogger.info('Reset function called')
}

export function getTxs(): P2P.TemplateTypes.Txs {
  p2pLogger.info('getTxs function called')
  return
}

export function dropInvalidTxs(txs: P2P.TemplateTypes.Txs): P2P.TemplateTypes.Txs {
  p2pLogger.info('dropInvalidTxs function called')
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
  p2pLogger.info('updateRecord function called')
}

export function parseRecord(record: P2P.CycleCreatorTypes.CycleRecord): P2P.CycleParserTypes.Change {
  p2pLogger.info('parseRecord function called')
  return
}

export function queueRequest(request: any): void {
  p2pLogger.info('queueRequest function called')
}

export function sendRequests(): void {
  p2pLogger.info('sendRequests function called')
}

/** Module Functions */

function info(...msg): void {
  const entry = `[CHANGE ME]: ${msg.join(' ')}`
  p2pLogger.info(entry)
}

function warn(...msg): void {
  const entry = `[CHANGE ME]: ${msg.join(' ')}`
  p2pLogger.warn(entry)
}

function error(...msg): void {
  const entry = `[CHANGE ME]: ${msg.join(' ')}`
  p2pLogger.error(entry)
}

/** Lost Archivers Functions */

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

/**
 * 
 */