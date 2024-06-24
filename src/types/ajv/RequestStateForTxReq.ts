
import { addSchema } from "../../utils/serialization/SchemaHelpers";
import { InternalRouteEnum } from "../enum/InternalRouteEnum";
import { AJV_IDENT } from "./Helpers";
import { schemaWrappedData } from "./WrappedData";

export const shcemaRequestStateForTxReq = {
  type: "object",
  properties: {
    txid: { type: "string" },
    timestamp: { type: "number" },
    keys: {
      type: "array",
      items: { type: "string" }
    }
  },
  required: ["txid", "timestamp", "keys"]
};

export function initRequestStateForTxReq(): void {
  addSchemaDependencies();
  addSchemas();
}

function addSchemaDependencies(): void {

}

function addSchemas(): void {
  addSchema(AJV_IDENT.REQUEST_STATE_FOR_TX_REQ, shcemaRequestStateForTxReq);
}
