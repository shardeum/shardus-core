const StateManager = require('../../../src/state-manager')





StateManager.calculateShardValues(100, 30, '4098ffff' + '3'.repeat(52))


StateManager.calculateShardValues(20, 30, '0011ffff' + '3'.repeat(52))