import { addSchema } from "../../utils/serialization/SchemaHelpers";
import { AJV_IDENT } from "./Helpers";

export const schemaRequestReceiptForTxReq = {
  type: "object",
  properties: {
    txid: { type: "string" },
    timestamp: { type: "number" }
  },
  required: ["txid", "timestamp"]
};

export function initRequestReceiptForTxReq(): void {
  addSchemaDependencies();
  addSchemas();
}

function addSchemaDependencies(): void {
  // No dependencies
}

function addSchemas(): void {
  addSchema(AJV_IDENT.REQUEST_RECEIPT_FOR_TX_REQ, schemaRequestReceiptForTxReq);
}


