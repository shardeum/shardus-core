# Lost Archiver Detection Planning Doc

<img title="" src="./lost-archiver-detection-protocol-diagram.png" alt="lost-archiver-detection-protocol-diagram.png" width="738">

> Notes:
> 
> * What if a rogue node spoofs the 'ping' route to pass lost detection but otherwise doesn't contribute to the network?
>   
>   One proposed solution is to have a route that returns data that cant be spoofed unless the node is actively participating in the network.

## Types of txs/msgs:

`ArchiverInvestigateTransaction`

`ArchiverDownTransaction`

`ArchiverUpTransaction`

`ArchiverPingMessage`

## Needed Data structures:

`LostArchivers` map to save 'archiver down tx's and 'archiver up tx's by archiver and cycle

`InvestiagtedArchivers` map to save archivers we have investigated for this cycle to not investigate them again

`LostArchivers` cycle record field to record archivers that have been lost and must be removed from the network

## Needed Routes:

`gossip-node-down-tx`

`gossip-node-up-tx`

`internal-investigate-tx`

`internal-ping`

## Needed Logic/Functions:

[WIP]



```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle : Start state of a node
    Idle --> Investigating: S finds T unresponsive
    Idle --> Investigated: I receives “investigate”
    Investigating --> Idle: I reports T is up
    Investigated --> Down: I confirms T is down
    Down --> Up: T sends “node up” and verified
    Up --> Idle: Node reintegrated

    state Idle {
        [*] --> State1
        State1 : Awaiting actions
    }

    state Investigating {
        [*] --> State2
        State2 : Node S has sent investigate
    }

    state Investigated {
        [*] --> State3
        State3 : Node I is investigating T
    }

    state Down {
        [*] --> State4
        State4 : Node T is confirmed down
    }

    state Up {
        [*] --> State5
        State5 : Node T is up after being down
    }
```
