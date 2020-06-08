# State Snapshots

A `snapshot` is the state data across all addresses at a given timestamp.

A `snapshot` must be aligned to cycle boundries since state data is changing in
the middle of a cycle.

## Creating a Snapshot

### Approach

* Validators collect snapshot data and send to Archivers

  * Pros

  * Cons

* Archivers collect snapshot data directly

  * Pros

    * Better seperation of concerns

      * Validators focused on validating txs, Archivers focused on archiving
        data

    * Simple interface between Validators and Archivers

      * Archiver asks Validator for partial snapshot data with address range
        and timestamp
      * Validator responds with data

  * Cons

### Process

* Pick a timestamp for the `snapshot`

  * All Validators should be holding finalized state data for the timestamp
    picked for a `snapshot`

    * Maybe they already do this?

    * Proposal: Make `snapshot` timestamps well known and agreed upon by the
      Validators by putting them into the cycle chain data.

* Get enough partial `snapshot`s to cover all addresses

  * Pick Validators that hold connected but non-overlapping state data
    partitions (see [Algorithm 1](#algorithm-1))

  * Get partial `snapshot` data from picked Validators (see [Interface 1](#interface-1))

* Assemble complete `snapshot` from partial `snapshot`s

### Algorithms

#### Algorithm 1

_Pick Validators that hold connected but non-overlapping state data partitions_

Assuming that:

  * N = Num of nodes in network
  * Address space (000... to fff...) is evenly divided into N partitions
  * Node list is in ascending order of node ID (from 000... to fff...)
  * Nodes hold the data of the partitions nearest their node IDs

Do the following:

  1. Select next node or first node
  2. Query node for all of its state data (see [Interface 1](#interface-1))
  3. Additively combine received data with saved data
  4. If saved data covers all addresses, end
  5. Else, start over from step 1

Ex:

Node list = [1, 2, 3, 4, 5, 6, 7, 8, 9]

Query order = [1, 9, 5, 3, 7, 4, 6, 2, 8]

### Interfaces

#### Interface 1

_Get partial `snapshot` data from picked Validators_

POST `/snapshot`

BODY:

```ts
interface SnapshotReq {
  timestamp: number
}
```

RESPONSE:

```ts
interface SnapshotRes {
  snapshot: WrappedData[]
}
```

## Restoring from a Snapshot

## Resuming Tx Processing