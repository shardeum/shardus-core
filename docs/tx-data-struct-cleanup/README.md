# Shardus Transaction Flow

## Overview

![Overview of Shardus transaction processing](https://cdn.discordapp.com/attachments/910988453687218277/918644762033143838/20211209_171128.jpg)

## Implementation of Steps (1) - (5) in `shardus-global-server`

```
1. App's /inject endpoint

2. Shardus.put(...)

2. Consensus.inject(...)

2. Consensus.on('accepted', (...) => { StateManager.TransactionQueue.routeAndQueueAcceptedTransaction(...) })

3. P2P.sendGossipIn('spread_tx_to_group', ...)

4. P2P.registerGossipHandler('spread_tx_to_group', StateManager.TransactionQueue.handleSharedTX(...))

5. StateManager.TransactionQueue.newAcceptedTxQueueTempInjest.push(txQueueEntry)
   StateManager.TransactionQueue.newAcceptedTxQueueTempInjestByID.set(txQueueEntry.acceptedTx.id, txQueueEntry)
```

## Validate Crack Verify: Steps (2) (4)

```mermaid
sequenceDiagram
	participant S as Shardus
	participant A as App

    S ->> A: Calls App fn to validate tx fields
    Note over S, A: P2P.registerGossipHandler('spread_tx_to_group') callback » <br> StateManager.TransactionQueue.handleSharedTx » <br> App.validateTxnFields

    A -->> S: Returns tx fields passed/failed validation

    S ->> A: Calls App fn to crack open tx
    Note over S, A: StateManager.TransactionQueue.routeAndQueueAcceptedTransaction » <br> App.getKeyFromTransaction
    A -->> S: Returns tx timestamp and involved accounts
    Note over S: Validates tx timestamp within acceptable range

    S ->> A: Calls App fn to verify tx signature
    Note over S, A: [TODO] Need to call App.validateTransaction at some point
    A -->> S: Returns tx signature verification passed/failed
```

## Get Local Account Data: Step (6)

```mermaid
sequenceDiagram
	participant S as Shardus
	participant A as App

    S ->> A: Calls App fn to get local data for accounts involved in tx
    Note over S, A: StateManager.TransactionQueue.processAcceptedTxQueue » <br> StateManager.TransactionQueue.tellCorrespondingNodes » <br> App.getRelevantData
    A -->> S: Returns account metadata (hash, timestamp) and data
```

## Pre-apply Tx to Create Vote: Step (9)

```mermaid
sequenceDiagram
    participant S as Shardus
    participant A as App

    S ->> A: Calls App fn to pre-apply tx with current account states
    Note over S, A: StateManager.TransactionQueue.preApplyTransaction » <br> App.apply
    A -->> S: Returns whether tx passed or failed and resulting account states
    Note over  S: Uses apply response to create vote
```

## Apply Verify Fix: Step (14)

```mermaid
sequenceDiagram
    participant S as Shardus
    participant A as App

    S ->> A: Calls App fn to update account state with new state
    Note over S, A: StateManager.TransactionQueue.commitConsensedTransaction » <br> StateManager.setAccount » <br> App.updateAccountFull || App.updateAccountPartial
    A -->> S: Returns whether update was successful or not
```

[Differences betweeen diagrams and actual implementation](./TODO.md)
