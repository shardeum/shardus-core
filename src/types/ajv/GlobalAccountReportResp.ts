import { addSchema } from '../../utils/serialization/SchemaHelpers'
import { AJVSchemaEnum } from '../enum/AJVSchemaEnum'

export const schemaGlobalAccountReportResp = {
  type: 'object',
  oneOf: [
    {
      type: 'object',
      properties: {
        ready: { type: 'boolean' },
        combinedHash: { type: 'string' },
        accounts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              hash: { type: 'string' },
              timestamp: { type: 'number' },
            },
            required: ['id', 'hash', 'timestamp'],
          },
        },
      },
      required: ['ready', 'combinedHash', 'accounts'],
    },
    {
      type: 'object',
      properties: {
        error: { type: 'string' },
      },
      required: ['error'],
    },
  ],
}

export function initGlobalAccountReportResp(): void {
  addSchemaDependencies()
  addSchemas()
}

function addSchemaDependencies(): void {
  // No dependencies
}

function addSchemas(): void {
  addSchema(AJVSchemaEnum.GlobalAccountReportResp, schemaGlobalAccountReportResp)
}
