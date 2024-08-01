import { addSchema } from '../../utils/serialization/SchemaHelpers'
import { AJVSchemaEnum } from '../enum/AJVSchemaEnum'

export const schemaGetCachedAppDataReq = {
  type: 'object',
  properties: {
    topic: { type: 'string' },
    dataId: { type: 'string' },
  },
  required: ['topic', 'dataId'],
  additionalProperties: false,
}

export function initGetCachedAppDataReq(): void {
  addSchemaDependencies()
  addSchemas()
}

function addSchemaDependencies(): void {
  // No dependencies
}

function addSchemas(): void {
  addSchema(AJVSchemaEnum.GetCachedAppDataReq, schemaGetCachedAppDataReq)
}
