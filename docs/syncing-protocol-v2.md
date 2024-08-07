# Syncing Node List V2

## Introduction

This is the technical specification for an activating node to sync the data it requires to participate in the consensus of transactions.

The joining node must sync the cycle chain, node list and state data from active nodes.

The functional specification is the google doc ["Syncing Nodelist V2"](https://docs.google.com/document/d/1s2I4rbQCI6RWQ6kwgmV5SsDZiaGYHmq-BGzslVUzES8/).

There is a [Notion project](https://www.notion.so/shardus/Cycle-Sync-Protocol-V2-591af3d97644484fb26a5e1e99c99ab7) for the implementation.

This V2 protocol obtains data directly from another node, but verifies that the hash of that data matches the majority hash obtained from multiple nodes.

Documented steps below are pseudo-code with nods to TypeScript, but the TypeScript is not literal. The implementer is free to reorganize and refactor code as needed. Also, the implementation will require additional error checks and exception handling.

The work is divided into phases described in the last section.

## Configuration

Place new config fields in SERVER_CONFIG in `./src/config/server.ts` where needed.

## General steps

Per the functional spec, the steps are:

1. Obtain the node list and nextCycleTimestamp
2. Wait for the next cycle record to be created
3. Check that the nodeListHash field matches the hash of the node list we have

Justification for the order is provided in the functional spec.

## Recording the hash of the node list

Active nodes record the hash of the node list with the cycle record. Add a new "nodeListHash" field to the cycle record, containing:

- hash(NodeList.byJoinOrder)

Hash the list using the Shardus crypto utils library (crypto.hash which uses blake2b).

Computing the hash occurs during cycleCreator() immediately after digesting the previous cycle record:

```typescript
// CycleCreator.ts
// async function cycleCreator() {
//   ...
if (!CycleChain.newest || CycleChain.newest.counter < prevRecord.counter) Sync.digestCycle(prevRecord);
// --> hash here
```

See https://gitlab.com/shardus/global/shardus-global-server/-/blob/master/src/p2p/CycleCreator.ts#L272

Be sure to compute the hash of the node list one time only and reuse that value for the rest of the cycle. Store the cycle number with it so that you can check that the hash still applies to the current cycle.

## Obtain the node list

```typescript
// for reference
type RobustQueryResult = {
  topResult: any;
  winningNodes: any[];
  isRobustResult: boolean;
};
```

- func obtainNodeList(): NodeList
  - starterNodeList = archiver's nodelist which returns a small subset of all nodes
  - result = robustQuery(for the hash of remote NodeList.byJoinOrder and the next cycle timestamp)
  - if not result.isRobustResult
    - log, wait and retry
  - robustHash, nextCycleTimestamp = robustResult.topResult[0], robustResult.topResult[1]
  - for tries = 0 to 3
    - fullNodeList = get node list from result.winningNodes[0]
      - pass the robustHash for the node list in this query
      - the receiving node uses it to return 'not found' if it is no longer a match for the its current node list
    - if hash(fullNodeList) === robustHash
      - success/break
  - if not successful, retry the entire process
  - return fullNodeList

## Obtain the cycle record

You can view a sample cycle record through an archiver:

- http://\<archiver-host:ip>/cycleinfo/1

The syncing node waits until nextCycleTimestamp + N seconds to get the cycle record. N = 2 seconds, configurable.

- func obtainCycleRecord(): NodeList
  - starterNodeList = archiver.getStarterNodeList()
  - robustCycleMarker = robustQuery(the cycle record hash)
  - check isRobustResult
  - cycleRecord = winningNodes[0].getCycleRecord()
  - if robustCycleMarker != hash(cycleRecord)
    - log, pause 1 - 2 seconds, retry
  - if cycleRecord.nodeListHash === robustHash of the node list, acquired earlier
    - success
    - apply the cycle record node changes to the node list
      - note: the validator already has code for this
    - create the additional variations of the node list

## Obtain the archiver node list

Obtain the archiver node list using the same logic found in the above two sections.

Reuse and/or refactor the validator code that applies the cycle record node changes.

## Obtain the standby node list

In the future, the join protocol will be changed so that standby nodes are registered with the network. Once that happens there will be a new standby node list.

A syncing node will then get the standby node list in the same manner as the main node list described above. The syncing node list must be in a stable order such as join request order.

## Archive servers

The archive servers will use this protocol to create their initial node list.

Once an archive server has synced the most recent cycle record it can sync the historical cycle records from other archive servers by checking that the hash of the cycle records match the previous_hash field of the next record. Phase 3 below.

## Reuse the hash of the node list

The heartbeat to the monitor server includes the hash of the node list. Be sure to reuse the calculated value rather than hashing again.

Search the code base for similar invocations to find any other places that can reuse the hash value.

## Remove obsolete code

Refreshing of active nodes can be turned off because this was only required by the previous protocol for building the node list from the cycle chain. Phase 4 below.

## Phases of implementation

- Phase 1
  - Add the nodeListHash to the cycle record.
  - Add the archiverListHash to the cycle record.
  - Reuse the hash in the heartbeat code.
  - Put the above behind a feature flag because they affect the cycle record and its marker.
    - true when testing
    - false when merging dev
    - use src/config/server.ts
  - Don’t use these for anything yet.
- Phase 2
  - For validators, sync the node list and archiver list as specified in the new protocol.
  - Disable the old protocol of syncing the cycle chain and node list through a feature flag.
- Phase 3
  - For archivers, change the archive servers to use the V2 protocol to sync the node list.
- Phase 4
  - Reduce the number of cycle records stored by active nodes.
  - Turn off refreshing of old active nodes.
- Phase 5
  - Once the code has been stable for some time, remove the old protocol code.
