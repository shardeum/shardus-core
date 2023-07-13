# Join Protocol V2

## Introduction

This is the technical specification for a node to join the network.

A joining node must submit a join request once to become a standby node.

The functional specification ["Join Protocol V2"](https://docs.google.com/document/d/133R07slHJmqqcGI0LNwZYzpZCFFo2BOzt1Iq8Gwt2VQ) is the basis for this technical specification. The functional spec provides more context and justification for the new join protocol.

There is a [Notion project](https://www.notion.so/shardus/Join-Protocol-V2-72d28281ca1c4e05b43020ce390500c3) for the implementation.

This V2 protocol addresses shortcomings in V1 including performance and lack of tracking of how many nodes are in standby.

Some documented steps below are pseudo-code with nods to TypeScript, but the TypeScript is not literal. The implementer is free to reorganize and refactor code as needed. Also, the implementation will require additional error checks and exception handling.

The work is divided into phases described in the last section.

## Benefits of the new protocol

Keep these benefits in mind when coding and testing:

- enable the network to know how many nodes are in standby mode
  - needed for at least reward calculations
- reduce the number of messages related to the join process
- reduce the cycles the certificate needs to be valid from 20 to a few
- in Shardeum, eliminate the need for nodes to renew the stake certificate repeatedly as they submit join requests

## Code and Configuration

As needed, place new config fields in SERVER_CONFIG in `config/server.ts`:

`~/workspaces/shardus-global-server-aka-core/src/config/server.ts`

The existing join code is in the repository "shardus-global-server", aka "Shardus Core", in:

`~/workspaces/shardus-global-server-aka-core/src/p2p/Join.ts`

## Steps

- A node wanting to join (joiningNode) fetches a (partial) node list from the archiver's `/nodelist` endpoint.
- for otherNode in that nodeList.slice(0, 3)
  - request to join via otherNode
    - if otherNode validates
      - reachability with `isPortReachable()`
      - and joiningNode is not already in `pendingJoinRequestList`, `standByNodes` or active nodes
    - then
      - otherNode gossips the join request
      - otherNode adds newNode to a new `pendingJoinRequestList` in the cycle record
      - return success
    - else
      - otherNode returns error
      - joiningNode fails

- Nodes receiving the gossip for a node to join, add the node to `pendingJoinRequestList`

- to-do: should the following happen as the node moves from standby to active?
- The join request is validated (by Shardeum) to ensure that the node has staked properly.

- In subsequent cycles, nodes in `pendingJoinRequestList` are moved over to a new `NodeList.standbyNodeByPublicKey`

- Active nodes check to make sure the standby node is reachable, then gossip the join request to all nodes in the network.
  - There is already such a check in `Lost.ts`, invoking `isPortReachable` for both external and external ip:port.

- All nodes that submitted a valid join request are added as “standby” nodes in the next cycle record.
  - If a node is not already in `standbyNodeByPublicKey`, gossip it to the entire network.
- On redundant join request (node is already standby or active), ignore the request
- On each cycle the active nodes decide how many nodes to add (already implemented).
- On each cycle the needed number of nodes N are selected from the standby node list based on a deterministic-but-unpredictable score that is a function of the node public key and the current cycle marker.
- The N nodes with the best score are added as joining nodes to the next cycle record.
- When a node is selected to join, some active nodes in the network send the cycle number to the selected node; letting it know that it has been selected.
  - to-do: need more info about this. which ones send? luckyNode, check if you are in that, if so, then you are lucky and you send the cycle number to the joining node
- The selected standby node queries one of the active nodes for this cycle record and verifies that it is included as a joining node in the cycle record.
  - robustQuery to ask if this node is in the `joined`

## Unjoining

- While on the standby list, a node that wants to unstake must first remove itself from the network--same as when syncing or active.
- A node will submit an unjoin request to have the network remove it from the standby list.
  - Where to make the request
    - There are multiple `shutdown()` methods in Shardus Core where this might be done, or:
    - The constructor of the `Shardus` class in `src/shardus/index.ts` contains multiple `this.exitHandler.registerAsync()` calls that could be used to register the `unjoin` request.
- The unjoin request will require a new list in the cycle record because it cannot remove immediately.
- Ignore the unjoin request if the node is not found in `standbyNodeByPublicKey` or `byJoinOrder`.

## Additional Context

The following is not part of the join protocol, but included to be informative:

- If no response is received when a node is notified that it was selected, then it can be reported and removed similar to lost node detection.
- If the node does not join and sync in sufficient time then it can be removed from the network.
- The application will be notified of nodes which are lost or do not sync in time and can choose to slash them. This will be implemented separately as another protocol.
- `NodeList.byJoinOrder` has both syncing and active nodes.
- Active nodes in the network score each join request based on the public key in the join request and the current cycle marker; this makes the score deterministic but unpredictable (to-do: already implemented correct?)

The state of a node goes through these states:

- New node
- Wait for stake etc.
- Request to join
- Incoming join requests (in the next cycle record)
- Stand-by in the next cycle record
- Syncing
- Active - these nodes participate including validation, providing the node list, etc.

to-do: validate the above states

## Implementation Phases

- Phase 1
  - A valid join request is gossiped to all nodes in the network on a new gossip route; in addition to being gossiped based on the score.
  - A standby node list is maintained by all active nodes and synced by joining nodes; the standby node list is not used to select nodes yet.
  - Note that the standby list can only be modified based on instructions in the cycle record.
  - However, the old join protocol is still active and nodes are selected to join the network based on the score of the join request.
- Phase 2
  - An unjoin request is gossiped on a new gossip route to enable nodes to remove themselves from the standby list.
  - Note that the standby list can only be modified based on instructions in the cycle record.
  - Nodes which are stopped while waiting to join must submit an unjoin request.
- Phase 3
  - Nodes are selected to join the network using the standby node list.
  - Some active nodes notify the standby node that it has been selected to join on a specific cycle record.
  - The standby node does a query of that cycle record from one of the active nodes to verify that it was selected to join.
  - The old gossip route of gossiping the join requests with the highest score is deprecated.
  - Note that the active and standby list can only be modified based on instructions in the cycle record.
- Phase 4
  - In Shardeum when a node tries to unstake, make sure it is not in the standby, syncing or active list.
