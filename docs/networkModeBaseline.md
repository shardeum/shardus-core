# Network Configuration Enhancement

The `config.p2p.minNodes` setting impacts network behaviors, including safety + restore + recovery mode triggering. Increasing `minNodes` may unintentionally disrupt network operations by triggering the 3 modes mentioned.

## Solution

We suggest a new configuration parameter, `baselineNodes`, as baseline to going into safety + restore + recovery mode, separating it from `minNodes`. `baselineNodes` is the threshold for safety, recovery, and restore modes, 
while `minNodes` targets processing mode and growing the network without triggering safety + restore + recovery mode.

## Benefits

### Network Growth

The proposal facilitates network expansion. For instance, starting with `baselineNodes` and `minNodes` at 300, then raising `minNodes` to 600 doesn't affect the network mode as `baselineNodes` stays the same.

### baselineNodes Increase

After reaching 600 nodes, `baselineNodes` can be increased to reflect network growth.

## Advantages

- Provides extra safety buffer.
- Useful for forcing the network into recovery, restore, and safety mode for tests.
- Allows for flexible network growth and scalability without disrupting existing operations.

## Load Testing
- Command to modify config in load-tester: 
- `npx hardhat change_server_config --networkbaselineenabled <boolean>`
- `npx hardhat change_server_config --baselinenodes <number of nodes>`

## Flag 
- `networkBaselineEnabled` - Enables the baseline nodes feature. Migration for 1.9.1 will set this to true.
