"use strict";
const { test, afterEach, tearDown } = require('tap');
const axios = require('axios');
const { sleep } = require('../../src/utils');
const startUtils = require('../../tools/server-start-utils')({ baseDir: '../..' });
const seedNodePort = 9001;
const secondNodePort = 9002;
const cycleDuration = 5;
startUtils.setDefaultConfig({ server: { cycleDuration } });
afterEach(async (t) => {
    await startUtils.deleteAllServers();
});
test('Second node should send "active" message to all known nodes', async (t) => {
    await startUtils.startServer(seedNodePort, 9015);
    await startUtils.startServer(secondNodePort, 9016, 'active');
    await sleep(2 * cycleDuration * 1000);
    const { data } = await axios(`http://127.0.0.1:${secondNodePort}/nodeinfo`);
    const nodeId = data.nodeInfo.id;
    const requests = await startUtils.getRequests(seedNodePort);
    const activeMessages = requests.filter(r => r.url === 'active').map(r => r.body.nodeId);
    t.equal(activeMessages.includes(nodeId), true, 'Should send active message to other nodes');
});
test('Network should add nodes active state to the cycle chain', async (t) => {
    await startUtils.startServer(seedNodePort, 9015);
    await startUtils.startServer(secondNodePort, 9016, 'active');
    await sleep(2 * cycleDuration * 1000);
    const { data } = await axios(`http://127.0.0.1:${seedNodePort}/cyclechain`);
    const cycleChain = data.cycleChain;
    const lastCycle = cycleChain[cycleChain.length - 1];
    const { nodes } = await startUtils.getState(seedNodePort);
    const lastJoinedNode = nodes.find(n => n.externalPort === secondNodePort);
    t.equal(lastCycle.active, 2, 'Seed node should have 2 active nodes in cycle chain');
    t.equal(lastJoinedNode.status, 'active', 'Network should update all node lists to mark node as active');
});
tearDown(async () => {
    await startUtils.stopAllServers();
});
//# sourceMappingURL=milestone-8.spec.js.map