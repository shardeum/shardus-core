# Cycle Chain / Node List Overview

In order to function properly, a Shardus network needs:

1. All nodes to know about all other nodes.
2. A way for all nodes to perform certain actions at the same time.
3. A history of the nodes in the network and of the agreed upon actions performed.

These are accomplished with the use of a network-wide node list and cycle chain.

The **node list** contains detailed information about every currently active node in the network.

The **cycle chain** is a time-ordered list of cycles that record which nodes were active in the network during that cycle, and the network actions performed during that cycle.

All active nodes in a network share the same cycle-chain, and agree upon the info that will be included in the next cycle before committing it to their copy of the chain. Cycles are created in a timely manner from when the network starts, for as long as the network runs.

To join a Shardus network, nodes must sync up to the networks node list and cycle chain. Once synced, they will be able to participate in deciding which actions the network performs. They will also receive and share network updates with other active nodes, which will be used in the creation of future cycles.

Cycles contain the following data:

```JavaScript
cycle: {
  start: null,
  duration: null,
  counter: null,
  previous: null,
  joined: [],
  removed: [],
  lost: [],
  apoptosized: [],
  returned: [],
  activated: [],
  certificate: {},
  expired: 0,
  desired: 0
}
```

The cycle creation process is marked by four phases:

[CYCLE CREATION DIAGRAM]

## Network-level processes

Network-level processes are used by the network to

### Joining

### Activation

### Expiration

### Auto-scaling

### Apoptosis

### Lost Node detection

## Node-level processes

### Re-syncing

### Repairing

### Syncing
