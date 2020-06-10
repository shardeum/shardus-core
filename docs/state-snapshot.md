# State Snapshots

A state snapshot is a Shardus applications entire state data across all addresses at a given timestamp.
Shardus Archiver nodes periodically backup all the application data held by Validator nodes by creating state snapshots.
In the event that all Validator nodes are lost, a Shardus network can restore itself from the most recent state snapshot held by the Archiver nodes.

## Creating a Snapshot

Given that: 

* <span style="color: #dad8ed">State data is partitioned across Validators</span>
* <span style="color: #dad8ed">State data changes over time as the network is used</span>

To create snapshots:

* <span style="color: #ccffcc">Archivers need to collect all data partitions from Validators to create a snapshot</span>
* <span style="color: #ccffcc">State data snapshots need to be taken at a specific time</span>
* <span style="color: #ccffcc">Validators need to save their state data as it was at the snapshot time</span>
* <span style="color: #ccffcc">Validators need to agree upon a snapshot time</span>
* <span style="color: #ccffcc">Archivers need to know the snapshot time decided by the Validators</span>

To enable this:

* <span style="color: #ffcc99">Archivers should have a way to store state snapshots</span> ([Archiver Change 1](#archiver-change-1))
* <span style="color: #ffcc99">Validators should provide an endpoint Archivers can query for the state data at a given time</span> ([Validator Change 1](#validator-change-1))
* <span style="color: #ffcc99">Archivers should initiate snapshot creation after Validators agree upon a snapshot time</span> ([Archiver Change 2](#archiver-change-2))
* <span style="color: #ffcc99">Validators should have a way to store and retrieve their state data at a given snapshot time</span> ([Validator Change 2](#validator-change-2))
* <span style="color: #ffcc99">Validators should mark a cycle and use its start time as the timestamp for a snapshot</span> ([Validator Change 3](#validator-change-3))

The relationship between these statements is illustrated below:

![State Snapshot Creation Outline](state-snapshot-creation-outline.png)

### Validator Changes

#### Validator Change 1

*<span style="color: #ffcc99">Validators should provide an endpoint Archivers can query for the state data at a given time</span>*

Validators can expose a `/snapshot` endpoint that Archivers will POST to in order to get state data.
Archivers will provide a `timestamp` parameter and Validators will respond with state data as an array of `WrappedData` objects.
The `WrappedData` array should be ordered by ascending account address.

Body:

``` ts
interface SnapshotReq {
  timestamp: number
}
```

Response:

```ts
interface SnapshotRes {
  snapshot: WrappedData[]
}
```

To respond to `/snapshot` requests, the Validator will look for the provided `timestamp` in its index of available state snapshots.
If a snapshot is found, the accounts in the snapshots data will be returned as a `WrappedData` array.
If no snapshot is found, and empty array is returned.

#### Validator Change 2

*<span style="color: #ffcc99">Validators should have a way to store and retrieve their state data at a given snapshot time</span>*

`state-manager` may already be saving state data as at was at certain timestamps for data repair.
This behavior can be used to enable indexed state snapshots when a cycle is marked as a snapshot cycle.
To do this, when a cycle is marked, the state data as it was at the `start` timestamp of the cycle will be added to an index of available state snapshots.

#### Validator Change 3

*<span style="color: #ffcc99">Validators should mark a cycle and use its start time as the timestamp for a snapshot</span>*

A new cycle field , `snapshot`, can be used to mark cycles whose `start` times will be uses as snapshot times:

```ts
interface Cycle {
  ...
  snapshot: boolean
}
```

Validators can deterministically agree upon which cycles to mark as snapshot cycles if they occur at a regular interval.

Ex. Every 10th cycle is a snapshot cycle.

### Archiver Changes

#### Archiver Change 1

*<span style="color: #ffcc99">Archivers should have a way to store state snapshots</span>*

Once a state snapshot is created, it should be saved to persistent storage and indexed by timestamp.

#### Archiver Change 2

*<span style="color: #ffcc99">Archivers should initiate snapshot creation after Validators agree upon a snapshot time</span>*

When the Validators mark a cycle as a snapshot cycle, the cycle is eventually passed to the Archivers.
Upon seeing a snapshot cycle, Archivers can initiate the creation of a state snapshot.

Archivers can use shard calculations to determine the smallest set of Validator nodes they need to query to get a complete picture of state data across all addresses.
This set of Validators can be queried in a robust way to account for network failures, and the data returned from the queries can be stitched together to create a state snapshot.

## Restoring from a Snapshot

### Validator Changes

### Archiver Changes
