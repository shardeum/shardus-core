# Shardus Consensor Startup

## 1. Identify the network

1. Load a list of existing archivers from config

2. Pick an archiver and ask it for a list of active nodes

   - Include your own info when you ask

3. Figure out if you're the first node from the archivers response
   - If response is a list with your own info, you're the first node
   - If response is a list of some active nodes, you're not first
   - If bad/no response (net err, etc.), restart from 1.2 with another archiver
   - If all the archivers gave you bad/no responses, log and exit

## 2. Join the network

1. Sync your time with the network

   - Optional, but if you're too out of sync, your requests/txs may be dropped

2. Create a join request

   1. Get latest cycle marker from active nodes

      - Compare responses from multiple nodes and make sure they match
      - If this fails for all active nodes, restart from 1.2

   2. Create join request from:
      - Your info
      - Latest cycle marker
      - Proof-of-work
      - Selection number (possibly removable)
      - `[TODO]` Version number
      - `[TODO]` Whatever else the app wants

3. Send join request to the active nodes

   - Send it when the network is accepting cycle updates (in Q1)

4. Query active nodes to see if your join request was accepted
   - If your join request was not accepted, restart from 2.2

## 3. Sync up with the network

1. Sync initial complete nodelist

   1. Get complete nodelist hash from active nodes

      - Compare responses from multiple nodes and make sure they match
      - If this fails for all nodes, restart from 1.2

   2. Get complete nodelist from one active node and verify its hash
      - If the hashes don't match, get nodelist from another node and try again
      - If all nodes have been asked with no success, restart from 1.2

2. Sync initial cycle chain

   1. Get current, unfinalized cycle counter from active nodes

   2. Get cycle chain hash for last 1000 finalized cycles from active nodes

   3. Get, verify, and save last 1000 finalized cycles from active nodes

3. Sync latest nodelist and cycle chain

   1. Get current, unfinalized cycle counter from active nodes

`[CONTINUE FROM HERE (p2p._syncUpChainAndNodelist)]`

2. Compare against our most recently saved cycle counter

   - If saved counter is 1 cycle behind current counter, we are synced
   - Else

     0. `[TODO]` Check that we haven't been booted for taking too long to sync
     1. Apply updates from saved cycles to saved nodelist
     1. ? Get cycles between saved counter and current counter ?

3. Get unfinalized data for current cycle and start participating in cycles

<style>ul {list-style-type: none;}</style>
