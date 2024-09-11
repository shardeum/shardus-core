import { addSchema } from '../../utils/serialization/SchemaHelpers'
import { AJVSchemaEnum } from '../enum/AJVSchemaEnum'
import { schemaWrappedData } from './WrappedData'

export const schemaSign = {
  type: 'object',
  properties: {
    owner: { type: 'string' },
    sig: { type: 'string' },
  },
  required: ['owner', 'sig'],
}

export const schemaAppliedVote = {
  type: 'object',
  properties: {
    txid: { type: 'string' },
    transaction_result: { type: 'boolean' },
    account_id: {
      type: 'array',
      items: { type: 'string' },
    },
    account_state_hash_after: {
      type: 'array',
      items: { type: 'string' },
    },
    account_state_hash_before: {
      type: 'array',
      items: { type: 'string' },
    },
    cant_apply: { type: 'boolean' },
    node_id: { type: 'string' },
    sign: schemaSign,
    app_data_hash: { type: 'string' },
  },
  required: [
    'txid',
    'transaction_result',
    'account_id',
    'account_state_hash_after',
    'account_state_hash_before',
    'cant_apply',
    'node_id',
  ],
}

export const schemaConfirmOrChallengeMessage = {
  type: 'object',
  properties: {
    message: { type: 'string' },
    nodeId: { type: 'string' },
    appliedVote: schemaAppliedVote,
    sign: schemaSign,
  },
  required: ['message', 'nodeId', 'appliedVote'],
}

export const schemaProposal = {
  type: 'object',
  properties: {
    applied: { type: 'boolean' },
    cant_preApply: { type: 'boolean' },
    accountIDs: {
      type: 'array',
      items: { type: 'string' },
    },
    beforeStateHashes: {
      type: 'array',
      items: { type: 'string' },
    },
    afterStateHashes: {
      type: 'array',
      items: { type: 'string' },
    },
    appReceiptDataHash: { type: 'string' },
    txid: { type: 'string' },
  },
  required: [
    'applied',
    'cant_preApply',
    'accountIDs',
    'beforeStateHashes',
    'afterStateHashes',
    'appReceiptDataHash',
  ],
}

export const schemaSignedReceipt = {
  type: 'object',
  properties: {
    proposal: schemaProposal,
    proposalHash: { type: 'string' },
    signaturePack: {
      type: 'array',
      items: schemaSign,
    },
    voteOffsets: {
      type: 'array',
      items: { type: 'number' },
    },
    sign: schemaSign,
  },
  required: ['proposal', 'proposalHash', 'signaturePack', 'voteOffsets'],
}

export const schemaAccountRepairInstruction = {
  type: 'object',
  properties: {
    accountID: { type: 'string' },
    hash: { type: 'string' },
    txId: { type: 'string' },
    accountData: schemaWrappedData,
    targetNodeId: { type: 'string' },
    signedReceipt: schemaSignedReceipt,
  },
  required: ['accountID', 'hash', 'txId', 'accountData', 'targetNodeId', 'signedReceipt'],
}

export const schemaRepairOOSAccountsReq = {
  type: 'object',
  properties: {
    repairInstructions: {
      type: 'array',
      items: schemaAccountRepairInstruction,
    },
  },
  required: ['repairInstructions'],
}

export function initRepairOOSAccountReq(): void {
  addSchemaDependencies()
  addSchemas()
}

function addSchemaDependencies(): void {
  // No dependencies
}

function addSchemas(): void {
  addSchema(AJVSchemaEnum.RepairOOSAccountsReq, schemaRepairOOSAccountsReq)
}
