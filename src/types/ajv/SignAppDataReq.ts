import { addSchema } from '../../utils/serialization/SchemaHelpers'
import { AJVSchemaEnum } from '../enum/AJVSchemaEnum'

export const schemaSignAppDataReq = {
  type: 'object',
  properties: {
    type: { type: 'string' },
    nodesToSign: { type: 'number' },
    hash: { type: 'string' },
    appData: {}, // type unknown
  },
  required: ['type', 'nodesToSign', 'hash', 'appData'],
}

export function initSignAppDataReq(): void {
  addSchemaDependencies()
  addSchemas()
}

// Function to add schema dependencies
function addSchemaDependencies(): void {
  // No dependencies
}

// Function to register the schema
function addSchemas(): void {
  addSchema(AJVSchemaEnum.SignAppDataReq, schemaSignAppDataReq)
}
