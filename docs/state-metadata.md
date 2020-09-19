# State Metadata

## Necessary Context

2 kinds of partitions:
  * Data partitions
  * Summary Partitions

\# of data partitions = # of nodes

\# of summary partitions = const 64 for now (powers of 2 in the future)

When a node joins the network, stats summary partitions are computed once, then
updated with each tx

## Metadata Flow

0. When an archiver joins the network, it subscribes to consensors to receive
   updates. Explorers subscribe to consensors to receive updates.

1. When all the txs for a cycle have settled, all consensors gossip and collect
   3 kinds of hashes:

   1. data hashes for all data partition blocks in that cycle
   2. receipt map hashes for all data partition blocks in that cycle
   3. summary data hashes for all summary partition blocks in that cycle

2. When a consensor has collected the hashes for all partition blocks in a given
   cycle, it uses them to compute 3 network level hashes for that cycle:

   1. network data partition hash =
       hash(data hashes for all data partition blocks)
   2. network receipt map hash =
       hash(receipt map hashes for all data partition blocks)
   3. network summary partition hash =
       hash(summary data hashes for all summary partition blocks)

3. When a consensor has computed a network level hash for a cycle:

     * that network level hash
     * and the partition level hashes used to compute the network level hash

   are signed and sent as an update to the consensors subscribers.

4. When an archiver gets a:

     * network receipt map hash (+ supporting hashes) update
     * or a network summary partition hash (+ supporting hashes) update

   from a consensor for a cycle, the archiver figures out and queries
   all consensors needed to collect additional data:

     * complete receipt map data (for a network receipt map hash update)
     * or complete summary data (for a network summary partition hash update)

   for all partition blocks in that cycle.
   
   If the archiver gets a network data partition hash update, it doesn't need
   to collect any additional data.

   Once additional data is collected, the signed update from the consensor
   (+ any collected data) is forwarded to explorers subscribed to the archiver.

5. When an explorer get an update from an archiver, the update's signature is
   validated against the explorer's node list, and additional data is parsed:

     * receipt map data is indexed and used to validate tx receipts
     * summary data is reduced in an app specified way and made available