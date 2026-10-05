'use strict';
const assert = require('assert/strict');
const M = require('../src/migrations');
const target = require('../src/utils/mysql-target');
const { compileProject } = require('./generated-backend-test-helpers');
const { database, introspect } = require('./migration-mysql-helpers');
const q = target.quoteIdentifier;
const scalar = value => target.formatSQLLiteral({ type: typeof value === 'number' ? 'NUMBER' : typeof value === 'boolean' ? 'BOOLEAN' : 'STRING', value });
const body = `v STRING
n INT
b BOOLEAN
e ENUM("", "first", "a'b", "a\\b", "😀")
d DATE
t TIMESTAMP
u UUID
f FLOAT`;
const source = (fields = body) => 'ENTITY Item\n' + fields;
const seeds = [
    [1, '', 0, false, '', '2000-02-29', '1970-01-01 00:00:01', '00000000-0000-0000-0000-000000000000', 0],
    [2, "a'b\\😀  ", -2147483648, true, "a'b", '9999-12-31', '2038-01-19 03:14:07', 'ffffffff-ffff-ffff-ffff-ffffffffffff', -3.4e38],
    [3, 'x'.repeat(255), 2147483647, null, 4, null, null, null, 3.4e38]
];
async function seed(c, rows = seeds) {
    for (const row of rows) await c.query('INSERT INTO Item (id,v,n,b,e,d,t,u,f) VALUES (?,?,?,?,?,?,?,?,?)', row);
}

// Test-only row oracle. Production G26 never opens a database connection.
async function satisfied(c, old, next, requirement) {
    const t = old.tables.find(t => t.id === requirement.tableId), future = next.tables.find(t => t.id === requirement.tableId);
    const expression = cid => {
        const existing = t.columns.find(c => c.id === cid), added = future.columns.find(c => c.id === cid);
        if (existing) return q(existing.name);
        return added.default.declared ? scalar(added.default.physical.value) : 'NULL';
    };
    const table = q(t.name), cols = requirement.columnIds?.map(expression);
    let sql;
    switch (requirement.type) {
        case 'TABLE_EMPTY': sql = `SELECT 1 FROM ${table} LIMIT 1`; break;
        case 'NO_NULLS': sql = `SELECT 1 FROM ${table} WHERE ${cols.map(v => v + ' IS NULL').join(' OR ')} LIMIT 1`; break;
        case 'VALUES_FIT_STRING_CAPACITY': sql = `SELECT 1 FROM ${table} WHERE CHAR_LENGTH(${cols[0]}) > ${requirement.capacity} LIMIT 1`; break;
        case 'UNIQUE_VALUES': sql = `SELECT 1 FROM ${table} WHERE ${cols.map(v => v + ' IS NOT NULL').join(' AND ')} GROUP BY ${cols.join(',')} HAVING COUNT(*) > 1 LIMIT 1`; break;
        case 'VALUES_SATISFY_CHECK': {
            const condition = requirement.condition, col = expression(condition.columnId), value = condition.measure === 'char_length' ? `CHAR_LENGTH(${col})` : col;
            sql = `SELECT 1 FROM ${table} WHERE ${col} IS NOT NULL AND NOT (${[condition.min === null ? null : `${value} >= ${condition.min}`, condition.max === null ? null : `${value} <= ${condition.max}`].filter(Boolean).join(' AND ')}) LIMIT 1`; break;
        }
        case 'NO_ORPHAN_FOREIGN_KEYS': {
            const parent = old.tables.find(t => t.id === requirement.referencedTableId);
            sql = `SELECT 1 FROM ${table} child WHERE ${cols.map(v => 'child.' + v + ' IS NOT NULL').join(' AND ')} AND NOT EXISTS (SELECT 1 FROM ${q(parent.name)} parent WHERE ${requirement.referencedColumnIds.map((cid, n) => 'parent.' + q(parent.columns.find(c => c.id === cid).name) + '=child.' + cols[n]).join(' AND ')}) LIMIT 1`; break;
        }
        default: throw Error('Unknown test predicate');
    }
    return (await c.query(sql))[0].length === 0;
}

async function runNativeTransitions(c) {
    let migrations = 0, intermediateComparisons = 0, preservationComparisons = 0, predicateChecks = 0,omissionChecks=0;
    async function transition(name, from, to, options = {}) {
        await database(c, async db => {
            const old = typeof from === 'string' ? M.compileSourceForSnapshot(from) : from;
            const next = typeof to === 'string' ? M.compileSourceForSnapshot(to) : to;
            if(old.tables.length)await c.query(compileProject(options.oldSource || from).find(f => f.path === 'database/schema.sql').content);
            if (options.setup) await options.setup(c);
            assert.deepEqual(await introspect(c, db, old.target), M.physicalProjection(old), name + ' OLD');
            if (options.seed) await options.seed(c); else if (old.tables.some(t => t.name === 'Item')) await seed(c, options.rows);
            const retained = old.tables.filter(t => next.tables.some(n => n.id === t.id)).map(t => {
                const nt = next.tables.find(n => n.id === t.id), cols = t.columns.filter(col => nt.columns.some(n => n.id === col.id)).map(col => col.name);
                return { table: t.name, cols, rows: null };
            });
            for (const r of retained) r.rows = (await c.query(`SELECT ${r.cols.map(q).join(',')} FROM ${q(r.table)} ORDER BY ${r.cols.map(q).join(',')}`))[0];
            const plan = M.planMysqlMigration(old, next);
            assert.equal(plan.blockers.length, 0, name + ' supported');
            for (const op of plan.operations) for (const requirement of op.requirements) { assert(await satisfied(c, old, next, requirement), name + ' prerequisite');assert.equal((await c.query(requirement.checkSpecification.checkSql))[0].length,0,'exact generated predicate'); predicateChecks+=2; }
            const rendered = M.renderMysqlMigration(old, next, plan, { expectPlan: M.hash(plan), allowDestructiveOperationIds: plan.operations.filter(o => o.safetyClass === 'DESTRUCTIVE').map(o => o.id), acknowledgeDataCheckOperationIds: plan.operations.filter(o => o.requirements.length).map(o => o.id) });
            for(const op of plan.operations){const omitted=M.clone(plan);omitted.operations=omitted.operations.filter(o=>o.id!==op.id);omitted.executionOrder=omitted.executionOrder.filter(id=>id!==op.id);assert.throws(()=>M.simulateMigration(old,omitted,next),'omitting '+op.id);omissionChecks++;}
            for (const statement of rendered.statements) {
                await c.query(statement.sql);
                const actual = await introspect(c, db, old.target), expected = rendered.simulation.steps.find(s => s.operationId === statement.operationId);
                assert.equal(M.hash(actual), expected.physicalSha256, name + ' operation ' + statement.operationId); intermediateComparisons++;
            }
            assert.deepEqual(await introspect(c, db, old.target), M.physicalProjection(next), name + ' NEW');
            for (const r of retained) {
                assert.deepEqual((await c.query(`SELECT ${r.cols.map(q).join(',')} FROM ${q(r.table)} ORDER BY ${r.cols.map(q).join(',')}`))[0], r.rows, name + ' retained cells, identities and associations'); preservationComparisons++;
            }
            if (options.verify) await options.verify(c);
            migrations++;
            console.log('  migration ' + name + ' PASS');
        });
    }
    const before = source();
    await transition('nullable-all-types', before, source(body + '\nx INT\ns STRING\nz BOOLEAN\nf2 FLOAT\ne2 ENUM("one","two")\nd2 DATE\nt2 TIMESTAMP\nu2 UUID'), { verify: async c => { const [rows] = await c.query('SELECT x,s,z,f2,e2,d2,t2,u2 FROM Item'); assert(rows.every(r => Object.values(r).every(v => v === null))); } });
    await transition('required-static-defaults', before, source(body + '\nx INT REQUIRED DEFAULT -1\ns STRING REQUIRED DEFAULT "a\\b"\nz BOOLEAN REQUIRED DEFAULT FALSE\nt2 TIMESTAMP REQUIRED DEFAULT "2000-02-29T00:00:00Z"'), { verify: async c => { const [rows] = await c.query('SELECT x,s,z,t2 FROM Item'); assert(rows.every(r => r.x === -1 && r.s === 'a\\b' && r.z === 0 && r.t2 === '2000-02-29 00:00:00')); } });
    await transition('float-default-binary32-add',before,source(body+'\nf2 FLOAT REQUIRED DEFAULT 0.1'),{verify:async c=>{const [rows]=await c.query('SELECT CAST(f2 AS DOUBLE) value FROM Item');assert(rows.every(r=>r.value===Math.fround(0.1)));}});
    await transition('float-default-binary32-change',source(body.replace('f FLOAT','f FLOAT DEFAULT 0.1')),source(body.replace('f FLOAT','f FLOAT DEFAULT 0.2')));
    await transition('float-default-physical-equivalence',source(body.replace('f FLOAT','f FLOAT DEFAULT 0.1')),source(body.replace('f FLOAT','f FLOAT DEFAULT 0.10000000149011612')));
    await transition('string-widen', before, source(body.replace('v STRING', 'v STRING MAX_LENGTH 500')));
    await transition('defaults-future-inserts', source(body.replace('v STRING', 'v STRING DEFAULT "old"')), source(body.replace('v STRING', 'v STRING DEFAULT "new"')));
    await transition('defaults-remove', source(body.replace('v STRING', 'v STRING DEFAULT "old"')), before);
    await transition('nullable-relax', source(body.replace('v STRING', 'v STRING REQUIRED')), before);
    await transition('check-remove', source(body.replace('n INT', 'n INT MIN -2147483648 MAX 2147483647')), before);
    await transition('check-relax', source(body.replace('n INT', 'n INT MIN -10 MAX 10')), source(body.replace('n INT', 'n INT MIN -20 MAX 20')), { rows: seeds.map((r, i) => r.map((v, n) => n === 2 ? i - 1 : v)) });
    await transition('enum-prefix-append-ordinals', before, source(body.replace('"😀")', '"😀", "last")')), { verify: async c => { assert.deepEqual((await c.query('SELECT e+0 ordinal FROM Item ORDER BY id'))[0].map(r => r.ordinal), [1, 3, 4]); } });
    await transition('identity-metadata', before, 'ENTITY Item\nid INT PRIMARY KEY\n' + body);
    const uniqueOld = source(body.replace('v STRING', 'v STRING UNIQUE'));
    await transition('unique-remove', uniqueOld, before);
    for (const key of ['k INT PRIMARY KEY', 'k INT PRIMARY KEY DEFAULT 0', 'k STRING PRIMARY KEY', 'k UUID PRIMARY KEY', 'k UUID PRIMARY KEY DEFAULT "550e8400-e29b-41d4-a716-446655440000"']) {
        const a = 'ENTITY Keyed\n' + key + '\nv STRING', b = a + '\nx INT';
        await transition('key-' + key.split(' ').slice(0, 2).join('-') + (key.includes('DEFAULT') ? '-default' : ''), a, b, { seed: async c => {
            const value = key.includes('STRING') ? "a'b\\😀 " : key.includes('UUID') ? 'ffffffff-ffff-ffff-ffff-ffffffffffff' : -2147483648;
            await c.query('INSERT INTO Keyed(k,v) VALUES (?,?)', [value, 'retained']);
        } });
    }
    await transition('table-create-drop', before, before + '\nENTITY Empty\nv STRING');
    await transition('column-drop', source(body + '\nx STRING'), before, { seed: async c => { await seed(c); await c.query("UPDATE Item SET x='lost intentionally'"); } });
    await transition('table-drop', before + '\nENTITY Empty\nv STRING', before);
    const endpoints = before + '\nENTITY Parent\nk UUID PRIMARY KEY\nv STRING';
    for (const cardinality of ['ONE_TO_MANY', 'MANY_TO_ONE', 'ONE_TO_ONE', 'MANY_TO_MANY']) {
        const relation = endpoints + '\nRELATION Parent LINK Item ' + cardinality;
        await transition('relation-add-' + cardinality, endpoints, relation, { seed: async c => { await seed(c); await c.query("INSERT INTO Parent(k,v) VALUES ('00000000-0000-0000-0000-000000000000','retained')"); } });
        await transition('relation-label-' + cardinality, relation, relation.replace('LINK Item', 'LABEL Item'), { seed: async c => {
            await seed(c); await c.query("INSERT INTO Parent(k,v) VALUES ('00000000-0000-0000-0000-000000000000','retained')");
            if (cardinality === 'MANY_TO_MANY') await c.query("INSERT INTO Parent_Item(parent_k,item_id) VALUES ('00000000-0000-0000-0000-000000000000',1)");
            else if (cardinality === 'MANY_TO_ONE') await c.query('UPDATE Parent SET item_id=1');
            else await c.query("UPDATE Item SET parent_k='00000000-0000-0000-0000-000000000000' WHERE id=1");
        } });
        await transition('relation-remove-' + cardinality, relation, endpoints, { seed: async c => { await seed(c); await c.query("INSERT INTO Parent(k,v) VALUES ('00000000-0000-0000-0000-000000000000','retained')"); } });
    }
    const dataCases = [
        ['NO_NULLS', before, source(body.replace('v STRING', 'v STRING REQUIRED')), seeds, seeds.map((r, i) => r.map((v, n) => i === 0 && n === 1 ? null : v))],
        ['UNIQUE_VALUES', before, uniqueOld, seeds, seeds.map((r, i) => r.map((v, n) => n === 1 ? (i === 0 ? 'a' : i === 1 ? 'A ' : 'unique') : v))],
        ['VALUES_FIT_STRING_CAPACITY', source(body.replace('v STRING', 'v STRING MAX_LENGTH 300')), before, seeds, seeds.map((r, i) => r.map((v, n) => i === 0 && n === 1 ? 'x'.repeat(300) : v))],
        ['VALUES_SATISFY_CHECK', before, source(body.replace('n INT', 'n INT MIN -10 MAX 10')), seeds.map((r, i) => r.map((v, n) => n === 2 ? i : v)), seeds],
        ['TABLE_EMPTY', before, source(body + '\nx INT REQUIRED'), [], seeds]
    ];
    for (const [type, from, to, positive, negative] of dataCases) {
        await transition('predicate-positive-' + type, from, to, { rows: positive });
        await database(c, async () => {
            const old = M.compileSourceForSnapshot(from), next = M.compileSourceForSnapshot(to), plan = M.planMysqlMigration(old, next);
            await c.query(compileProject(from).find(f => f.path === 'database/schema.sql').content); await seed(c, negative);
            const requirements = plan.operations.flatMap(o => o.requirements).filter(r => r.type === type);
            assert(requirements.length && !(await satisfied(c, old, next, requirements[0])), type + ' violating dataset detected before DDL');assert((await c.query(requirements[0].checkSpecification.checkSql))[0].length,'generated predicate detects violation');predicateChecks+=2;
        });
    }
    // Explicit physical snapshots exercise FK support behavior that the DSL
    // cannot express as a user-named secondary index.
    const fkSource = 'ENTITY Parent\nv INT\nENTITY Child\nowner INT';
    const fkOld = M.compileSourceForSnapshot(fkSource);
    const child = s => s.tables.find(t => t.name === 'Child'), parent = s => s.tables.find(t => t.name === 'Parent');
    function withFK(old, supportName = 'fk_child_parent') {
        const next = M.clone(old), t = child(next), p = parent(next), cid = M.id('column', 'Child', 'owner'), relationRef = 'relation:Parent/LINK/Child/ONE_TO_MANY';
        t.foreignKeys.push({ id: M.id('fk', 'Child', 'fk_child_parent'), name: 'fk_child_parent', columns: [cid], referencedTableId: p.id, referencedColumns: p.primaryKey.columns, onDelete: 'SET NULL', onUpdate: 'RESTRICT', relationRef });
        if (!t.indexes.some(i => i.columns[0] === cid)) t.indexes.push({ id: M.id('index', 'Child', supportName), name: supportName, unique: false, method: 'BTREE', columns: [cid], purposes: ['fk_support'], implicit: true });
        next.relations.push({ logicalRef: relationRef, name: 'LINK', sourceTableId: p.id, targetTableId: t.id, cardinality: 'ONE_TO_MANY', storage: { kind: 'foreign_key', tableId: t.id, columnIds: [cid] } });
        return M.validateSnapshot(next);
    }
    const fkNext = withFK(fkOld);
    const fkSeed = async c => { await c.query('INSERT INTO Parent(id,v) VALUES (1,0),(2,-1)'); await c.query('INSERT INTO Child(id,owner) VALUES (1,1),(2,2),(3,NULL)'); };
    await transition('fk-auto-support', fkOld, fkNext, { oldSource: fkSource, seed: fkSeed });
    await database(c, async () => {
        await c.query(compileProject(fkSource).find(f => f.path === 'database/schema.sql').content); await c.query('INSERT INTO Child(id,owner) VALUES (1,999)');
        const requirement = M.planMysqlMigration(fkOld, fkNext).operations.flatMap(o => o.requirements).find(r => r.type === 'NO_ORPHAN_FOREIGN_KEYS');
        assert(!(await satisfied(c, fkOld, fkNext, requirement)));assert((await c.query(requirement.checkSpecification.checkSql))[0].length);predicateChecks+=2;
    });
    for (const unique of [false, true]) {
        const old = M.clone(fkOld), t = child(old), name = 'existing_support';
        t.indexes.push({ id: M.id('index', 'Child', name), name, unique, method: 'BTREE', columns: [M.id('column', 'Child', 'owner')], purposes: ['fk_support'], implicit: false });
        await transition('fk-existing-' + (unique ? 'unique' : 'secondary'), old, withFK(old), { oldSource: fkSource, setup: c => c.query(`ALTER TABLE Child ADD ${unique ? 'UNIQUE ' : ''}INDEX existing_support(owner)`), seed: fkSeed });
    }
    const superseded = M.clone(fkNext);
    child(superseded).indexes = [{ id: M.id('index', 'Child', 'replacement'), name: 'replacement', unique: true, method: 'BTREE', columns: [M.id('column', 'Child', 'owner')], purposes: ['fk_support','unique'], implicit: false }];
    const fkSetup = async c => { await c.query('ALTER TABLE Child ADD CONSTRAINT fk_child_parent FOREIGN KEY(owner) REFERENCES Parent(id) ON DELETE SET NULL'); };
    await transition('index-supersedes-implicit', fkNext, superseded, { oldSource: fkSource, setup: fkSetup, seed: fkSeed });
    const removed = M.clone(fkNext); child(removed).foreignKeys = []; removed.relations = [];
    await transition('fk-removal-support-remains', fkNext, removed, { oldSource: fkSource, setup: fkSetup, seed: fkSeed });
    const removedSuperseded=M.clone(superseded);child(removedSuperseded).foreignKeys=[];removedSuperseded.relations=[];
    await transition('removed-fk-support-superseded',removed,removedSuperseded,{oldSource:fkSource,setup:async c=>{await fkSetup(c);await c.query('ALTER TABLE Child DROP FOREIGN KEY fk_child_parent');},seed:fkSeed});
    const compositeSource='ENTITY Parent\nv INT\nENTITY Other\nv INT\nENTITY Child\nowner INT\nother INT';
    const composite=M.compileSourceForSnapshot(compositeSource),ct=child(composite),pt=parent(composite),ot=composite.tables.find(t=>t.name==='Other');
    const owner=M.id('column','Child','owner'),other=M.id('column','Child','other');
    pt.indexes.push({id:M.id('index','Parent','pair'),name:'pair',unique:true,method:'BTREE',columns:[pt.identity.columnId,M.id('column','Parent','v')],purposes:['unique'],implicit:false});
    ct.indexes.push({id:M.id('index','Child','fk_pair'),name:'fk_pair',unique:false,method:'BTREE',columns:[owner,other],purposes:['fk_support'],implicit:true});
    for(const [name,parentTable,parts,referenced] of [['fk_pair',pt,[owner,other],pt.indexes[0].columns],['fk_short',ot,[owner],ot.primaryKey.columns]]){
        const relationRef='relation:'+name;ct.foreignKeys.push({id:M.id('fk','Child',name),name,columns:parts,referencedTableId:parentTable.id,referencedColumns:referenced,onDelete:'SET NULL',onUpdate:'RESTRICT',relationRef});
        composite.relations.push({logicalRef:relationRef,name,sourceTableId:parentTable.id,targetTableId:ct.id,cardinality:'ONE_TO_MANY',storage:{kind:'foreign_key',tableId:ct.id,columnIds:parts}});
    }
    const stillNeeded=M.clone(composite);child(stillNeeded).indexes.push({id:M.id('index','Child','replacement_owner'),name:'replacement_owner',unique:false,method:'BTREE',columns:[owner],purposes:['fk_support'],implicit:false});
    await transition('implicit-index-needed-by-another-fk',composite,stillNeeded,{oldSource:compositeSource,setup:async c=>{
        await c.query('ALTER TABLE Parent ADD UNIQUE INDEX pair(id,v); ALTER TABLE Child ADD CONSTRAINT fk_pair FOREIGN KEY(owner,other) REFERENCES Parent(id,v) ON DELETE SET NULL; ALTER TABLE Child ADD CONSTRAINT fk_short FOREIGN KEY(owner) REFERENCES Other(id) ON DELETE SET NULL');
    },seed:async c=>{await c.query('INSERT INTO Parent(id,v) VALUES (1,-1); INSERT INTO Other(id,v) VALUES (1,0); INSERT INTO Child(id,owner,other) VALUES (1,1,-1),(2,NULL,NULL)');}});
    const cyclic='ENTITY A\nv INT\nENTITY B\nv INT\nRELATION A LINK B ONE_TO_MANY\nRELATION B SECOND A ONE_TO_MANY';
    await transition('cyclic-tables-create',M.emptySnapshot(),M.compileSourceForSnapshot(cyclic));
    await transition('cyclic-tables-drop',cyclic,M.emptySnapshot(),{seed:async c=>{await c.query('INSERT INTO A(id,v) VALUES (1,0); INSERT INTO B(id,v,a_id) VALUES (1,-1,1); UPDATE A SET b_id=1 WHERE id=1');}});
    console.log(JSON.stringify({ nativeMigrations: migrations, intermediateComparisons, preservationComparisons, predicateChecks,omissionChecks, result: 'PASS' }));
    return { migrations, intermediateComparisons, preservationComparisons, predicateChecks,omissionChecks };
}
module.exports = { runNativeTransitions };
