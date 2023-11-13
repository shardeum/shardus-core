import { NodeStatus } from '@shardus/types/build/src/p2p/P2PTypes'
import SHARDUS_CONFIG from '../../src/config'
import Logger from '../../src/logger'
import { NetworkClass } from '../../src/network'
import * as Comms from '../../src/p2p/Comms'
import * as Context from '../../src/p2p/Context'
import { ShardusTypes } from '../../src/shardus'
import { ApoptosisProposalReq, serializeApoptosisProposalReq } from '../../src/types/ApoptosisProposalReq'
import {
  ApoptosisProposalResp,
  deserializeApoptosisProposalResp,
  serializeApoptosisProposalResp,
} from '../../src/types/ApoptosisProposalResp'
import Profiler from '../../src/utils/profiler'

// update the public key, node id and ports to match the node you are testing
const node: ShardusTypes.Node = {
  publicKey: '37cf608dc71e0983d1856f1ce4dd20781f8d32fb5f63b3ba442e778034417924',
  externalIp: '127.0.0.1',
  externalPort: 9002,
  internalIp: '127.0.0.1',
  internalPort: 10002,
  address: 'address',
  joinRequestTimestamp: 1,
  activeTimestamp: 1,
  curvePublicKey: '168fa9e1b8d07095842d0f1e829ec69bcbcfd5665bbde4f9c0ef5b540c42f94e',
  status: NodeStatus.ACTIVE,
  cycleJoined: '',
  counterRefreshed: 0,
  id: '6b169279669234dc9c9c86a138b9aef217bf4f784d2c1593238f5dbc05c27677',
  syncingTimestamp: Date.now(),
}

const defaultConfigs: ShardusTypes.StrictShardusConfiguration = SHARDUS_CONFIG

const ask2Test = async (): Promise<void> => {
  // setup
  const logger = new Logger(defaultConfigs.server.baseDir, defaultConfigs.logs, 'fatal')
  const networkContext = new NetworkClass(defaultConfigs.server, logger, undefined)
  networkContext.setup(
    {
      internalIp: '127.0.0.1',
      internalPort: 11001,
      externalIp: '127.0.0.1',
      externalPort: 9101,
    },
    'c3774b92cc8850fb4026b073081290b82cab3c0f66cac250b4d710ee9aaf83ed8088b37f6f458104515ae18c2a05bde890199322f62ab5114d20c77bde5e6c9d'
  )
  Context.setNetworkContext(networkContext)
  new Profiler()

  let pass = 0
  let fail = 0

  // tests
  try {
    console.log('Test1: apoptosize: expect bad request response')
    const obj: ApoptosisProposalResp = {
      s: 'test',
      r: 1,
    }
    const resp = await Comms.ask2<ApoptosisProposalResp, ApoptosisProposalResp>(
      node,
      'apoptosize',
      obj,
      serializeApoptosisProposalResp,
      deserializeApoptosisProposalResp,
      {
        sender_id: 'sender_id',
      }
    )
    if (resp.s === 'bad request' && resp.r === 1) {
      console.log('Test1: Pass')
      pass++
    } else {
      console.log(`Test1: Fail: Response: ${JSON.stringify(resp)}`)
      fail++
    }
  } catch (e) {
    fail++
    console.log('Test1: Error:', e)
  }

  try {
    console.log('Test2: apoptosize: isDownCheck 1')
    const obj: ApoptosisProposalReq = {
      id: 'isDownCheck',
      when: 1,
    }
    const resp = await Comms.ask2<ApoptosisProposalReq, ApoptosisProposalResp>(
      node,
      'apoptosize',
      obj,
      serializeApoptosisProposalReq,
      deserializeApoptosisProposalResp,
      {
        sender_id: 'sender_id',
      }
    )
    if (resp.s === 'node is not down' && resp.r === 1) {
      console.log('Test2: Pass')
      pass++
    } else {
      console.log(`Test2: Fail: Response: ${JSON.stringify(resp)}`)
      fail++
    }
  } catch (e) {
    fail++
    console.log('Test2: Error:', e)
  }

  try {
    console.log('Test3: apoptosize: isDownCheck 2')
    const obj: ApoptosisProposalReq = {
      id: 'bad',
      when: 1,
    }
    const resp = await Comms.ask2<ApoptosisProposalReq, ApoptosisProposalResp>(
      node,
      'apoptosize',
      obj,
      serializeApoptosisProposalReq,
      deserializeApoptosisProposalResp,
      {
        sender_id: 'sender_id',
      }
    )
    if (resp.s === 'node is not down' && resp.r === 2) {
      console.log('Test3: Pass')
      pass++
    } else {
      console.log(`Test3: Fail: Response: ${JSON.stringify(resp)}`)
      fail++
    }
  } catch (e) {
    fail++
    console.log('Test3: Error:', e)
  }

  try {
    console.log('Test4: apoptosize: success')
    const obj: ApoptosisProposalReq = {
      id: 'sender_id',
      when: 3,
    }
    const resp = await Comms.ask2<ApoptosisProposalReq, ApoptosisProposalResp>(
      node,
      'apoptosize',
      obj,
      serializeApoptosisProposalReq,
      deserializeApoptosisProposalResp,
      {
        sender_id: 'sender_id',
      }
    )
    if (resp.s === 'pass' || resp.s === 'fail') {
      console.log(`Test4: Pass: Response: ${JSON.stringify(resp)}`)
      pass++
    } else {
      console.log(`Test4: Fail: Response: ${JSON.stringify(resp)}`)
      fail++
    }
  } catch (e) {
    console.log('Test4: Error:', e)
  }

  // summary
  console.log('Pass:', pass)
  console.log('Fail:', fail)
}

const tell2Test = async (): Promise<void> => {
  // setup
  const logger = new Logger(defaultConfigs.server.baseDir, defaultConfigs.logs, 'fatal')
  const networkContext = new NetworkClass(defaultConfigs.server, logger, undefined)
  networkContext.setup(
    {
      internalIp: '127.0.0.1',
      internalPort: 11001,
      externalIp: '127.0.0.1',
      externalPort: 9101,
    },
    'c3774b92cc8850fb4026b073081290b82cab3c0f66cac250b4d710ee9aaf83ed8088b37f6f458104515ae18c2a05bde890199322f62ab5114d20c77bde5e6c9d'
  )
  Context.setNetworkContext(networkContext)
  new Profiler()

  let pass = 0
  let fail = 0

  // tests
  try {
    console.log('Test1: apoptosize: expect bad request response')
    const obj: ApoptosisProposalReq = {
      id: 'isDownCheck',
      when: 1,
    }
    await Comms.tell2<ApoptosisProposalReq>([node], 'apoptosize', obj, serializeApoptosisProposalReq, {
      sender_id: 'sender_id',
    })
    console.log('Test1: Pass')
    pass++
  } catch (e) {
    fail++
    console.log('Test1: Error:', e)
  }

  // summary
  console.log('Pass:', pass)
  console.log('Fail:', fail)
}

ask2Test()
tell2Test()
