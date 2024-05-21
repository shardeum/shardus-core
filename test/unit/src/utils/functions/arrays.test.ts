import { P2P } from '@shardus/types'
import { linearInsertSorted, propComparator2 } from '../../../../../src/utils'

const intComparator = (a: number, b: number) => a - b

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
