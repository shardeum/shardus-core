export = P2PLostNodes;
declare class P2PLostNodes {
    constructor(logger: any, p2p: any, state: any, crypto: any);
    mainLogger: any;
    p2p: any;
    state: any;
    crypto: any;
    lostNodesMeta: {};
    statuses: {
        flagged: string;
        reported: string;
        down: string;
        up: string;
    };
    respondToPing: any;
    /**
     * Adds the given node to lostNodesMeta and marks it as flagged to be reported
     * in the next cycles Q1 phase.
     * @param {Node} node
     */
    reportLost(node: any): boolean;
    /**
     * Called at the start of every cycles Q1 phase. Trys to send LostMessages for
     * every flagged node in lostNodesMeta. If the LostMessage is invalid, trys
     * again next cycle.
     */
    proposeLost(): void;
    /**
     * Called at the start of every cycles Q3 phase. Trys to apply lostNodesMeta
     * data to the current cycle data.
     */
    applyLost(): void;
    registerRoutes(): void;
    _investigateLostNode(lostMsg: any): false | undefined;
    _flagLostNode(node: any): boolean;
    _unflagLostNode(target: any): boolean;
    _addLostMessage(lostMsg: any, { verify }?: {
        verify?: boolean | undefined;
    }): (string | boolean)[];
    _validateLostMessage(lostMsg: any, verify?: boolean): (string | boolean)[];
    _addDownMessage(downMsg: any): (string | boolean)[];
    validateDownMessage(downMsg: any): (string | boolean)[];
    _addUpMessage(upMsg: any): (string | boolean)[];
    validateUpMessage(upMsg: any): (string | boolean)[];
    _createLostNodeMeta(node: any): {
        id: any;
        status: string;
        messages: {
            lost: null;
            down: null;
            up: null;
        };
    };
    _createLostMessage(target: any): any;
    _createDownMsg(lostMsg: any): any;
    _createUpMsg(downMsg: any): any;
    _findLostNodeInvestigator(target: any, cycleMarker: any): any;
}
