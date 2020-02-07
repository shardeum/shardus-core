"use strict";
const utils = require('../src/utils');
const resolvingPromise = async () => {
    return true;
};
const rejectingPromise = async () => {
    throw new Error('Rejected, kid.');
};
const init = async () => {
    const promises = [resolvingPromise(), rejectingPromise()];
    const [results, errors] = await utils.robustPromiseAll(promises);
    for (const result of results) {
        console.log(result);
    }
    for (const error of errors) {
        console.log(error);
    }
};
init();
//# sourceMappingURL=test-robust-promise-all.js.map