"use strict";
const utils = require('../utils');
class P2PLostNodes {
    constructor(logger, p2p, state, crypto) {
        this.mainLogger = logger.getLogger('main');
        this.p2p = p2p;
        this.state = state;
        this.crypto = crypto;
        this.lostNodesMeta = {};
        this.statuses = {
            flagged: 'flagged',
            reported: 'reported',
            down: 'down',
            up: 'up'
        };
        // [TODO] For testing route. Remove before release
        this.respondToPing = true;
    }
    /**
     * Adds the given node to lostNodesMeta and marks it as flagged to be reported
     * in the next cycles Q1 phase.
     * @param {Node} node
     */
    reportLost(node) {
        // Don't report yourself
        if (node.id === this.p2p.id)
            return false;
        // Flag the node, if not already flagged
        const flagged = this._flagLostNode(node);
        if (!flagged) {
            this.mainLogger.debug(`Lost Detection: ${node.id} has already been flagged as lost`);
            return false;
        }
        this.mainLogger.debug(`Lost Detection: Flagged ${node.id} as lost. Will report for investigation`);
        return true;
    }
    /**
     * Called at the start of every cycles Q1 phase. Trys to send LostMessages for
     * every flagged node in lostNodesMeta. If the LostMessage is invalid, trys
     * again next cycle.
     */
    proposeLost() {
        const currentCycleCounter = this.state.getCycleCounter() || 0;
        const activeNodesById = this.state.getActiveNodes(this.p2p.id).reduce((obj, node) => {
            obj[node.id] = node;
            return obj;
        }, {});
        for (const target in this.lostNodesMeta) {
            const meta = this.lostNodesMeta[target];
            if (!meta)
                continue;
            // If target is no longer an active node, unflag it
            if (!activeNodesById[target]) {
                this._unflagLostNode(target);
                this.mainLogger.debug(`Lost Detection: Unflagged target ${target} because it is no longer active.`);
                continue;
            }
            const status = meta.status;
            const lostMsg = meta.messages.lost;
            const age = lostMsg ? currentCycleCounter - lostMsg.cycleCounter : 0;
            const amInvestigator = lostMsg ? this.p2p.id === lostMsg.investigator : false;
            const amTarget = lostMsg ? this.p2p.id === lostMsg.target : false;
            switch (true) {
                case (status === this.statuses.flagged): {
                    // Report by sending valid LostMessage to investigator
                    const newLostMsg = this._createLostMessage(target);
                    const [added, reason] = this._addLostMessage(newLostMsg, { verify: false });
                    if (!added) {
                        this.mainLogger.debug(`Lost Detection: Unable to report ${target}. Created invalid lostMsg: ${reason}: ${JSON.stringify(newLostMsg)}`);
                        break;
                    }
                    const investigatorNode = this.state.getNode(newLostMsg.investigator);
                    this.p2p.tell([investigatorNode], 'reportlost', newLostMsg).then(() => {
                        this.mainLogger.debug(`Lost Detection: Reported ${target} for investigation by ${newLostMsg.investigator}`);
                    });
                    break;
                }
                case (status === this.statuses.reported && age >= 1 && amInvestigator): {
                    // Gossip DownMesage for target
                    const downMsg = this._createDownMsg(lostMsg);
                    const [added, reason] = this._addDownMessage(downMsg);
                    if (!added) {
                        this.mainLogger.debug(`Lost Detection: Created invalid downMsg: ${reason}: ${JSON.stringify(downMsg)}`);
                        break;
                    }
                    this.p2p.sendGossipIn('lostnodedown', downMsg).then(() => {
                        this.mainLogger.debug(`Lost Detection: No response from target ${target}. Gossiped down message for target. Waiting 1 cycle for target to refute...`);
                    });
                    break;
                }
                case (status === this.statuses.down && age >= 2 && amTarget): {
                    // Gossip UpMessage for target
                    const downMsg = meta.messages.down;
                    const upMsg = this._createUpMsg(downMsg);
                    const [added, reason] = this._addUpMessage(upMsg);
                    if (!added) {
                        this.mainLogger.debug(`Lost Detection: Created invalid upMsg: ${reason}: ${JSON.stringify(upMsg)}`);
                        break;
                    }
                    this.p2p.sendGossipIn('lostnodeup', upMsg).then(() => {
                        this.mainLogger.debug(`Lost Detection: Refuted down message from ${lostMsg.investigator} by gossiping up message`);
                    });
                }
            }
        }
    }
    /**
     * Called at the start of every cycles Q3 phase. Trys to apply lostNodesMeta
     * data to the current cycle data.
     */
    applyLost() {
        const currentCycleCounter = this.state.getCycleCounter() || 0;
        for (const target in this.lostNodesMeta) {
            const meta = this.lostNodesMeta[target];
            if (!meta)
                continue;
            const status = meta.status;
            const lostMsg = meta.messages.lost;
            const age = lostMsg ? currentCycleCounter - lostMsg.cycleCounter : 0;
            switch (true) {
                case (status === this.statuses.reported && age >= 1): {
                    // Unflag target
                    this._unflagLostNode(target);
                    this.mainLogger.debug(`Lost Detection: Investigator did not report target ${target} as down. Unflagged target as lost.`);
                    break;
                }
                case (status === this.statuses.down && age >= 2): {
                    // Add target to cycle's lost nodes
                    this._unflagLostNode(target);
                    this.state.addLostMessage(meta.messages.down);
                    this.mainLogger.debug(`Lost Detection: Target ${target} did not refute down status. Added target to this cycle's lost nodes`);
                    break;
                }
                case (status === this.statuses.up && age >= 2): {
                    // Add target to cycles refuted nodes
                    this._unflagLostNode(target);
                    this.state.addLostMessage(meta.messages.up);
                    this.mainLogger.debug(`Lost Detection: Target ${target} refuted down status. Added target to this cycle's refuted nodes`);
                    break;
                }
            }
        }
    }
    registerRoutes() {
        this.p2p.registerInternal('reportlost', (payload) => {
            this._investigateLostNode(payload);
        });
        this.p2p.registerInternal('ping', async (payload, respond) => {
            if (this.respondToPing)
                await respond({ success: true });
        });
        this.p2p.registerGossipHandler('lostnodedown', (payload, sender, tracker) => {
            const downMsg = payload;
            const [added, reason] = this._addDownMessage(downMsg);
            if (!added) {
                this.mainLogger.debug(`Lost Detection: Invalid downMsg: ${reason}: ${JSON.stringify(downMsg)}: ${JSON.stringify(downMsg)}`);
                return;
            }
            this.mainLogger.debug(`Lost Detection: Investigator reported target ${downMsg.lostMessage.target} as down. Waiting 1 cycle for target to refute...`);
            this.p2p.sendGossipIn('lostnodedown', downMsg, tracker);
        });
        this.p2p.registerGossipHandler('lostnodeup', async (payload, sender, tracker) => {
            const upMsg = payload;
            const [added, reason] = await this._addUpMessage(upMsg);
            if (!added) {
                this.mainLogger.debug(`Lost Detection: Invalid upMsg: ${reason}: ${JSON.stringify(upMsg)}: ${JSON.stringify(upMsg)}`);
                return;
            }
            this.mainLogger.debug(`Lost Detection: Target ${upMsg.downMessage.lostMessage.target} refuted lost status.`);
            this.p2p.sendGossipIn('lostnodeup', upMsg, tracker);
        });
        // [TODO] Testing routes, remove before release
        // Used to start a test of the lost node detection
        this.p2p.network.registerExternalGet('startlosttest', async (req, res) => {
            const randomNode = this.state.getRandomActiveNode();
            res.json({ nodeTested: randomNode.id });
            this.p2p._reportLostNode(randomNode);
        });
        this.p2p.network.registerExternalGet('startlosttest/:id', async (req, res) => {
            const id = req.params.id;
            res.json({ nodeTested: id });
            const node = this.state.getNode(id);
            this.p2p._reportLostNode(node);
        });
        // Used to make a node not respond to lost node detection pings
        this.p2p.network.registerExternalGet('togglerespondtoping', async (req, res) => {
            this.respondToPing = !this.respondToPing;
            res.json({ respondToPing: this.respondToPing });
        });
    }
    _investigateLostNode(lostMsg) {
        // Validate lostMsg and add target to lostNodesMeta
        const [added, reason] = this._addLostMessage(lostMsg);
        if (!added) {
            this.mainLogger.debug(`Lost Detection: Got invalid LostMessage: ${reason}: ${JSON.stringify(lostMsg)}`);
            return false;
        }
        const source = lostMsg.source;
        const target = lostMsg.target;
        this.mainLogger.debug(`Lost Detection: Source ${source} requested investigation of target ${target}`);
        // Ping the target
        const targetNode = this.state.getNode(target);
        this.p2p.ask(targetNode, 'ping')
            .then(pingResponse => {
            // If T responds, remove T from lostNodesMeta, all good, path ends
            if (pingResponse) {
                const unflagged = this._unflagLostNode(target);
                if (unflagged) {
                    this.mainLogger.debug(`Lost Detection: Target ${target} responded to ping. Unflagged target as lost`);
                }
            }
        })
            .catch(err => {
            if (err)
                this.mainLogger.error('P2PLostNodes: _investigateLostNode: p2p.ask: ' + err);
        });
        this.mainLogger.debug(`Lost Detection: Marked target ${target} as lost. Pinged target. Waiting 1 cycle for target to respond...`);
    }
    _flagLostNode(node) {
        const target = node.id;
        if (this.lostNodesMeta[target])
            return false;
        const meta = this._createLostNodeMeta(node);
        this.lostNodesMeta[target] = meta;
        return true;
    }
    _unflagLostNode(target) {
        if (!this.lostNodesMeta[target])
            return false;
        delete this.lostNodesMeta[target];
        return true;
    }
    _addLostMessage(lostMsg, { verify = true } = {}) {
        const [validated, reason] = this._validateLostMessage(lostMsg, verify);
        if (!validated) {
            return [false, reason];
        }
        const { target } = lostMsg;
        // Add lostMsg to lostNodesMeta
        let meta = this.lostNodesMeta[target];
        if (meta && meta.messages.lost) {
            return [false, `a LostMessage already exists for target ${target}`];
        }
        const targetNode = this.state.getNode(target);
        meta = this._createLostNodeMeta(targetNode);
        this.lostNodesMeta[target] = meta;
        meta.status = this.statuses.reported;
        meta.messages.lost = lostMsg;
        return [true, 'All good'];
    }
    _validateLostMessage(lostMsg, verify = true) {
        // Ensure all fields are present
        let source, target, investigator, lastCycleMarker, cycleCounter;
        try {
            ;
            ({ source, target, investigator, lastCycleMarker, cycleCounter } = lostMsg);
        }
        catch (err) {
            return [false, 'Missing required fields: ' + err.message];
        }
        // Ensure all fields are truthy
        if (!source)
            return [false, '"source" value is falsy'];
        if (!target)
            return [false, '"target" value is falsy'];
        if (!investigator)
            return [false, '"investigator" value is falsy'];
        if (!lastCycleMarker)
            return [false, '"lastCycleMarker" value is falsy'];
        if (!cycleCounter)
            return [false, '"cycleCounter" value is falsy'];
        // Ensure source, target, and investigator don't overlap in funny ways
        if (source === target)
            return [false, '"source" is "target"'];
        if (target === investigator)
            return [false, '"target" is "investigator"'];
        if (investigator === source)
            return [false, '"investigator" is "source"'];
        // Ensure all node id's map to active nodes
        const activeNodesById = this.state.getActiveNodes().reduce((obj, node) => {
            obj[node.id] = node;
            return obj;
        }, {});
        const sourceNode = activeNodesById[source];
        if (!sourceNode)
            return [false, '"source" id does not map to a node in the network'];
        const targetNode = activeNodesById[target];
        if (!targetNode)
            return [false, '"target" id does not map to a node in the network'];
        const investigatorNode = activeNodesById[investigator];
        if (!investigatorNode)
            return [false, '"investigator" does not map to a node in the network'];
        // Ensure lastCycleMarker is correst for cycleCounter
        const myLastCycle = this.state.getCycleByCounter(cycleCounter - 1);
        if (!myLastCycle)
            return [false, '"cycleCounter" is not present in cycles'];
        if (lastCycleMarker !== myLastCycle.marker)
            return [false, '"lastCycleMarker" does not match marker in cycles'];
        // Ensure investigator is computed correctly
        const myInvestigator = this._findLostNodeInvestigator(target, myLastCycle.marker);
        if (myInvestigator !== investigator)
            return [false, '"investigator" is not correct for the given "target" and "cycleMarker"'];
        // Verify the signature, if requested
        if (verify) {
            if (!this.crypto.verify(lostMsg))
                return [false, 'Invalid signature on lostMsg'];
        }
        return [true, 'All good'];
    }
    _addDownMessage(downMsg) {
        // Validate downMsg
        const [validated, reason] = this.validateDownMessage(downMsg);
        if (!validated)
            return [false, reason];
        // Add downMsg to lostNodesMeta
        const lostMsg = downMsg.lostMessage;
        const target = lostMsg.target;
        let meta = this.lostNodesMeta[target];
        if (!meta) {
            const targetNode = this.state.getNode(target);
            meta = this._createLostNodeMeta(targetNode);
            this.lostNodesMeta[target] = meta;
        }
        meta.status = this.statuses.down;
        meta.messages.lost = lostMsg;
        meta.messages.down = downMsg;
        return [true, 'All good'];
    }
    validateDownMessage(downMsg) {
        // Validate downMsg
        const lostMsg = downMsg.lostMessage;
        if (!lostMsg)
            return [false, '"lostMessage" field is missing'];
        if (!this.crypto.verify(downMsg))
            return [false, 'Invalid signature on downMsg'];
        // Validate and add lostMessage of downMsg
        const [validated, reason] = this._validateLostMessage(lostMsg);
        if (!validated)
            return [false, reason];
        return [true, 'All good'];
    }
    _addUpMessage(upMsg) {
        const [validated, reason] = this.validateUpMessage(upMsg);
        if (!validated)
            return [false, reason];
        // Add upMsg to lostNodesMeta
        const lostMsg = upMsg.downMessage.lostMessage;
        const target = lostMsg.target;
        let meta = this.lostNodesMeta[target];
        if (!meta) {
            const targetNode = this.state.getNode(target);
            meta = this._createLostNodeMeta(targetNode);
            this.lostNodesMeta[target] = meta;
        }
        meta.status = this.statuses.up;
        meta.messages.lost = lostMsg;
        meta.messages.down = upMsg.downMessage;
        meta.messages.up = upMsg;
        return [true, 'All good'];
    }
    validateUpMessage(upMsg) {
        // Validate upMsg
        const downMsg = upMsg.downMessage;
        if (!downMsg)
            return [false, '"downMessage" field is missing'];
        const lostMsg = downMsg.lostMessage;
        if (!lostMsg)
            return [false, '"lostMessage" field is missing'];
        if (!this.crypto.verify(upMsg))
            return [false, 'Invalid signature on upMsg'];
        // Validate and add downMsg of upMsg
        const [validated, reason] = this.validateDownMessage(downMsg);
        if (!validated)
            return [false, reason];
        return [true, 'All good'];
    }
    _createLostNodeMeta(node) {
        return {
            id: node.id,
            status: this.statuses.flagged,
            messages: {
                lost: null,
                down: null,
                up: null
            }
        };
    }
    _createLostMessage(target) {
        const lastCycleMarker = this.state.getCurrentCycleMarker();
        const cycleCounter = this.state.getCycleCounter() || 0;
        const investigator = this._findLostNodeInvestigator(target, lastCycleMarker);
        const msg = {
            source: this.p2p.id,
            target,
            investigator,
            lastCycleMarker,
            cycleCounter,
            timestamp: Date.now()
        };
        const signedMsg = this.crypto.sign(msg);
        return signedMsg;
    }
    _createDownMsg(lostMsg) {
        const msg = {
            lostMessage: lostMsg
        };
        const signedMsg = this.crypto.sign(msg);
        return signedMsg;
    }
    _createUpMsg(downMsg) {
        const msg = {
            downMessage: downMsg
        };
        const signedMsg = this.crypto.sign(msg);
        return signedMsg;
    }
    _findLostNodeInvestigator(target, cycleMarker) {
        const toHash = {
            target,
            cycleMarker
        };
        // Calculate the hash to compare to find location of the closest node
        const targetHash = this.crypto.hash(toHash);
        const nodes = this.state.getActiveNodes();
        const closestId = utils.getClosestHash(targetHash, nodes.map((node) => node.id));
        if (!closestId) {
            this.mainLogger.debug(`Could not find node to verify specified lost node. Likely no active nodes were found. Nodes: ${JSON.stringify(nodes)}`);
            return null;
        }
        return closestId;
    }
}
module.exports = P2PLostNodes;
//# sourceMappingURL=p2p-lost-nodes.js.map