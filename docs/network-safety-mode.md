# Join Protocol V2

## Introduction

This is the technical specification for the mode system of a network.

The functional specification ["Network Safety"](https://docs.google.com/document/d/1UPR6VK0zFe6K5qS_SIfi4nfKS-faKkprznaZ1O7Xjes/edit) is the basis for this technical specification. The functional spec provides more context and justification for the new mode system.

There is a [Linear project](https://linear.app/shm/project/network-safety-mode-743d4f2d34fd) for the implementation.

There is already an implentation of safety mode in place, but it is more primitive, and the intention is to add a mode system.

## Benefits

- the network will be better able to recover from a drop in active nodes when safety mode is enabled
- the existence of a mode system will make it easier to add other modes

## Code and Configuration

A new module will be added with the path `shardus-global-server/src/p2p/Modes.ts`. This will contain the code that determines which mode the network should be in.

The existing safety mode implementation is inside the module `shardus-global-server/src/p2p/SafetyMode.ts`

## Steps

- if first node
  - set mode to `forming`
- elif needs to enter recovery
  if not in recovery, set mode to recovery
- elif needs to enter safety
  - if not in safety, set mode to safety
- elif needs to enter processing
  - if not in processing, set mode to processing

## Updating the Cycle Record

- Inside the p2p directory, a `Modes.ts` will be added.
- Inside `CycleCreator.ts`, Modes will be added as a submodule
- Inside the `makeCycleRecord()` function in `CycleCreator.ts`, the field `Mode` will be added to the cycle record
- In Q3, inside the `runQ3()` function, the `updateRecord()` function of the `Mode` module will be called, which contains the code from the Steps section

## Add mode parameter to Shardus and App

- mode parameter passed to the app from Shardus-Core so app can perform mode dependent actions
- In other words mode argument should be added Shardus side so app can check mode and act accordingly

- in Shardus-Core>join.ts

  - In the `addJoinRequest()` there an if statement check if (typeof shardus.app.validateJoinRequest === 'function') to check if overridden by app
    - In the if-statement add the mode argument i.e. `shardus.app.validateJoinRequest(joinRequest, mode)`
      -In `isReadyToJoin()` add the mode argument
    - This function gets called by Shardus when trying to join the network and should say not ready to join until certificates needed are present

- On Shardeum-Server
  - `isReadyToJoin()` and `validateJoinRequest()`, mode argument should be added to both functions
    - then logic for when in processing mode, require `stakeCert` and in other modes require `adminCert`
