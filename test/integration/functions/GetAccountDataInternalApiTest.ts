import * as Comms from '../../../src/p2p/Comms'
import { ShardusTypes } from '../../../src/shardus'
import {
  serializeGetAccountDataReq,
  GetAccountDataReqSerializable,
} from '../../../src/types/GetAccountDataReq'
import {
  deserializeGetAccountDataResp,
  GetAccountDataRespSerializable,
} from '../../../src/types/GetAccountDataResp'
import { InternalRouteEnum } from '../../../src/types/enum/InternalRouteEnum'
import { addResult } from '../RunIntegrationTests'

let node: ShardusTypes.Node

export const GetAccountDataInternalApiTest = async (myNode: ShardusTypes.Node): Promise<void> => {
  node = myNode
  try {
    const startTime = Date.now()
    //dummy message
    const message = {
      accountStart: '0x546567890ab',
      accountEnd: '0x546567890ab',
      tsStart: 0,
      maxRecords: 10,
      offset: 0,
      accountOffset: '0x546567890ab',
    }
    const resp = await Comms.askBinary<GetAccountDataReqSerializable, GetAccountDataRespSerializable>(
      node,
      InternalRouteEnum.binary_get_account_data,
      message,
      serializeGetAccountDataReq,
      deserializeGetAccountDataResp,
      {},
      '0x546567890ab'
    )
    const endTime = Date.now()
    const result = resp ? 'Pass' : 'Fail'
    addResult('askBinary', 'binary_get_account_data: basic test', result, endTime - startTime)
  } catch (e) {
    console.error('Error during askBinary test for binary_get_account_data:', e)
    addResult('askBinary', 'binary_get_account_data: basic test', 'Error', 0)
  }
}
