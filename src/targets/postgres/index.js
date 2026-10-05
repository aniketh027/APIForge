'use strict';
module.exports = {
    name:'postgres', comparison:value => value, enumTrailingSpace:false,
    namingOptions:{physical:false}, semanticSymbol:'POSTGRES_TARGET_LIMIT',
    semanticHint:'Use names and values representable by postgresql-18-v1.',
    semanticIssues: (...args) => require('./ddl').targetIssues(...args),
    prepare: (...args) => require('./ddl').prepare(...args),
    renderers: (...args) => require('./runtime').renderers(...args)
};
