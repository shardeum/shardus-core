# OLD

A partition block is the state of a range of addresses within a partition at the
end of a given cycle duration.

A partition block's metadata has three parts:

1. partition block hash - The hash of the state of all the addresses in the
                          partition block.

2. partition block stats hash - The hash of the partition blocks stats (computed
                                by the app and passed to Shardus as a blob)

3. receipt map hash - The hash of the partition block's receipt map.

These 3 pieces of metadata need to be computed and shared among all nodes once
all txs have settled for a given cycle.

All nodes should end up with all three pieces of metadata for all partition
blocks in the cycle.

# NEW

2 kinds of partitions:
  * Regular partitions
  * Summary Partitions

\# of regular partitions = # of nodes

\# of summary partitions = const 64 for now (powers of 2 in the future)

When a node joins the network, stats summary partitions are computed once, then
updated with each tx