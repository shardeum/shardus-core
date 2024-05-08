import { ErrorObject } from 'ajv'
import { getVerifyFunction } from '../../utils/serialization/SchemaHelpers'
import { initGetAccountData3Req } from './GetAccountData3Req'
import { initCompareCertReq } from './CompareCert'
import { initSpreadTxToGroupSyncingReq } from './SpreadTxToGroupSyncingReq'
import { initApoptosisProposal } from './ApoptosisProposalResp'
import { initGetTxTimestampReq } from './GetTxTimestampReq'
import { initGetTxTimestampResp } from './GetTxTimestampResp'

export function initAjvSchemas(): void {
  initGetAccountData3Req()
  initCompareCertReq()
  initSpreadTxToGroupSyncingReq()
  initApoptosisProposal()
  initGetTxTimestampReq()
  initGetTxTimestampResp()
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
      errorMsg += `: ${JSON.stringify(error.params)}`
    }
    return errorMsg
  })
}
