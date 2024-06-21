import { addSchema } from "../../utils/serialization/SchemaHelpers";
import { AJV_IDENT } from "./Helpers";
import { schemaWrappedData } from "./WrappedData";

export const schemaRequestStateForTxResp = {
  type: "object",
  properties: {
    stateList: schemaWrappedData,
    beforeHashes: {
      type: "object",
    },
    note: { type: "string" },
    success: { type: "boolean" }
  },
  required: ["stateList", "beforeHashes", "note", "success"]
};

export function initRequestStateForTxResp(): void {
  addSchemaDependencies();
  addSchemas();
}

function addSchemaDependencies(): void {
  // No dependencies
}

function addSchemas(): void {
  addSchema(AJV_IDENT.REQUEST_STATE_FOR_TX_RESP, schemaRequestStateForTxResp);
}
