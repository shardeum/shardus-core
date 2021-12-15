# Differences between seq diagrams and actual implementation

|| Sequence Diagram      | Actual Implementation |
|-----| ----------- | ----------- |
|Signature Verification| Shardus calls dapp fn `app.validateTransaction()` to verify tx signature before adding to tx queue | `app.validateTransaction()` is called by dapp inside `app.apply()` function   |
| preApplyTx | `app.apply()` returns whether tx passed or failed and resulting account states | Account states returned by `app.apply()` function is just an empty array. Those empty account states are later populated by `setAccount()` which subsequently calls `app.updateAccountFull()` and `applyResponseAddState()`.      |


## Required List of Changes
- Need to call `app.validateTransaction()` at some point (probably before preApplyTx)
- Review implementation of `createApplyResponse` and `applyResponseAddState`
