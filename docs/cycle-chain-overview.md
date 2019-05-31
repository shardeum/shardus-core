# Node List / Cycle Chain Overview

In order to implement core network mechanisms, a Shardus network needs:

* Every node to keep a list of every other node in the network. (__node list__)
* A way for nodes to suggest changes to the node list. (__updates__)
* A way for nodes to agree upon and apply changes to their node lists at the
  same time. (__cycles__)
* A history of all the changes that were made to the node list.
  (__cycle chain__)

Every node keeps a copy of the __node list__, which has the information and
status of every node in the network.

Nodes can suggest changes to the node list with signed messages, called
__updates__, which are passed around to every node in the network.

Nodes gather all the updates they see in a certain amount of time and put them
into structures called __cycles__ Once the time to gather updates has passed,
nodes compare their cycles to make sure they have the same updates. After
applying the updates to their node lists, the nodes will start gathering updates
for the next cycle. Cycles are created on a regular interval from the start of
the network, for as long as the network runs.

The __cycle chain__ is the ordered list of all the cycles created by the
network, going back to the first cycle it created.

To join a Shardus network, a node must sync up with the networks node list and
cycle chain. Once it is synced, it will be able to suggest node list
updates and participate in creating cycles.

## Creating Cycles

Cycles are created on a regular interval and contain the following data:

```typescript
interface Cycle {
  start: number, // cycle start time (epoch)
  duration: number, // cycle duration (ms)
  counter: number, // cycle index number (starting from 0)
  previous: string, // hash of the previous cycle
  joined: [], // array of collected join requests
  removed: [], // 
  lost: [],
  apoptosized: [],
  returned: [],
  activated: [],
  certificate: {},
  expired: number,
  desired: number
}
```

The time to create one cycle can be divided into four quarters, each initiated
by a different function.

[CYCLE CREATION DIAGRAM]

### Q1: `startUpdatePhase()`

### Q2: `endUpdatePhase()`

### Q3: `startCycleSync()`

### Q4: `finalizeCycle()`

## Network-level Processes

These processes update the node list / cycle chain for every node in the network.

### Joining

### Activation

### Expiration

### Auto-scaling

### Apoptosis

### Lost Node detection

## Node-level processes

These processes are used by individual nodes to keep their own copies of the
node list / cycle chain in sync with the rest of the network.

### Syncing

### Repairing

### Re-syncing
