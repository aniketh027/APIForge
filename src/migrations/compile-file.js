'use strict';
const { fail } = require('./errors');
const { buildMysqlSnapshot } = require('./mysql-snapshot');
const { compileFile } = require('../compiler');
function compileFileForSnapshot(entryPath, profile = 'mysql-8.4-v1', options = {}) {
    if (profile !== 'mysql-8.4-v1') fail('MIGRATION_PROFILE_UNSUPPORTED','Only mysql-8.4-v1 is supported.');
    return buildMysqlSnapshot(compileFile(entryPath,{...options,target:'mysql',admitOnly:true}).plan);
}
module.exports = { compileFileForSnapshot };
