import { addSchema, addSchemaDependency } from '../../utils/serialization/SchemaHelpers'
import { AJV_IDENT } from './Helpers'
import { schemaWrappedDataResponse } from './WrappedDataResponse'

const schemaBroadcastStateReq = {
  type: 'object',
  properties: {
    txid: { type: 'string' },
    stateList: {
      type: 'array',
      items: schemaWrappedDataResponse,
    },
  },
  required: ['txid', 'stateList'],
}
export function initBroadcastStateReq(): void {
  addSchemaDependencies()
  addSchemas()
}

function addSchemaDependencies(): void {}

function addSchemas(): void {
  addSchema(AJV_IDENT.BROADCAST_STATE_REQ, schemaBroadcastStateReq)
}
