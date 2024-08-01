import { addSchema } from '../../utils/serialization/SchemaHelpers'
import { AJVSchemaEnum } from '../enum/AJVSchemaEnum'

export const schemaCachedAppData = {
  type: 'object',
  properties: {
    cycle: { type: 'number' },
    appData: { type: 'object' },
    dataID: { type: 'string' },
  },
  required: ['cycle', 'appData', 'dataID'],
}

export function initCachedAppData(): void {
  addSchemaDependencies()
  addSchemas()
}

// Function to add schema dependencies
function addSchemaDependencies(): void {
  // No dependencies
}

// Function to register the schema
function addSchemas(): void {
  addSchema(AJVSchemaEnum.CachedAppData, schemaCachedAppData)
}
