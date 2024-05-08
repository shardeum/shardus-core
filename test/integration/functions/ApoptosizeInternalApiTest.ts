import {
  ApoptosisProposalResp,
  deserializeApoptosisProposalResp,
  serializeApoptosisProposalResp,
} from '../../../src/types/ApoptosisProposalResp'
import { ApoptosisProposalReq, serializeApoptosisProposalReq } from '../../../src/types/ApoptosisProposalReq'
import * as Comms from '../../../src/p2p/Comms'
import { ShardusTypes } from '../../../src/shardus'
import { addResult } from '../RunIntegrationTests'

export const ApopotosizeInternalApiTest = async (node: ShardusTypes.Node): Promise<void> => {
  // tests
  try {
    const startTime = Date.now()
    const obj: ApoptosisProposalResp = {
      s: 'test',
      r: 1,
    }
    const resp = await Comms.askBinary<ApoptosisProposalResp, ApoptosisProposalResp>(
      node,
      'apoptosize',
      obj,
      serializeApoptosisProposalResp,
      deserializeApoptosisProposalResp,
      { sender_id: node.id },
      '0x546567890ab'
    )
    const endTime = Date.now()
    const result = resp.s === 'bad request' && resp.r === 1 ? 'Pass' : 'Fail'
    addResult('askBinary', 'apoptosize expect bad request response', result, endTime - startTime)
  } catch (e) {
    console.error('Error during askBinary test for bad request:', e)
    addResult('askBinary', 'apoptosize expect bad request response', 'Error', 0)
  }

  try {
    const startTime = Date.now()
    const obj: ApoptosisProposalReq = {
      id: 'isDownCheck',
      when: 1,
    }
    const resp = await Comms.askBinary<ApoptosisProposalReq, ApoptosisProposalResp>(
      node,
      'apoptosize',
      obj,
      serializeApoptosisProposalReq,
      deserializeApoptosisProposalResp,
      { sender_id: node.id },
      '0x1234567890ab'
    )
    const endTime = Date.now()
    const result = resp.s === 'node is not down' && resp.r === 1 ? 'Pass' : 'Fail'
    addResult('askBinary', 'apoptosize: isDownCheck 1', result, endTime - startTime)
  } catch (e) {
    console.error('Error during askBinary test for isDownCheck:', e)
    addResult('askBinary', 'apoptosize: isDownCheck 1', 'Error', 0)
  }

  try {
    const startTime = Date.now()
    const obj: ApoptosisProposalReq = {
      id: 'sender_id',
      when: 3,
    }
    const resp = await Comms.askBinary<ApoptosisProposalReq, ApoptosisProposalResp>(
      node,
      'apoptosize',
      obj,
      serializeApoptosisProposalReq,
      deserializeApoptosisProposalResp,
      { sender_id: node.id },
      '0x2234567890ab'
    )
    const endTime = Date.now()
    const result = resp.s === 'pass' || resp.s === 'fail' ? 'Pass' : 'Fail'
    addResult('askBinary', 'apoptosize: success', result, endTime - startTime)
  } catch (e) {
    console.error('Error during askBinary test for success:', e)
    addResult('askBinary', 'apoptosize: success', 'Error', 0)
  }

  try {
    const startTime = Date.now()
    const obj: ApoptosisProposalReq = {
      id: 'isDownCheck',
      when: 1,
    }
    await Comms.tellBinary<ApoptosisProposalReq>(
      [node],
      'apoptosize',
      obj,
      serializeApoptosisProposalReq,
      {
        sender_id: node.id,
        tracker_id: '0x11234567890ab',
      },
      false,
      '0x11234567890ab'
    )
    const endTime = Date.now()
    addResult('tellBinary', 'apoptosize: expect bad request response', 'Pass', endTime - startTime)
  } catch (e) {
    console.error('Error during tellBinary test for bad request:', e)
    addResult('tellBinary', 'apoptosize: expect bad request response', 'Error', 0)
  }
}
