import { addSchema } from '../../utils/serialization/SchemaHelpers'
import { AJVSchemaEnum } from '../enum/AJVSchemaEnum'
import { schemaCachedAppData } from './CachedAppData'

const schemaSendCachedAppDataReq = {
  type: 'object',
  properties: {
    topic: { type: 'string' },
    txId: { type: 'string' },
    executionShardKey: { type: 'string' },
    cachedAppData: schemaCachedAppData,
  },
  required: ['topic', 'cachedAppData', 'executionShardKey', 'txId'],
  additionalProperties: false,
}

export function initSendCachedAppDataReq(): void {
  addSchemaDependencies()
  addSchemas()
}

// Function to add schema dependencies
function addSchemaDependencies(): void {
  // No dependencies
}

// Function to register the schema
function addSchemas(): void {
  addSchema(AJVSchemaEnum.SendCachedAppDataReq, schemaSendCachedAppDataReq)
}
