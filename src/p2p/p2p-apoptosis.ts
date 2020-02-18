import P2P from '.';
import { insertSorted } from '../utils';
import { EventEmitter } from 'events';
import * as Sequelize from 'sequelize';

/** TYPES */

type P2PType = P2P & EventEmitter;

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

export const cycleDataName = 'apoptosizedNodes';
export const cycleUpdatesName = 'apoptosisNodes';

let p2p: P2PType;

let apoptosisProposals: { [publicKey: string]: ApoptosisProposal } = {};

/** ROUTES */
export const internalRoutes = [
  {
    name: 'apoptosis',
    handler: (payload, respond) => {
      if (checkSignedApoptosisProposal(payload) === false) return;
      addProposal(payload);
      p2p.sendGossipIn('apoptosis', payload)
      respond({ apoptosized: true });
    },
  },
];

export const gossipRoutes = [
  {
    name: 'apoptosis',
    handler: (payload, sender, tracker) => {
      if (checkSignedApoptosisProposal(payload) === false) return
      addProposal(payload)
      p2p.sendGossipIn('apoptosis', payload, tracker, sender)
    }
  }
]

/** FUNCTIONS */

export function setContext(context: P2PType) {
  p2p = context;
}

export async function apoptosizeSelf(activeNodes) {
  const proposal = createProposal();
  await p2p.tell(activeNodes, 'apoptosis', proposal);
  addProposal(proposal);
}

function createProposal(): SignedApoptosisProposal {
  const proposal = {
    id: p2p.id,
  };
  return p2p.crypto.sign(proposal);
}

function addProposal(proposal: SignedApoptosisProposal) {
  const publicKey = proposal.sign.owner;
  apoptosisProposals[publicKey] = proposal;
}

function clearProposals() {
  apoptosisProposals = {};
}

function checkSignedApoptosisProposal(payload: unknown): boolean {
  // [TODO] Add validation

  // Check if node is in nodelist
  /*
  let node;
  try {
    node = this.getNode(nodeId);
  } catch (e) {
    this.mainLogger.debug(
      'Node not found in nodelist. Apoptosis message invalid.'
    );
    return false;
  }
  */

  // Check if signature is valid and signed by expected node
  /*
  const valid = this.crypto.verify(msg, node.publicKey);
  if (!valid) {
    this.mainLogger.debug(
      'Apoptosis message signature invalid. Unable to add message.'
    );
    return false;
  }
  */

  const proposal = payload as SignedApoptosisProposal

  // If we already have this guy marked for apoptosis, return false
  if (apoptosisProposals[proposal.sign.owner]) return false

  return true;
}

/** CYCLE HOOKS */

/**
 * Called by p2p.state at the start of every new cycle to let submodules
 * reset their cycle fields (and internal state)
 */
export function resetCycle(currentCycle) {
  currentCycle.updates[cycleUpdatesName] = [];
  currentCycle.data[cycleDataName] = [];
  clearProposals();
}

/**
 * Called by p2p.state during cycle Q3 to let submodules
 * add their changes to the current cycle BEFORE comparing updates
 */
export function addChangesToCycle(currentCycle) {
  for (const publicKey of Object.keys(apoptosisProposals)) {
    const proposal = apoptosisProposals[publicKey];
    insertSorted(currentCycle.updates[cycleUpdatesName], proposal);
    insertSorted(currentCycle.data[cycleDataName], proposal.id);
  }
}

/**
 * Called by p2p.state during cycle Q3 AFTER comparing updates to let
 * submodules apply received updates to their changes for the current cycle
 */
export function updateChangesToCycle(proposals) {
  // [TODO] Validate updates
  clearProposals();
  for (const proposal of proposals) addProposal(proposal);
}

/**
 * Called by p2p.state during cycle Q4 to let submodules
 * apply their changes in the current cycle to the actual p2p state
 */
export async function applyCycleChangesToState(ids) {
  // [TODO] Do some sanity checks here before actually applying the changes
  p2p.state.removeNodes(ids);
  return;
}

/** STORAGE DATA */

export const addCycleFieldQuery = `ALTER TABLE cycles ADD ${cycleDataName} JSON NULL`;

export const sequelizeCycleFieldModel = {
  [cycleDataName]: { type: Sequelize.JSON, allowNull: true },
};
