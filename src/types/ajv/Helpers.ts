import { Utils } from '@shardus/types'
import { ErrorObject } from 'ajv'
import { getVerifyFunction } from '../../utils/serialization/SchemaHelpers'
import { initApoptosisProposalReq } from './ApoptosisProposalReq'
import { initApoptosisProposalResp } from './ApoptosisProposalResp'
import { initBroadcastStateReq } from './BroadcastStateReq'
import { initCachedAppData } from './CachedAppData'
import { initCompareCertReq } from './CompareCert'
import { initGetAccountData3Req } from './GetAccountData3Req'
import { initGetAccountDataByHashesReq } from './GetAccountDataByHashesReq'
import { initGetAccountDataByHashesResp } from './GetAccountDataByHashesResp'
import { initGetAccountDataByListReq } from './GetAccountDataByListReq'
import { initGetAccountDataByListResp } from './GetAccountDataByListResp'
import { initGetAccountDataRespSerializable } from './GetAccountDataResp'
import { initGetAccountDataWithQueueHintsReq } from './GetAccountDataWithQueueHintsReq'
import { initGetAccountDataWithQueueHintsResp } from './GetAccountDataWithQueueHintsResp'
import { initGetAccountQueueCountReq } from './GetAccountQueueCountReq'
import { initGetAccountQueueCountResp } from './GetAccountQueueCountResp'
import { initGetAppliedVoteReq } from './GetAppliedVoteReq'
import { initGetAppliedVoteResp } from './GetAppliedVoteResp'
import { initGetCachedAppDataReq } from './GetCachedAppDataReq'
import { initGetCachedAppDataResp } from './GetCachedAppDataResp'
import { initGetTrieAccountHashesReq } from './GetTrieAccountHashesReq'
import { initGetTrieAccountHashesResp } from './GetTrieAccountHashesResp'
import { initGetTrieHashesReq } from './GetTrieHashesReq'
import { initGetTrieHashesResp } from './GetTrieHashesResp'
import { initGetTxTimestampReq } from './GetTxTimestampReq'
import { initGetTxTimestampResp } from './GetTxTimestampResp'
import { initGlobalAccountReportReq } from './GlobalAccountReportReq'
import { initGlobalAccountReportResp } from './GlobalAccountReportResp'
import { initLostReportReq } from './LostReportReq'
import { initMakeReceiptReq } from './MakeReceiptReq'
import { initSignAppDataReq } from './SignAppDataReq'
import { initSignAppDataResp } from './SignAppDataResp'
import { initRepairOOSAccountReq } from './RepairOOSAccountsReq'
import { initRequestReceiptForTxReq } from './RequestReceiptForTxReq'
import { initRequestReceiptForTxResp } from './RequestReceiptForTxResp'
import { initRequestStateForTxPostReq } from './RequestStateForTxPostReq'
import { initRequestStateForTxPostResp } from './RequestStateForTxPostResp'
import { initRequestStateForTxReq } from './RequestStateForTxReq'
import { initRequestStateForTxResp } from './RequestStateForTxResp'
import { initSendCachedAppDataReq } from './sendCachedAppDataReq'
import { initSpreadAppliedVoteHashReq } from './SpreadAppliedVoteHashReq'
import { initSpreadTxToGroupSyncingReq } from './SpreadTxToGroupSyncingReq'
import { initSyncTrieHashesReq } from './SyncTrieHashesReq'
import { initWrappedData } from './WrappedData'
import { initWrappedDataFromQueueSerializable } from './WrappedDataFromQueueSerializable'
import { initWrappedDataResponse } from './WrappedDataResponse'

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
  initSignAppDataReq()
  initSignAppDataResp()
  initCachedAppData()
  initSendCachedAppDataReq()
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
