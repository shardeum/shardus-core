# P2P: Sync Cycle Chain & Node List

## Syncing Node

1. `robustQuery /cycle_chain_end`

    a. response:
    ```
    {
      cycle_marker: '...',
      cycle_number: 42
    }
    ```

2. `ask /cycle_data`

    a. request:
    ```
    {
      start: current - 100
      end: current
    }
    ```

    b. response:
    ```
    [cycle N, cycle N+1, ...]
    ```

3. Verify valid cycle data from current to previous

4. Set active_nodes based on cycle data from most current cycle

5. Use cycle data to build node list

6. If node list size is < cycle.active_nodes:  
    a. Ask for older cycle data
