import * as Comms from '../../../src/p2p/Comms'
import { ShardusTypes } from '../../../src/shardus'
import {
  GetAccountDataReqSerializable,
  serializeGetAccountDataReq,
} from '../../../src/types/GetAccountDataReq'
import {
  GetAccountDataRespSerializable,
  deserializeGetAccountDataResp,
} from '../../../src/types/GetAccountDataResp'
import { InternalRouteEnum } from '../../../src/types/enum/InternalRouteEnum'
import { addResult } from '../RunIntegrationTests'

export const GetAccountDataInternalApiTest = async (from: ShardusTypes.Node, to: ShardusTypes.Node): Promise<void> => {
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
      to,
      InternalRouteEnum.binary_get_account_data,
      message,
      serializeGetAccountDataReq,
      deserializeGetAccountDataResp,
      {
        sender_id: from.id,
      },
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
