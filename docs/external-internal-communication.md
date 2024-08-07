# List of External, Internal and Socket Endpoints

## External GET | network.registerExternalGet()

### debug

- **debug** : To archive and download logs and db for debugging

### p2p/Join.ts

- **cyclemarker** : to return cycle marker [_registernal()]
- **joined/:publicKey** : to check if node is joined [_registernal()]

### p2p/Sync.ts

- **sync-newest-cycle** : to return newest cycle [_registernal()]

### p2p/Apoptosis.ts

- **stop** : to run apoptosizeSelf() function
- **fail** : used to test unclean exit

### p2p/Archivers.ts

- **archiver** : get a list of active archivers
- **datarecipients** : get a list of current data recipients subscribed to this node

### p2p/Lost.ts

- **kill** : to left the network without telling any peers
- **killother** : to kill other nodes

### p2p/Snapshot.ts

- **download-snapshot-data** : to let other nodes to download snapshot data if they don't have

### shardus/index.ts

- **config** : to return config values

### state-manager/index.ts

- **debug_stats"** : for state-manager debugging
- **debug_stats2"** : for state-manager debugging

### utils/nestedCounters.ts

- **counts** : to return event counters
- **counts-reset** : to reset counts
- **debug-inf-loop** : to test inifinite loop
- **debug-inf-loop-off** : to stop inifinite loop

### utils/profiler.ts

- **perf** : print and clear report

---

## External POST | network.registerExternalPost()

### p2p/Join.ts

- **join** : to accept join request from consensors [_registernal()]

### p2p/Sync.ts

- **sync-cycles** : to return cycle records [_registernal()]

### p2p/Archivers.ts

- **joinarchiver** : accept archiver join requests
- **leavingarchivers** : accept archiver leave requests
- **requestdata** : accept data request from archivers
- **querydata** : accept receiptMaps + SummaryBlob queries from archivers

### p2p/Snapshot.ts

- **snapshot-data-offer** : respond if offered data is needed or not
- **snapshot-witness-data** : exchange snapshot data during safety sync

### shardus/index.ts

- **exit** : to shutdown
- **testGlobalAccountTX** : to test global account tx
- **testGlobalAccountTXSet** : to test global account tx set

---

## Internal Routes | network.registerInternal()

### p2p/Apoptosis.ts

- **apoptosize** : get apoptosis proposal

### p2p/CycleCreator.ts

- **compare-marker** : compare cycle markers
- **compare-cert** : compare cycle certs

### p2p/GlobalAccounts.ts

- **make-receipt** : make global receipt

### p2p/Lost.ts

- **lost-report** : report lost nodes

### state-manager/AccountGlobals.ts

- **get_globalaccountreport**

### state-manager/PartitionObjects.ts

- **post_partition_results**

### state-manager/index.ts

- **get_account_state_hash**
- **get_account_state**
- **get_accepted_transactions**
- **get_account_data**
- **get_account_data2**
- **get_account_data3**
- **get_account_data_by_list**
- **get_transactions_by_list**
- **get_transactions_by_partition_index**
- **get_partition_txids**
- **request_state_for_tx**
- **request_receipt_for_tx**
- **request_state_for_tx_post**
- **broadcast_state**
- **spread_appliedVote**
- **get_account_data_with_queue_hints**
- **request_state_for_tx**

---

## Gossip Routes

### p2p/Active.ts

- **gossip-active**
- **apoptosis**

### p2p/Archiver.ts

- **joinarchiver**
- **leavingarchiver**

### p2p/CycleAutoScale.ts

- **scaling**

### p2p/CycleCreator.ts

- **gossip-cert**

### p2p/GlobalAccounts.ts

- **set-global**

### p2p/Join.ts

- **gossip-join**

### p2p/Lost.ts

- **lost-down**
- **lost-up**

### snapshot/partition-gossip.ts

- **snapshot_gossip**

### state-manager/index.ts

- **spread_tx_to_group**
- **spread_appliedReceipt**

---

## Socket Connections

### Socket.on(event)

- **ARCHIVER_PUBLIC_KEY** : subscribe archive-server
- **UNSUBSCRIBE** : remove data receipient (archiver)

## Socket.emit()

- **DATA** : Send Cycle + State Metadata to data recipients
