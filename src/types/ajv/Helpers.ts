import { ErrorObject } from 'ajv'
import { getVerifyFunction } from '../../utils/serialization/SchemaHelpers'
import { initGetAccountData3Req } from './GetAccountData3Req'
import { initCompareCertReq } from './CompareCert'
import { initSpreadTxToGroupSyncingReq } from './SpreadTxToGroupSyncingReq'
import { initApoptosisProposalReq } from './ApoptosisProposalReq'
import { initApoptosisProposalResp } from './ApoptosisProposalResp'
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
import { initRequestStateForTxPostReq } from './RequestStateForTxPostReq'
import { initRequestStateForTxPostResp } from './RequestStateForTxPostResp'
import { initWrappedDataResponse } from './WrappedDataResponse'
import { initBroadcastStateReq } from './BroadcastStateReq'
import { initGetAccountDataRespSerializable } from './GetAccountDataResp'
import { initGetCachedAppDataReq } from './GetCachedAppDataReq'
import { initGetCachedAppDataResp } from './GetCachedAppDataResp'
import { initGetTrieAccountHashesReq } from './GetTrieAccountHashesReq'
import { initGetTrieAccountHashesResp } from './GetTrieAccountHashesResp'
import { initWrappedDataFromQueueSerializable } from './WrappedDataFromQueueSerializable'
import { initGetAccountDataWithQueueHintsReq } from './GetAccountDataWithQueueHintsReq'
import { initGetAccountDataWithQueueHintsResp } from './GetAccountDataWithQueueHintsResp'
import { initSpreadAppliedVoteHashReq } from './SpreadAppliedVoteHashReq'
import { initGlobalAccountReportReq } from './GlobalAccountReportReq'
import { initGlobalAccountReportResp } from './GlobalAccountReportResp'
import { initSyncTrieHashesReq } from './SyncTrieHashesReq'
import { initGetAccountQueueCountReq } from './GetAccountQueueCountReq'
import { initGetAccountQueueCountResp } from './GetAccountQueueCountResp'
import { initMakeReceiptReq } from './MakeReceiptReq'
import { initGetTrieHashesReq } from './GetTrieHashesReq'
import { initGetTrieHashesResp } from './GetTrieHashesResp'

export function initAjvSchemas(): void {
  initGetAccountData3Req()
  initCompareCertReq()
  initSpreadTxToGroupSyncingReq()
  initApoptosisProposalReq()
  initApoptosisProposalResp()
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
  initRequestStateForTxPostReq()
  initRequestStateForTxPostResp()
  initWrappedDataResponse()
  initBroadcastStateReq()
  initGetAccountDataRespSerializable()
  initGetCachedAppDataReq()
  initGetCachedAppDataResp()
  initGetTrieAccountHashesReq()
  initGetTrieAccountHashesResp()
  initWrappedDataFromQueueSerializable()
  initGetAccountDataWithQueueHintsReq()
  initGetAccountDataWithQueueHintsResp()
  initSpreadAppliedVoteHashReq()
  initGlobalAccountReportReq()
  initGlobalAccountReportResp()
  initSyncTrieHashesReq()
  initGetAccountQueueCountReq()
  initGetAccountQueueCountResp()
  initMakeReceiptReq()
  initGetTrieHashesReq()
  initGetTrieHashesResp()
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
