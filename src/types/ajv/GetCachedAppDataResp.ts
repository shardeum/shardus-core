import { addSchema } from '../../utils/serialization/SchemaHelpers'
import { AJVSchemaEnum } from '../enum/AJVSchemaEnum'

export const schemaGetCachedAppDataResp = {
  type: 'object',
  properties: {
    cachedAppData: {
      type: 'object',
      properties: {
        dataID: { type: 'string' },
        appData: {},
        cycle: { type: 'number' },
      },
      required: ['dataID', 'appData', 'cycle'],
      additionalProperties: false,
    },
  },
  additionalProperties: false,
}

export function initGetCachedAppDataResp(): void {
  addSchemaDependencies()
  addSchemas()
}

function addSchemaDependencies(): void {
  // No dependencies
}

function addSchemas(): void {
  addSchema(AJVSchemaEnum.GetCachedAppDataResp, schemaGetCachedAppDataResp)
}
