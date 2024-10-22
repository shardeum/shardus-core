import { P2P } from '@shardus/types'
import { nodeListFromStates } from '../../../../../src/p2p/Join'
import { linearInsertSorted, propComparator2 } from '../../../../../src/utils'

const intComparator = (a: number, b: number): number => a - b

describe('linearInsertSorted', () => {
  it('should insert an item into an empty array', () => {
    const arr: number[] = []
    linearInsertSorted(arr, 5, intComparator)
    expect(arr).toEqual([5])
  })

  it('should insert an item at the beginning of the array', () => {
    const arr = [2, 4, 6]
    linearInsertSorted(arr, 1, intComparator)
    expect(arr).toEqual([1, 2, 4, 6])
  })

  it('should insert an item at the end of the array', () => {
    const arr = [1, 3, 5]
    linearInsertSorted(arr, 6, intComparator)
    expect(arr).toEqual([1, 3, 5, 6])
  })

  it('should insert an item in the middle of the array', () => {
    const arr = [1, 3, 5]
    linearInsertSorted(arr, 4, intComparator)
    expect(arr).toEqual([1, 3, 4, 5])
  })

  it('should insert an item in the correct position when array is already sorted', () => {
    const arr = [1, 2, 3, 4, 5]
    linearInsertSorted(arr, 6, intComparator)
    expect(arr).toEqual([1, 2, 3, 4, 5, 6])
  })

  const nodes: P2P.NodeListTypes.Node[] = [
    {
      id: '1',
      curvePublicKey: '',
      status: P2P.P2PTypes.NodeStatus.READY,
      cycleJoined: '',
      counterRefreshed: 0,
      publicKey: '',
      externalIp: '',
      externalPort: 0,
      internalIp: '',
      internalPort: 0,
      address: '',
      joinRequestTimestamp: 0,
      activeTimestamp: 0,
      syncingTimestamp: 0,
      readyTimestamp: 5555551,
      activeCycle: 1,
    },
    {
      id: '2',
      curvePublicKey: '',
      status: P2P.P2PTypes.NodeStatus.READY,
      cycleJoined: '',
      counterRefreshed: 0,
      publicKey: '',
      externalIp: '',
      externalPort: 0,
      internalIp: '',
      internalPort: 0,
      address: '',
      joinRequestTimestamp: 0,
      activeTimestamp: 0,
      syncingTimestamp: 0,
      readyTimestamp: 5555550,
      activeCycle: 2,
    },
    {
      id: '3',
      curvePublicKey: '',
      status: P2P.P2PTypes.NodeStatus.READY,
      cycleJoined: '',
      counterRefreshed: 0,
      publicKey: '',
      externalIp: '',
      externalPort: 0,
      internalIp: '',
      internalPort: 0,
      address: '',
      joinRequestTimestamp: 0,
      activeTimestamp: 0,
      syncingTimestamp: 0,
      readyTimestamp: 5555550,
      activeCycle: 3,
    },
    {
      id: '0',
      curvePublicKey: '',
      status: P2P.P2PTypes.NodeStatus.READY,
      cycleJoined: '',
      counterRefreshed: 0,
      publicKey: '',
      externalIp: '',
      externalPort: 0,
      internalIp: '',
      internalPort: 0,
      address: '',
      joinRequestTimestamp: 0,
      activeTimestamp: 0,
      syncingTimestamp: 0,
      readyTimestamp: 5555552,
      activeCycle: 4,
    },
  ]

  it('should insert nodes in correct order', () => {
    const arr: P2P.NodeListTypes.Node[] = []
    linearInsertSorted(arr, nodes[0], propComparator2('readyTimestamp', 'id'))
    linearInsertSorted(arr, nodes[1], propComparator2('readyTimestamp', 'id'))
    linearInsertSorted(arr, nodes[2], propComparator2('readyTimestamp', 'id'))
    linearInsertSorted(arr, nodes[3], propComparator2('readyTimestamp', 'id'))
    expect(arr.map((n) => n.id)).toEqual(['2', '3', '1', '0'])
  })
  it('should insert nodes in correct order 2', () => {
    const arr: P2P.NodeListTypes.Node[] = []
    linearInsertSorted(arr, nodes[2], propComparator2('readyTimestamp', 'id'))
    linearInsertSorted(arr, nodes[3], propComparator2('readyTimestamp', 'id'))
    linearInsertSorted(arr, nodes[1], propComparator2('readyTimestamp', 'id'))
    linearInsertSorted(arr, nodes[0], propComparator2('readyTimestamp', 'id'))
    expect(arr.map((n) => n.id)).toEqual(['2', '3', '1', '0'])
  })

  it('should insert nodes in correct order 3', () => {
    const arr: P2P.NodeListTypes.Node[] = []
    linearInsertSorted(arr, nodes[1], propComparator2('readyTimestamp', 'id'))
    linearInsertSorted(arr, nodes[2], propComparator2('readyTimestamp', 'id'))
    linearInsertSorted(arr, nodes[3], propComparator2('readyTimestamp', 'id'))
    linearInsertSorted(arr, nodes[0], propComparator2('readyTimestamp', 'id'))
    expect(arr.map((n) => n.id)).toEqual(['2', '3', '1', '0'])
  })
})

jest.mock('../../../../../src/p2p/NodeList', () => ({
  activeByIdOrder: [],
  readyByTimeAndIdOrder: [],
  syncingByIdOrder: [],
  standbyByIdOrder: [],
  selectedByIdOrder: [],
  byJoinOrder: [],
}))

jest.mock('../../../../../src/p2p/Self', () => {
  let id = '0'
  return {
    get id() {
      return id
    },
    set id(newId) {
      id = newId
    },
  }
})

const nodes = [
  {
    id: '1',
    curvePublicKey: '',
    status: 'READY',
    cycleJoined: '',
    counterRefreshed: 0,
    publicKey: '',
    externalIp: '',
    externalPort: 0,
    internalIp: '',
    internalPort: 0,
    address: '',
    joinRequestTimestamp: 0,
    activeTimestamp: 0,
    syncingTimestamp: 0,
    readyTimestamp: 5555551,
  },
  {
    id: '2',
    curvePublicKey: '',
    status: 'SYNCING',
    cycleJoined: '',
    counterRefreshed: 0,
    publicKey: '',
    externalIp: '',
    externalPort: 0,
    internalIp: '',
    internalPort: 0,
    address: '',
    joinRequestTimestamp: 0,
    activeTimestamp: 0,
    syncingTimestamp: 5555550,
    readyTimestamp: 0,
  },
  {
    id: '3',
    curvePublicKey: '',
    status: 'ACTIVE',
    cycleJoined: '',
    counterRefreshed: 0,
    publicKey: '',
    externalIp: '',
    externalPort: 0,
    internalIp: '',
    internalPort: 0,
    address: '',
    joinRequestTimestamp: 0,
    activeTimestamp: 5555552,
    syncingTimestamp: 0,
    readyTimestamp: 0,
  },
]

describe('nodeListFromStates', () => {
  let Self
  let NodeList

  beforeEach(() => {
    NodeList = require('../../../../../src/p2p/NodeList')
    Self = require('../../../../../src/p2p/Self')

    Object.defineProperty(NodeList, 'activeByIdOrder', {
      value: [],
      writable: true,
    })
    Object.defineProperty(NodeList, 'readyByTimeAndIdOrder', {
      value: [],
      writable: true,
    })
    Object.defineProperty(NodeList, 'syncingByIdOrder', {
      value: [],
      writable: true,
    })
    Object.defineProperty(NodeList, 'byJoinOrder', {
      value: [],
      writable: true,
    })

    NodeList.activeByIdOrder.push(nodes[2])
    NodeList.readyByTimeAndIdOrder.push(nodes[0])
    NodeList.syncingByIdOrder.push(nodes[1])
    NodeList.byJoinOrder.push(...nodes)

    Self.id = '0'
  })

  afterEach(() => {
    jest.clearAllMocks()
    NodeList.activeByIdOrder = []
    NodeList.readyByTimeAndIdOrder = []
    NodeList.syncingByIdOrder = []
    NodeList.standbyByIdOrder = []
    NodeList.selectedByIdOrder = []
    NodeList.byJoinOrder = []
    Self.id = '0'
  })

  it('should return nodes in the correct order for given states', () => {
    const result = nodeListFromStates([
      P2P.P2PTypes.NodeStatus.ACTIVE,
      P2P.P2PTypes.NodeStatus.READY,
      P2P.P2PTypes.NodeStatus.SYNCING,
    ])
    expect(result.map((n) => n.id)).toEqual(['3', '1', '2'])
  })

  it('should include self node if not already added', () => {
    jest.spyOn(Self, 'id', 'get').mockReturnValue('5')
    const selfNode = {
      id: '5',
      curvePublicKey: '',
      status: P2P.P2PTypes.NodeStatus.SELECTED,
      cycleJoined: '',
      counterRefreshed: 0,
      publicKey: '',
      externalIp: '',
      externalPort: 0,
      internalIp: '',
      internalPort: 0,
      address: '',
      joinRequestTimestamp: 0,
      activeTimestamp: 0,
      syncingTimestamp: 0,
      readyTimestamp: 0,
    }
    NodeList.byJoinOrder.push(selfNode)
    const result = nodeListFromStates([
      P2P.P2PTypes.NodeStatus.ACTIVE,
      P2P.P2PTypes.NodeStatus.READY,
      P2P.P2PTypes.NodeStatus.SYNCING,
    ])
    expect(result.map((n) => n.id)).toEqual(['3', '1', '2', '5'])
  })

  it('should not duplicate self node if already present', () => {
    jest.spyOn(Self, 'id', 'get').mockReturnValue('3')
    const selfNode = {
      id: '3',
      curvePublicKey: '',
      status: P2P.P2PTypes.NodeStatus.SELECTED,
      cycleJoined: '',
      counterRefreshed: 0,
      publicKey: '',
      externalIp: '',
      externalPort: 0,
      internalIp: '',
      internalPort: 0,
      address: '',
      joinRequestTimestamp: 0,
      activeTimestamp: 0,
      syncingTimestamp: 0,
      readyTimestamp: 0,
    }
    NodeList.byJoinOrder.push(selfNode)

    const result = nodeListFromStates([
      P2P.P2PTypes.NodeStatus.ACTIVE,
      P2P.P2PTypes.NodeStatus.READY,
      P2P.P2PTypes.NodeStatus.SYNCING,
    ])
    expect(result.map((n) => n.id)).toEqual(['3', '1', '2'])
  })

  it('should handle empty state arrays', () => {
    jest.spyOn(Self, 'id', 'get').mockReturnValue('0')
    const result = nodeListFromStates([])
    expect(result).toEqual([])
  })
})
