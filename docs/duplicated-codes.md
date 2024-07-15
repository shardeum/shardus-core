# Duplicated Codes across Shardus repositories
## Robust Query
### Description
Robust query is used to query data from different nodes and return value which has highest tally.

### Functions
```
robustQuery(nodes, queryFn, equalityFn, redundancy, shuffleNodes)
```
### Repos
- shardus-global-server
- archive-server
-----
## Validate Types
### Description
This function is used for basic type validation

### Functions
```
validateTypes(input, def)
```
### Repos
- shardus-global-server
- archive-server
- explorer-server
-----
## Safe Parse
### Description
Safe parse is used to safely parse object and array strings to objects or arrays
### Functions
```
safeParse(fallback, json, msg?)
```
### Repos
- shardus-global-server
- archive-server
- explorer-server
-----
## Overwriting configs in correct order (file, ENV, args)
### Description
Used to overwrite default config parameters with values from files, ENV or args
### Functions
```
overrideDefaultConfig(file, env, args)
```
### Repos
- shardus-global-server
- archive-server
- liberdus/server
-----
## Database functions for ArchivedCycles
### Description
There are several functions which add or query data (archivedCycle) to and from NoSQL TyDB
### Functions
```
initStorage()
insertArchivedCycle()
updateArchivedCycle()
queryAllArchivedCycle()
queryAllArchivedCyclesBetween()
queryAllCycleRecords()
queryLatestCycleRecords()
queryCycleRecordsBetween()
queryArchivedCycleByMarker()
queryArchivedCycleByCounter()
```
### Repos
- archive-server
- explorer-server
-----
## Joining Network
### Description
Process of joining into the existing network as a new consensor node or archiver.
### Functions
```
joinNetwork(nodes, firstTime)
```
### Repos
- shardus-global-server
- archive-server
-----
## Syncing Cycle Records and Building Node List
### Description
When a new consensor node or archiver joins the network, it tries to sync the cycle records and build active node list from the record
### Functions
```
ChangeSquasher()
fetchCycleRecords()
validateCycle()
applyNodeListChange()
```
### Repos
- shardus-global-server
- archive-server
-----
## Gossip
### Description
Consensor node or archiver trys to gossip data to other consensors or archivers.
### Functions
```
sendGossip()
tell()
```
### Repos
- shardus-global-server
- archive-server
-----
## Logger
### Description
Logger module use log4js to manage and store logs into log files
### Functions
```
class Logger {}
```
### Repos
- shardus-global-server
- archive-server

