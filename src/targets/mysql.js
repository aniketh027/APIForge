'use strict';
const target = require('../utils/mysql-target');
module.exports = {
    name:'mysql', comparison: value => value.toLowerCase(), enumTrailingSpace:true,
    namingOptions:{}, semanticSymbol:'MYSQL_TARGET_LIMIT',
    semanticHint:'Shorten the identifier or lower the declared STRING capacity for the supported MySQL target.',
    semanticIssues:target.targetIssues,
    renderers: legacy => legacy
};
