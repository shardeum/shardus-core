import { addSchema } from "../../utils/serialization/SchemaHelpers";
import { InternalRouteEnum } from "../enum/InternalRouteEnum";
import { schemaWrappedData } from "./WrappedData";

export const schemaSign = {
  type: "object",
  properties: {
    owner: { type: "string" },
    sig: { type: "string" }
  },
  required: ["owner", "sig"]
};

export const schemaAppliedVote = {
  type: "object",
  properties: {
    txid: { type: "string" },
    transaction_result: { type: "boolean" },
    account_id: {
      type: "array",
      items: { type: "string" }
    },
    account_state_hash_after: {
      type: "array",
      items: { type: "string" }
    },
    account_state_hash_before: {
      type: "array",
      items: { type: "string" }
    },
    cant_apply: { type: "boolean" },
    node_id: { type: "string" },
    sign: schemaSign,
    app_data_hash: { type: "string" }
  },
  required: [
    "txid",
    "transaction_result",
    "account_id",
    "account_state_hash_after",
    "account_state_hash_before",
    "cant_apply",
    "node_id"
  ]
};

export const schemaConfirmOrChallengeMessage = {
  type: "object",
  properties: {
    message: { type: "string" },
    nodeId: { type: "string" },
    appliedVote: schemaAppliedVote,
    sign: schemaSign
  },
  required: ["message", "nodeId", "appliedVote"]
};

export const schemaAppliedReceipt2 = {
  type: "object",
  properties: {
    txid: { type: "string" },
    result: { type: "boolean" },
    appliedVote: schemaAppliedVote,
    confirmOrChallenge: schemaConfirmOrChallengeMessage,
    signatures: {
      type: "array",
      items: schemaSign
    },
    app_data_hash: { type: "string" }
  },
  required: [
    "txid",
    "result",
    "appliedVote",
    "signatures",
    "app_data_hash"
  ]
};

export const schemaAccountRepairInstruction = {
  type: "object",
  properties: {
    accountID: { type: "string" },
    hash: { type: "string" },
    txId: { type: "string" },
    accountData: schemaWrappedData,
    targetNodeId: { type: "string" },
    receipt2: schemaAppliedReceipt2
  },
  required: [
    "accountID",
    "hash",
    "txId",
    "accountData",
    "targetNodeId",
    "receipt2"
  ]
};

export const schemaRepairOOSAccountsReq = {
  type: "object",
  properties: {
    repairInstructions: {
      type: "array",
      items: schemaAccountRepairInstruction 
    }
  },
  required: ["repairInstructions"]
};

export function initRepairOOSAccountReq(): void {
  addSchemaDependencies()
  addSchemas()
}

function addSchemaDependencies(): void {
}

function addSchemas(): void {
  addSchema(InternalRouteEnum.binary_repair_oos_accounts, schemaRepairOOSAccountsReq)
}
