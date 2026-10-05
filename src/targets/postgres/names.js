'use strict';
const {createHash} = require('crypto');
const PROFILE = 'postgresql-18-v1';
const KINDS = Object.freeze(['pk','uq','ck','fk','ix','seq','nn']);
const SYSTEM_COLUMNS = Object.freeze(['tableoid','xmin','cmin','xmax','cmax','ctid']);
function validUnicode(value) {
    if (typeof value !== 'string') return false;
    for (let i=0;i<value.length;i++) {
        const c=value.charCodeAt(i);
        if (c>=0xd800 && c<=0xdbff) {
            const next=value.charCodeAt(++i); if (!(next>=0xdc00 && next<=0xdfff)) return false;
        } else if (c>=0xdc00 && c<=0xdfff) return false;
    }
    return true;
}
function identifierIssue(name, column = false) {
    if (!validUnicode(name) || !name.length || name.includes('\0')) return 'must be nonempty well-formed Unicode without NUL';
    if (Buffer.byteLength(name,'utf8')>63) return 'exceeds 63 UTF-8 bytes';
    if (column && SYSTEM_COLUMNS.includes(name)) return 'is a PostgreSQL system column';
    return null;
}
function quoteIdentifier(name) {
    const issue=identifierIssue(name); if (issue) throw new Error('PostgreSQL identifier '+issue+'.');
    return '"'+name.replace(/"/g,'""')+'"';
}
function table(name) { return '"public".'+quoteIdentifier(name); }
function generatedName(kind, ownerId, fieldIds = [], purpose = '') {
    if (!KINDS.includes(kind)) throw new Error('Unknown PostgreSQL generated-name kind.');
    const result='af_'+kind+'_'+createHash('sha256').update(JSON.stringify([PROFILE,kind,ownerId,fieldIds,purpose])).digest('hex').slice(0,40);
    if (identifierIssue(result)) throw new Error('Invalid generated PostgreSQL name.');
    return result;
}
module.exports={PROFILE,KINDS,SYSTEM_COLUMNS,validUnicode,identifierIssue,quoteIdentifier,table,generatedName};
