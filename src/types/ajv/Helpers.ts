import { ErrorObject } from 'ajv'
import { getVerifyFunction } from '../../utils/serialization/SchemaHelpers'
import { initGetAccountData3Req } from './GetAccountData3Req'
import { initCompareCertReq } from './CompareCert'
import { initSpreadTxToGroupSyncingReq } from './SpreadTxToGroupSyncingReq'
import { initApoptosisProposal } from './ApoptosisProposalResp'
import { initGetTxTimestampReq } from './GetTxTimestampReq'
import { initGetTxTimestampResp } from './GetTxTimestampResp'
import { initGetAccountDataByListResp } from './GetAccountDataByListResp'
import { initGetAccountDataByListReq } from './GetAccountDataByListReq'
import { initGetAccountDataByHashesReq } from './GetAccountDataByHashesReq'
import { initGetAccountDataByHashesResp } from './GetAccountDataByHashesResp'
import { initWrappedData } from './WrappedData'
import { Utils } from '@shardus/types'
import { initRepairOOSAccountReq } from './RepairOOSAccountsReq'
import { initRequestStateForTxReq } from './RequestStateForTxReq'
import { initRequestStateForTxResp } from './RequestStateForTxResp'
import { initGetAppliedVoteReq } from './GetAppliedVoteReq'
import { initGetAppliedVoteResp } from './GetAppliedVoteResp'
import { initLostReportReq } from './LostReportReq'
import { initRequestReceiptForTxReq } from './RequestReceiptForTxReq'
import { initRequestReceiptForTxResp } from './RequestReceiptForTxResp'
import { initRepairMissingAccountsReq } from './RepairMissingAccountsReq'
import { initRequestStateForTxPostReq } from './RequestStateForTxPostReq'
import { initRequestStateForTxPostResp } from './RequestStateForTxPostResp'
import { initWrappedDataResponse } from './WrappedDataResponse'
import { initBroadcastStateReq } from './BroadcastStateReq'

export function initAjvSchemas(): void {
  initGetAccountData3Req()
  initCompareCertReq()
  initSpreadTxToGroupSyncingReq()
  initApoptosisProposal()
  initGetTxTimestampReq()
  initGetTxTimestampResp()
  initWrappedData()
  initGetAccountDataByListReq()
  initGetAccountDataByListResp()
  initGetAccountDataByHashesReq()
  initGetAccountDataByHashesResp()
  initRepairOOSAccountReq()
  initRequestStateForTxReq()
  initRequestStateForTxResp()
  initRequestReceiptForTxReq()
  initRequestReceiptForTxResp()
  initGetAppliedVoteReq()
  initGetAppliedVoteResp()
  initLostReportReq()
  initRepairMissingAccountsReq()
  initRequestStateForTxPostReq()
  initRequestStateForTxPostResp()
  initWrappedDataResponse()
  initBroadcastStateReq()
}

export function verifyPayload<T>(name: string, payload: T): string[] | null {
  const verifyFn = getVerifyFunction(name)
  const isValid = verifyFn(payload)
  if (!isValid) {
    return parseAjvErrors(verifyFn.errors)
  } else {
    return null
  }
}

function parseAjvErrors(errors: Array<ErrorObject> | null): string[] | null {
  if (!errors) return null

  return errors.map((error) => {
    let errorMsg = `${error.message}`
    if (error.params && Object.keys(error.params).length > 0) {
      errorMsg += `: ${Utils.safeStringify(error.params)}`
    }
    return errorMsg
  })
}

export enum AJV_IDENT {
  COMPARE_CERT_REQ = 'compareCertReq',
  REPAIR_OOS_ACCOUNTS_REQ = 'repairOOSAccountsReq',
  REQUEST_STATE_FOR_TX_REQ = 'requestStateForTxReq',
  REQUEST_STATE_FOR_TX_RESP = 'requestStateForTxResp',
  REQUEST_RECEIPT_FOR_TX_REQ = 'requestReceiptForTxReq',
  REQUEST_RECEIPT_FOR_TX_RESP = 'requestReceiptForTxResp',
  GET_APPLIED_VOTE_REQ = 'getAppliedVoteReq',
  GET_APPLIED_VOTE_RESP = 'getAppliedVoteResp',
  LOST_REPORT_REQ = 'lostReportReq',
  REQUEST_STATE_FOR_TX_POST_REQ = 'requestStateForTxPostReq',
  REQUEST_STATE_FOR_TX_POST_RESP = 'requestStateForTxPostResp',
  WRAPPED_DATA_RESPONSE = 'wrappedDataResponse',
  BROADCAST_STATE_REQ = 'BroadcastStateReq',
}
