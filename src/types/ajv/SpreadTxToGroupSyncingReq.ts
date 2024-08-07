import { addSchema, addSchemaDependency } from '../../utils/serialization/SchemaHelpers';

export const schemaSpreadTxToGroupSyncingReq = {
  type: 'object',
  properties: {
    timestamp: { type: 'number' },
    txId: { type: 'string' },
    keys: { $ref: 'TransactionKeys' },
    data: { $ref: 'OpaqueTransaction' },
    appData: { type: 'unknown' },
    shardusMemoryPatterns: { $ref: 'ShardusMemoryPatternsInput' },
  },
  required: ['timestamp', 'txId', 'keys', 'data', 'appData', 'shardusMemoryPatterns'],
};

export const schemaTransactionKeys = {
  type: 'object',
  properties: {
    sourceKeys: { type: 'array', items: { type: 'string' } },
    targetKeys: { type: 'array', items: { type: 'string' } },
    allKeys: { type: 'array', items: { type: 'string' } },
    timestamp: { type: 'number' },
    debugInfo: { type: 'string' },
  },
  required: ['sourceKeys', 'targetKeys', 'allKeys', 'timestamp'],
};

export const schemaOpaqueTransaction = { type: 'object' };

export const schemaShardusMemoryPatternsInput = {
  type: 'object',
  properties: {
    ro: { type: 'array', items: { type: 'string' } },
    rw: { type: 'array', items: { type: 'string' } },
    wo: { type: 'array', items: { type: 'string' } },
    on: { type: 'array', items: { type: 'string' } },
    ri: { type: 'array', items: { type: 'string' } },
  },
  required: ['ro', 'rw', 'wo', 'on', 'ri'],
};

export function initSpreadTxToGroupSyncingReq(): void {
  addSchemaDependencies();
  addSchemas();
}

export function addSchemaDependencies(): void {
  addSchemaDependency('TransactionKeys', 'SpreadTxToGroupSyncingReq');
  addSchemaDependency('OpaqueTransaction', 'SpreadTxToGroupSyncingReq');
  addSchemaDependency('ShardusMemoryPatternsInput', 'SpreadTxToGroupSyncingReq');
}

export function addSchemas(): void {
  addSchema('TransactionKeys', schemaTransactionKeys);
  addSchema('OpaqueTransaction', schemaOpaqueTransaction);
  addSchema('ShardusMemoryPatternsInput', schemaShardusMemoryPatternsInput);
  addSchema('SpreadTxToGroupSyncingReq', schemaSpreadTxToGroupSyncingReq);
}
