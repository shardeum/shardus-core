import { addSchema } from '../../utils/serialization/SchemaHelpers'
import { AJVSchemaEnum } from '../enum/AJVSchemaEnum'

export const schemaAddNetworkTx = {
  type: 'object',
  properties: {
    hash: { type: 'string' },
    type: { type: 'string' },
    txData: {},
    cycle: { type: 'number' },
    priority: { type: 'number' },
    involvedAddress: { type: 'string' },
    subQueueKey: { type: 'string', nullable: true },
  },
  required: ['hash', 'type', 'txData', 'cycle', 'priority', 'involvedAddress'],
}

export const schemaSign = {
  type: 'object',
  properties: {
    owner: { type: 'string' },
    sig: { type: 'string' },
  },
  required: ['owner', 'sig'],
}

export const schemaVerifierEntry = {
  type: 'object',
  properties: {
    hash: { type: 'string' },
    tx: schemaAddNetworkTx,
    votes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          txHash: { type: 'string' },
          verifierType: { type: 'string', enum: ['beforeAdd', 'apply'] },
          result: { type: 'boolean' },
          sign: schemaSign,
        },
        required: ['txHash', 'verifierType', 'result', 'sign'],
      },
    },
    newVotes: { type: 'boolean' },
    executionGroup: {
      type: 'array',
      items: { type: 'string' },
    },
    appliedReceipt: {},
    hasSentFinalReceipt: { type: 'boolean' },
    sign: schemaSign,
  },
  required: [
    'hash',
    'tx',
    'votes',
    'newVotes',
    'executionGroup',
    'appliedReceipt',
    'hasSentFinalReceipt',
    'sign',
  ],
}

export function initServiceQueueAddTxReq(): void {
  addSchemaDependencies()
  addSchemas()
}

export function addSchemaDependencies(): void {}

export function addSchemas(): void {
  addSchema(AJVSchemaEnum.ServiceQueueAddTxReq, schemaVerifierEntry)
}
