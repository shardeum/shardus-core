import { addSchema } from '../../utils/serialization/SchemaHelpers'
import { AJVSchemaEnum } from '../enum/AJVSchemaEnum'

export const schemaGlobalAccountReportReq = {
  type: 'object',
  properties: {},
  required: [],
}

export function initGlobalAccountReportReq(): void {
  addSchemaDependencies()
  addSchemas()
}

function addSchemaDependencies(): void {
  // No dependencies
}

function addSchemas(): void {
  addSchema(AJVSchemaEnum.GlobalAccountReportReq, schemaGlobalAccountReportReq)
}
