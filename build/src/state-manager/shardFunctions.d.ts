export = ShardFunctions;
/**
 * @typedef {import('../shardus/index').Node} Node
 */
/**
   * @typedef {Object} ShardGlobals global shard values
   * @property {number} numActiveNodes number of active nodes
   * @property {number} nodesPerConsenusGroup number of nodes per consesus group
   * @property {number} numPartitions number of partitions
   * @property {number} numVisiblePartitions default number of partitions that are visible to a node (ege or consensus)
   * @property {number} consensusRadius consenus radius (number of nodes to each side of us that hold consensus data)
   * @property {number} nodeLookRange Address range to look left and right (4 byte numeric)
   * @property {number} endAddr End address in numeric form (4 bytes)
   */
/**
   * @typedef {Object} ShardInfo global shard values
   * @property {string} address address used in calculation
   * @property {Node[]} homeNodes number of active nodes    todo get p2p node info
   * @property {number} addressPrefix numeric address prefix
   * @property {string} addressPrefixHex number of partitions
   * @property {number} homePartition the home partition
   * @property {AddressRange} homeRange consenus radius (number of nodes to each side of us that hold consensus data)
   * @property {Object.<string, Node>} coveredBy the nodes that cover us for consenus.
   * @property {Object.<string, Node>} storedBy the nodes that cover us for storage.
   */
/**
   * @typedef {Object} StoredPartition Data for a StoredPartition
   * @property {AddressRange} homeRange range for the home partition
   * @property {boolean} rangeIsSplit is the range split
   * @property {number} partitionStart Starting index
   * @property {number} partitionEnd End index
   * @property {number} [partitionStart1] The user's age.
   * @property {number} [partitionEnd1] End index
   * @property {number} [partitionStart2] The user's age.
   * @property {number} [partitionEnd2] End index
   * @property {{ start: number; dist: number; end: number; }} [partitionRangeVector]
   * @property {number} [x] For debug: shardGlobals.nodesPerConsenusGroup
   * @property {number} [n] For debug: homePartition
   * @property {AddressRange} [partitionRange]
   * @property {AddressRange} [partitionRange2]
   * @property {number} [partitionsCovered] Number of partitions covered by this node
   */
/**
   * @typedef {Object} NodeShardData shard data for a node
   * @property {Node} node our node
   * @property {number} nodeAddressNum numeric address prefix
   * @property {number} homePartition number of partitions
   * @property {number} centeredAddress the home partition
   * @property {number} ourNodeIndex the home partition
   * @property {number} consensusStartPartition
   * @property {number} consensusEndPartition
   * @property {boolean} extendedData have we calculated extended data yet
   * @property {boolean} needsUpdateToFullConsensusGroup
   * extended data below here
   * @property {StoredPartition} storedPartitions consenus radius (number of nodes to each side of us that hold consensus data)
   * property {Map<string,Node>} coveredBy the nodes that cover us for consenus // removed not sure this goes here
   * @property {Node[]} nodeThatStoreOurParition
   * @property {Node[]} nodeThatStoreOurParitionFull
   * @property {Node[]} consensusNodeForOurNode
   * @property {Node[]} consensusNodeForOurNodeFull
   * @property {Node[]} edgeNodes
   * @property {Node[]} c2NodeForOurNode
   * @property {Node[]} outOfDefaultRangeNodes
   */
/**
   * @typedef {Object} AddressRange A range of addresses
   * @property {number} partition the partition
   * @property {number} p_low End index
   * @property {number} p_high The user's age.
   * @property {number} partitionEnd
   * @property {number} startAddr Start address in numeric form (4 bytes)
   * @property {number} endAddr End address in numeric form (4 bytes)
   * @property {string} low End address in 64 char string
   * @property {string} high End address in 64 char string
   */
/**
   * @typedef {Object} BasicAddressRange A range of addresses
   * @property {number} startAddr Start address in numeric form (4 bytes)
   * @property {number} endAddr End address in numeric form (4 bytes)
   * @property {string} low End address in 64 char string
   * @property {string} high End address in 64 char string
   */
declare class ShardFunctions {
}
declare namespace ShardFunctions {
    export { calculateShardGlobals, leadZeros8, calculateShardValues, calculateStoredPartitions2, calculateStoredPartitions2Ranges, testAddressInRange, testInRange, getPartitionsCovered, computePartitionShardDataMap, computeNodePartitionDataMap, computeNodePartitionDataMapExt, computeNodePartitionData, updateFullConsensusGroup, mergeDiverseRanges, computeExtendedNodePartitionData, nodeSort, getConsenusPartitionList, getStoredPartitionList, setOverlap, setEpanded, setEpandedLeft, setEpandedRight, setShrink, computeCoverageChanges, getHomeNodeSummaryObject, getNodeRelation, addressToPartition, findHomeNode, circularDistance, dilateNeighborCoverage, mergeNodeLists, subtractNodeLists, partitionToAddressRange2, getNodesThatCoverRange, getNodesThatCoverParitionRaw, getNeigborNodesInRange, getNodesByProximity, findCenterAddressPair, getNextAdjacentAddresses, getCenterHomeNode, debugFastStableCorrespondingIndicies, fastStableCorrespondingIndicies, partitionInConsensusRange, Node, ShardGlobals, ShardInfo, StoredPartition, NodeShardData, AddressRange, BasicAddressRange };
}
type Node = any;
/**
 * global shard values
 */
type ShardGlobals = {
    /**
     * number of active nodes
     */
    numActiveNodes: number;
    /**
     * number of nodes per consesus group
     */
    nodesPerConsenusGroup: number;
    /**
     * number of partitions
     */
    numPartitions: number;
    /**
     * default number of partitions that are visible to a node (ege or consensus)
     */
    numVisiblePartitions: number;
    /**
     * consenus radius (number of nodes to each side of us that hold consensus data)
     */
    consensusRadius: number;
    /**
     * Address range to look left and right (4 byte numeric)
     */
    nodeLookRange: number;
    /**
     * End address in numeric form (4 bytes)
     */
    endAddr: number;
};
/**
 * global shard values
 */
type ShardInfo = {
    /**
     * address used in calculation
     */
    address: string;
    /**
     * number of active nodes    todo get p2p node info
     */
    homeNodes: any[];
    /**
     * numeric address prefix
     */
    addressPrefix: number;
    /**
     * number of partitions
     */
    addressPrefixHex: string;
    /**
     * the home partition
     */
    homePartition: number;
    /**
     * consenus radius (number of nodes to each side of us that hold consensus data)
     */
    homeRange: AddressRange;
    /**
     * the nodes that cover us for consenus.
     */
    coveredBy: {
        [x: string]: any;
    };
    /**
     * the nodes that cover us for storage.
     */
    storedBy: {
        [x: string]: any;
    };
};
/**
 * Data for a StoredPartition
 */
type StoredPartition = {
    /**
     * range for the home partition
     */
    homeRange: AddressRange;
    /**
     * is the range split
     */
    rangeIsSplit: boolean;
    /**
     * Starting index
     */
    partitionStart: number;
    /**
     * End index
     */
    partitionEnd: number;
    /**
     * The user's age.
     */
    partitionStart1?: number;
    /**
     * End index
     */
    partitionEnd1?: number;
    /**
     * The user's age.
     */
    partitionStart2?: number;
    /**
     * End index
     */
    partitionEnd2?: number;
    partitionRangeVector?: {
        start: number;
        dist: number;
        end: number;
    };
    /**
     * For debug: shardGlobals.nodesPerConsenusGroup
     */
    x?: number;
    /**
     * For debug: homePartition
     */
    n?: number;
    partitionRange?: AddressRange;
    partitionRange2?: AddressRange;
    /**
     * Number of partitions covered by this node
     */
    partitionsCovered?: number;
};
/**
 * shard data for a node
 */
type NodeShardData = {
    /**
     * our node
     */
    node: any;
    /**
     * numeric address prefix
     */
    nodeAddressNum: number;
    /**
     * number of partitions
     */
    homePartition: number;
    /**
     * the home partition
     */
    centeredAddress: number;
    /**
     * the home partition
     */
    ourNodeIndex: number;
    consensusStartPartition: number;
    consensusEndPartition: number;
    /**
     * have we calculated extended data yet
     */
    extendedData: boolean;
    /**
     * extended data below here
     */
    needsUpdateToFullConsensusGroup: boolean;
    /**
     * consenus radius (number of nodes to each side of us that hold consensus data)
     * property {Map<string,Node>} coveredBy the nodes that cover us for consenus // removed not sure this goes here
     */
    storedPartitions: StoredPartition;
    nodeThatStoreOurParition: any[];
    nodeThatStoreOurParitionFull: any[];
    consensusNodeForOurNode: any[];
    consensusNodeForOurNodeFull: any[];
    edgeNodes: any[];
    c2NodeForOurNode: any[];
    outOfDefaultRangeNodes: any[];
};
/**
 * A range of addresses
 */
type AddressRange = {
    /**
     * the partition
     */
    partition: number;
    /**
     * End index
     */
    p_low: number;
    /**
     * The user's age.
     */
    p_high: number;
    partitionEnd: number;
    /**
     * Start address in numeric form (4 bytes)
     */
    startAddr: number;
    /**
     * End address in numeric form (4 bytes)
     */
    endAddr: number;
    /**
     * End address in 64 char string
     */
    low: string;
    /**
     * End address in 64 char string
     */
    high: string;
};
/**
 * A range of addresses
 */
type BasicAddressRange = {
    /**
     * Start address in numeric form (4 bytes)
     */
    startAddr: number;
    /**
     * End address in numeric form (4 bytes)
     */
    endAddr: number;
    /**
     * End address in 64 char string
     */
    low: string;
    /**
     * End address in 64 char string
     */
    high: string;
};
