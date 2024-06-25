import { addSchema } from '../../utils/serialization/SchemaHelpers'
import { AJV_IDENT } from './Helpers'

export const schemaLostReportReq = {
  type: 'object',
  properties: {
    target: { type: 'string' },
    checker: { type: 'string' },
    reporter: { type: 'string' },
    cycle: { type: 'number' },
    timestamp: { type: 'number' },
    requestId: { type: 'string' },
    sign: {
      type: 'object',
      properties: {
        owner: { type: 'string' },
        sig: { type: 'string' },
      },
      required: ['owner', 'sig'],
    },
    killother: { type: 'boolean' },
  },
  required: ['target', 'checker', 'reporter', 'cycle', 'timestamp', 'requestId', 'sign'],
}

export function initLostReportReq(): void {
  addSchemaDependencies()
  addSchemas()
}

function addSchemaDependencies(): void {
  // No dependencies
}

function addSchemas(): void {
  addSchema(AJV_IDENT.LOST_REPORT_REQ, schemaLostReportReq)
}
