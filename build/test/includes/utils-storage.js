"use strict";
const path = require('path');
const fs = require('fs');
function clearTestDb() {
    if (fs.existsSync(path.join(path.join(__dirname, '/../../db'), '/db.test.sqlite')))
        fs.unlinkSync(path.join(path.join(__dirname, '/../../db'), '/db.test.sqlite'));
}
// copy the current conf file and then change to use a test db
function createTestDb(confStorage, newDb = null) {
    clearTestDb();
    let newConfStorage = Object.assign({}, confStorage);
    newConfStorage.options.storage = newDb || 'db/db.test.sqlite';
    fs.writeFileSync(path.join(__dirname, `../../config/storage.json`), JSON.stringify(newConfStorage, null, 2));
    return newConfStorage;
}
exports.createTestDb = createTestDb;
exports.clearTestDb = clearTestDb;
//# sourceMappingURL=utils-storage.js.map