import { addSchema } from '../../utils/serialization/SchemaHelpers'

const schemaSign = {
  type: 'object',
  properties: {
    owner: { type: 'string' },
    sig: { type: 'string' },
  },
  required: ['owner', 'sig'],
}

const schemaAppliedVote = {
  type: 'object',
  properties: {
    txid: { type: 'string' },
    transaction_result: { type: 'boolean' },
    account_id: { type: 'array', items: { type: 'string' } },
    account_state_hash_after: { type: 'array', items: { type: 'string' } },
    account_state_hash_before: { type: 'array', items: { type: 'string' } },
    cant_apply: { type: 'boolean' },
    node_id: { type: 'string' },
    sign: { $ref: 'Sign' },
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
    'app_data_hash',
  ],
}

const schemaConfirmOrChallengeMessage = {
  type: 'object',
  properties: {
    message: { type: 'string' },
    nodeId: { type: 'string' },
    appliedVote: { $ref: 'AppliedVote' },
    sign: { $ref: 'Sign' },
  },
  required: ['message', 'nodeId', 'appliedVote'],
}

const schemaAppliedReceipt2 = {
  type: 'object',
  properties: {
    txid: { type: 'string' },
    result: { type: 'boolean' },
    appliedVote: { $ref: 'AppliedVote' },
    confirmOrChallenge: { $ref: 'ConfirmOrChallengeMessage' },
    signatures: { type: 'array', items: schemaSign },
    app_data_hash: { type: 'string' },
  },
  required: ['txid', 'result', 'appliedVote', 'confirmOrChallenge', 'signatures', 'app_data_hash'],
}

const schemaAccountRepairInstruction = {
  type: 'object',
  properties: {
    accountID: { type: 'string' },
    hash: { type: 'string' },
    txId: { type: 'string' },
    accountData: { $ref: 'WrappedData' },
    targetNodeId: { type: 'string' },
    receipt2: { $ref: 'AppliedReceipt2' },
  },
  required: ['accountID', 'hash', 'txId', 'accountData', 'targetNodeId', 'receipt2'],
}

const schemaRepairMissingAccountsReq = {
  type: 'object',
  properties: {
    repairInstructions: {
      type: 'array',
      items: schemaAccountRepairInstruction,
    },
  },
  required: ['repairInstructions'],
}

export function initRepairMissingAccountsReq(): void {
  addSchemaDependencies()
  addSchemas()
}

// Function to add schema dependencies
function addSchemaDependencies(): void {
  // No dependencies
}

// Function to register the schema
function addSchemas(): void {
  addSchema('Sign', schemaSign)
  addSchema('AppliedVote', schemaAppliedVote)
  addSchema('ConfirmOrChallengeMessage', schemaConfirmOrChallengeMessage)
  addSchema('AppliedReceipt2', schemaAppliedReceipt2)
  addSchema('RepairMissingAccountsReq', schemaRepairMissingAccountsReq)
}
