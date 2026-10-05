// Shared, deterministic source fixtures for offline tests and the native oracle.
const fields = (count, type = 'BOOLEAN', modifiers = '') => Array.from({ length: count }, (_, i) => `f${i} ${type} ${modifiers}`).join('\n');
function foreignKeys(count, uniques = 0, cardinality = 'MANY_TO_ONE') {
    return `ENTITY Receiver\n${fields(Math.max(uniques, 1), 'BOOLEAN', uniques ? 'UNIQUE' : '')}\n` +
        Array.from({ length: count }, (_, i) => `ENTITY Parent${i}\nk INT PRIMARY KEY\nRELATION ${cardinality === 'ONE_TO_ONE' ? `Parent${i} link${i} Receiver` : `Receiver link${i} Parent${i}`} ${cardinality}`).join('\n');
}
const junction = (a, b) => `ENTITY Alpha\nk ${a}\nENTITY Beta\nk ${b}\nRELATION Alpha connects Beta MANY_TO_MANY`;
const enumSource = values => `ENTITY Choice\nvalue ENUM(${values.map(v => JSON.stringify(v)).join(',')})`;
const cases = [
    ['implicit-columns-1017', `ENTITY Wide\n${fields(1016)}`, true],
    ['implicit-columns-1018', `ENTITY Wide\n${fields(1017)}`, false, /1018 physical columns/],
    ['explicit-columns-1017', `ENTITY Wide\nk INT PRIMARY KEY\n${fields(1016)}`, true],
    ['explicit-columns-1018', `ENTITY Wide\nk INT PRIMARY KEY\n${fields(1017)}`, false, /1018 physical columns/],
    ['fk-columns-1018', `ENTITY Parent\nk INT PRIMARY KEY\nENTITY Wide\n${fields(1016)}\nRELATION Parent connects Wide ONE_TO_MANY`, false, /1018 physical columns/],
    ['unique-indexes-63', `ENTITY Indexed\n${fields(63, 'BOOLEAN', 'UNIQUE')}`, true],
    ['unique-indexes-64', `ENTITY Indexed\n${fields(64, 'BOOLEAN', 'UNIQUE')}`, false, /65 indexes including PRIMARY/],
    ['unique-indexes-65', `ENTITY Indexed\n${fields(65, 'BOOLEAN', 'UNIQUE')}`, false, /65 secondary indexes/],
    ['fk-indexes-63', foreignKeys(63), true],
    ['fk-indexes-64', foreignKeys(64), false, /65 indexes including PRIMARY/],
    ['fk-indexes-65', foreignKeys(65), false, /65 secondary indexes/],
    ['mixed-indexes-63', foreignKeys(31, 32), true],
    ['mixed-indexes-64', foreignKeys(32, 32), false, /65 indexes including PRIMARY/],
    ['mixed-indexes-65', foreignKeys(33, 32), false, /65 secondary indexes/],
    ['one-to-one-63', foreignKeys(63, 0, 'ONE_TO_ONE'), true],
    ['one-to-one-64', foreignKeys(64, 0, 'ONE_TO_ONE'), false, /65 indexes including PRIMARY/],
    ['key-3072', 'ENTITY Indexed\nk STRING PRIMARY KEY MAX_LENGTH 768', true],
    ['key-3076', 'ENTITY Indexed\nk STRING PRIMARY KEY MAX_LENGTH 769', false, /3076 key bytes/],
    ['string-uuid-3072', junction('STRING PRIMARY KEY MAX_LENGTH 759', 'UUID PRIMARY KEY'), true],
    ['string-uuid-3076', junction('STRING PRIMARY KEY MAX_LENGTH 760', 'UUID PRIMARY KEY'), false, /composite primary key/],
    ['uuid-uuid', junction('UUID PRIMARY KEY', 'UUID PRIMARY KEY'), true],
    ['string-int-3072', junction('STRING PRIMARY KEY MAX_LENGTH 767', 'INT PRIMARY KEY'), true],
    ['string-int-3076', junction('STRING PRIMARY KEY MAX_LENGTH 768', 'INT PRIMARY KEY'), false, /composite primary key/],
    ['logical-65535', 'ENTITY Wide\nv STRING MAX_LENGTH 16382', true],
    ['logical-65539', 'ENTITY Wide\nv STRING MAX_LENGTH 16383', false, /logical row bytes/],
    ['multiple-varchar-overflow', 'ENTITY Wide\na STRING MAX_LENGTH 9000\nb STRING MAX_LENGTH 9000', false, /logical row bytes/],
    ['mixed-logical-valid', 'ENTITY Wide\na STRING MAX_LENGTH 8190\nb STRING MAX_LENGTH 8191\nc BOOLEAN\nd BOOLEAN', true],
    ['uuid-local-valid', `ENTITY Wide\n${fields(224, 'UUID')}`, true],
    ['uuid-local-overflow', `ENTITY Wide\n${fields(225, 'UUID')}`, false, /local-record admission budget/],
    ['local-record-8125', `ENTITY Wide\n${fields(224, 'UUID')}\n${Array.from({length:9},(_,i)=>`b${i} BOOLEAN`).join('\n')}`, true],
    ['local-record-8126', `ENTITY Wide\n${fields(224, 'UUID')}\n${Array.from({length:10},(_,i)=>`b${i} BOOLEAN`).join('\n')}`, false, /8126 bytes/],
    ['dynamic-valid', `ENTITY Wide\n${fields(60, 'STRING')}`, true],
    ['fixed-varchar-local-overflow', `ENTITY Wide\n${fields(224, 'UUID')}\nv STRING`, false, /local-record admission budget/],
    ['fk-local-overflow', `ENTITY Parent\nk UUID PRIMARY KEY\nENTITY Wide\n${fields(224, 'UUID')}\nRELATION Parent connects Wide ONE_TO_MANY`, false, /local-record admission budget/],
    ['fk-logical-overflow', 'ENTITY Parent\nk UUID PRIMARY KEY\nENTITY Wide\nv STRING MAX_LENGTH 16380\nRELATION Parent connects Wide ONE_TO_MANY', false, /logical row bytes/],
    ['enum-member-255', enumSource(['😀'.repeat(255)]), true],
    ['enum-member-256', enumSource(['x', '😀'.repeat(256)]), false, /256 characters \/ 1024 bytes/],
    ['enum-ascii-member-256', enumSource(['x'.repeat(256)]), false, /256 characters \/ 256 bytes/],
    ['internal-row-id', 'ENTITY Item\ndb_row_id INT', false, /reserved InnoDB/],
    ['internal-trx-id', 'ENTITY Item\nDb_Trx_Id UUID', false, /reserved InnoDB/],
    ['internal-roll-ptr', 'ENTITY Item\nDB_ROLL_PTR BOOLEAN', false, /reserved InnoDB/],
    ['synthetic-internal-name', 'ENTITY Db\nROW_ID INT PRIMARY KEY\nENTITY Child\nv BOOLEAN\nRELATION Db connects Child ONE_TO_MANY', false, /reserved InnoDB/],
    ['primary-also-unique', 'ENTITY Indexed\nk INT PRIMARY KEY UNIQUE', true],
    ['int-default-overflow', 'ENTITY Item\nv INT DEFAULT 2147483648', false, /physical storage range/],
    ['float-default-overflow', 'ENTITY Item\nv FLOAT DEFAULT ' + '1' + '0'.repeat(39), false, /physical storage range/],
    ['float-default-rounded-overflow', 'ENTITY Item\nv FLOAT DEFAULT 340282350000000000000000000000000000000', false, /physical storage range/],
    ['float-default-valid', 'ENTITY Item\nv FLOAT DEFAULT 340282346638528860000000000000000000000', true],
    ['identifier-64', `ENTITY ${'A'.repeat(64)}\n${'b'.repeat(64)} INT PRIMARY KEY`, true],
    ['temporal-fixed', `ENTITY Item\n${fields(120, 'DATE')}\nwhenTime TIMESTAMP\ntoken UUID\nvalue FLOAT`, true]
];

function seededCases(count = 96, seed = 0x16a84) {
    let state = seed >>> 0;
    const random = n => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % n; };
    const types = ['BOOLEAN', 'INT', 'FLOAT', 'DATE', 'TIMESTAMP', 'UUID', 'STRING', 'ENUM("red","blue")'];
    return Array.from({ length: count }, (_, i) => {
        const keyTypes = ['INT', 'UUID', 'STRING MAX_LENGTH 300'];
        const keyType = keyTypes[random(keyTypes.length)];
        let source = `ENTITY Shape${i}\n` + (random(2) ? `k ${keyType.split(' ')[0]} PRIMARY KEY ${keyType.split(' ').slice(1).join(' ')}\n` : '');
        const n = [1, 8, 32, 64, 96, 128, 224, 256, 1016][random(9)];
        for (let j = 0; j < n; j++) {
            const type = types[random(types.length)];
            source += `f${j} ${type} ${type === 'STRING' ? 'MAX_LENGTH ' + [255, 384, 768, 2048, 8191][random(5)] : ''} ${random(7) === 0 ? 'UNIQUE' : ''} ${random(3) === 0 ? 'REQUIRED' : ''}\n`;
        }
        if (random(2)) source += `ENTITY Parent${i}\nk ${keyTypes[random(3)].split(' ')[0]} PRIMARY KEY\nRELATION Shape${i} connects Parent${i} ${['MANY_TO_MANY','ONE_TO_MANY','MANY_TO_ONE','ONE_TO_ONE'][random(4)]}`;
        return { name: 'seed-' + i, source };
    });
}
module.exports = { fields, foreignKeys, junction, enumSource, cases, seededCases };
