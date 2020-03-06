import { p2p } from './P2PContext'
import { insertSorted } from '../utils';
import * as Sequelize from 'sequelize';
import { Logger } from 'log4js';
import { P2PModuleContext } from './p2p-types';

/** TYPES */
interface LooseObject {
  [index: string]: unknown;
}

export interface SignedObject extends LooseObject {
  sign: {
    owner: string;
    sig: string;
  };
}

interface ApoptosisProposal {
  id: string;
}

type SignedApoptosisProposal = ApoptosisProposal & SignedObject;

/** STATE */

export const cycleDataName = 'apoptosized';
export const cycleUpdatesName = 'apoptosis';
export const internalRouteName = 'apoptosize';
export const gossipRouteName = 'apoptosis';

let apoptosisProposals: { [publicKey: string]: ApoptosisProposal } = {};

/** ROUTES */

export const internalRoutes = [
  {
    name: internalRouteName,
    handler: (payload, respond) => {
      log(`Got proposal: ${JSON.stringify(payload)}`);
      if (addProposal(payload)) p2p.sendGossipIn(gossipRouteName, payload);
    },
  },
];

export const gossipRoutes = [
  {
    name: gossipRouteName,
    handler: (payload, sender, tracker) => {
      log(`Got gossip: ${JSON.stringify(payload)}`);
      if (addProposal(payload)) {
        p2p.sendGossipIn(gossipRouteName, payload, tracker, sender);
      }
    },
  },
];

/** FUNCTIONS */

export async function apoptosizeSelf(activeNodes) {
  const proposal = createProposal();
  await p2p.tell(activeNodes, internalRouteName, proposal);
  log(`Sent apoptosize-self proposal: ${JSON.stringify(proposal)}`);
  addProposal(proposal);
}

function log(msg: string, level = 'info') {
  p2p.mainLogger[level]('P2PApoptosis: ' + msg);
}

function createProposal(): SignedApoptosisProposal {
  const proposal = {
    id: p2p.id,
  };
  return p2p.crypto.sign(proposal);
}

function addProposal(proposal: SignedApoptosisProposal): boolean {
  if (validateProposal(proposal) === false) return false;
  const publicKey = proposal.sign.owner;
  if (apoptosisProposals[publicKey]) return false;
  apoptosisProposals[publicKey] = proposal;
  log(`Marked ${proposal.id} for apoptosis`);
  return true;
}

function clearProposals() {
  apoptosisProposals = {};
}

function validateProposal(payload: unknown): boolean {
  // [TODO] Type checking
  if (!payload) return false;
  if (!(payload as LooseObject).id) return false;
  if (!(payload as SignedApoptosisProposal).sign) return false;
  const proposal = payload as SignedApoptosisProposal;
  const nodeId = proposal.id;

  // Check if node is in nodelist
  let node;
  try {
    node = p2p.state.getNode(nodeId);
  } catch (e) {
    return false;
  }

  // Check if signature is valid and signed by expected node
  const valid = p2p.crypto.verify(proposal, node.publicKey);
  if (!valid) return false;

  return true;
}

/** CYCLE HOOKS */

/**
 * Hook to let submodules reset their cycle updates and data fields
 */
export function resetCycle(cycleUpdates, cycleData) {
  cycleUpdates[cycleUpdatesName] = [];
  cycleData[cycleDataName] = [];
}

/**
 * Hook to let submodule add collected proposals to cycle
 */
export function proposalsToCycle(cycleUpdates, cycleData) {
  for (const publicKey of Object.keys(apoptosisProposals)) {
    const proposal = apoptosisProposals[publicKey];
    insertSorted(cycleUpdates[cycleUpdatesName], proposal);
    insertSorted(cycleData[cycleDataName], proposal.id);
  }
  clearProposals();
}

/**
 * Hook to let submodules apply received cycle updates to cycle
 */
export function updatesToCycle(cycleUpdates, cycleData): boolean {
  const newCycleData = [];
  for (const proposal of cycleUpdates[cycleUpdatesName]) {
    if (validateProposal(proposal) === false) return false;
    insertSorted(newCycleData, proposal.id);
  }
  cycleData[cycleDataName] = newCycleData;
  return true;
}

/**
 * Hook to let submodules apply cycle data to the actual p2p state
 */
export async function cycleToState(cycleData) {
  const apoptosizedIds: string[] = cycleData[cycleDataName];
  if (Array.isArray(apoptosizedIds) === false) return;
  if (apoptosizedIds.length < 1) return;

  const apoptosizedNodes = apoptosizedIds.reduce((arr: any[], id: string) => {
    // [TODO] [HACK] Don't restart on being apoptosized, so that logs are preserved
    if (id === p2p.id) {
      log(`I have been apoptosized, exiting with code 1...`);
      process.exit(1);
    }
    arr.push(p2p.state.getNode(id));
    return arr;
  }, []);

  p2p.state.removeNodes(apoptosizedNodes);

  log(
    `Removed apoptosized nodes from nodelist: ${JSON.stringify(
      apoptosizedNodes
    )}`
  );
}

/** STORAGE DATA */

export const addCycleFieldQuery = `ALTER TABLE cycles ADD ${cycleDataName} JSON NULL`;

export const sequelizeCycleFieldModel = {
  [cycleDataName]: { type: Sequelize.JSON, allowNull: true },
};
