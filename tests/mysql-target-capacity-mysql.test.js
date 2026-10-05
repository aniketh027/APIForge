// Opt-in native differential oracle. All DDL is confined to guarded disposable DBs.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { analyze, compile, content } = require('./v1-hardening-helpers');
const Codegen = require('../src/codegen/codegen');
const IR = require('../src/ir/generator');
const target = require('../src/utils/mysql-target');
const { cases, enumSource, seededCases } = require('./mysql-target-capacity-cases');
const { readServerConfig, createTemporaryDatabaseName, quoteTemporaryDatabaseName } = require('./generated-backend-mysql-helpers');
const { snapshotDirectory } = require('./generated-backend-test-helpers');
const structuralErrors = new Set(['ER_TOO_MANY_FIELDS','ER_TOO_MANY_KEYS','ER_TOO_LONG_KEY','ER_TOO_BIG_ROWSIZE',
    'ER_WRONG_COLUMN_NAME','ER_TOO_LONG_ENUM_SET_VALUE','ER_TOO_LONG_SET_ENUM_VALUE','ER_TOO_BIG_SET','ER_TOO_BIG_ENUM','ER_INVALID_DEFAULT']);
const report = { seed: '0x16a84', target: null, cases: [], imported: 0, rejected: 0, checks: 0, cleanup: false };
function check(condition, message) { report.checks++; assert(condition, message); }
async function main() {
    const output = path.resolve(__dirname,'../output'), before = snapshotDirectory(output);
    let admin;
    const databases = new Set();
    try {
        admin = await mysql.createConnection({ ...readServerConfig(process.env), connectTimeout:5000, multipleStatements:true });
        const [rows] = await admin.query('SELECT VERSION() version, @@innodb_page_size page_size, @@default_storage_engine engine, @@innodb_default_row_format row_format, @@sql_mode sql_mode, @@innodb_strict_mode innodb_strict, @@character_set_server server_charset, @@collation_server server_collation');
        report.target = rows[0];
        const t = report.target;
        if (!/^8\.4\./.test(t.version) || t.page_size < 16384 || t.engine.toLowerCase() !== 'innodb' ||
            t.row_format.toLowerCase() !== 'dynamic' || !t.innodb_strict ||
            !/STRICT_(TRANS|ALL)_TABLES/.test(t.sql_mode) || /NO_BACKSLASH_ESCAPES/.test(t.sql_mode)) {
            throw new Error('G16 live verification requires conforming MySQL 8.4 / >=16KiB / InnoDB DYNAMIC / strict target: '+JSON.stringify(t));
        }
        console.log('G16 native target: '+JSON.stringify(t));
        async function run(name, source, expected) {
            const result = analyze(source), accepted = result.semantic.valid;
            if (expected !== undefined) check(accepted === expected, name + ' compiler expectation');
            if (!accepted) check(result.semantic.diagnostics.every(d=>d.code==='SEM037'),name+' failure classification');
            const database = createTemporaryDatabaseName(), q = quoteTemporaryDatabaseName(database);
            const record = { name, accepted, imported: false, error: null };
            try {
                await admin.query('CREATE DATABASE '+q+' CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'); databases.add(database);
                await admin.query('USE '+q);
                const [settings] = await admin.query('SELECT @@character_set_database charset, @@collation_database collation');
                check(settings[0].charset === 'utf8mb4', name+' database charset');
                report.database = settings[0];
                // Raw SQL emitter intentionally bypasses the gate for rejected source:
                // the native oracle must independently demonstrate invalidity.
                const sql = accepted ? content(compile(source).files,'database/schema.sql') : Codegen.generateSQL(IR.generate(result.ast));
                try { await admin.query(sql); record.imported = true; report.imported++; }
                catch (error) { record.error = { code:error.code, errno:error.errno, message:error.sqlMessage }; report.rejected++; }
                report.cases.push(record);
                if (accepted) {
                    check(record.imported, name+' PASSED PREFLIGHT BUT MYSQL FAILED: '+JSON.stringify(record.error));
                    const plans = target.physicalPlan(result.ast.entities,result.ast.relations);
                    const [columns] = await admin.query('SELECT TABLE_NAME name, COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? GROUP BY TABLE_NAME',[database]);
                    const [indexes] = await admin.query('SELECT TABLE_NAME name, INDEX_NAME idx, COUNT(*) parts FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? GROUP BY TABLE_NAME, INDEX_NAME',[database]);
                    const [tables] = await admin.query('SELECT TABLE_NAME name, ENGINE engine, ROW_FORMAT row_format FROM information_schema.TABLES WHERE TABLE_SCHEMA=?',[database]);
                    for (const plan of plans) {
                        check(columns.find(c=>c.name===plan.name)?.n === plan.columns.length,name+' physical columns '+plan.name);
                        const actual = indexes.filter(i=>i.name===plan.name);
                        check(actual.length === plan.indexes.length,name+' physical indexes '+plan.name);
                        check(actual.find(i=>i.idx==='PRIMARY')?.parts === plan.indexes[0].parts.length,name+' primary key parts '+plan.name);
                        check(tables.find(t=>t.name===plan.name)?.engine === 'InnoDB' && tables.find(t=>t.name===plan.name)?.row_format === 'Dynamic',name+' actual table options');
                    }
                } else {
                    check(!record.imported,name+' compiler rejection must have native DDL evidence');
                    check(structuralErrors.has(record.error?.code),name+' unclassified native failure: '+JSON.stringify(record.error));
                    check(target.targetIssues(result.ast.entities,result.ast.relations).length>0,name+' target preflight failure');
                    report.checks++; assert.throws(()=>Codegen.generate(IR.generate(result.ast),false),/preflight/);
                }
                console.log('  '+name+': '+(record.imported?'IMPORT':record.error?.code)+' / preflight '+(accepted?'accept':'reject'));
            } finally {
                if (databases.has(database)) { await admin.query('DROP DATABASE '+q); databases.delete(database); }
            }
        }
        for (const [name,source,expected] of cases) await run(name,source,expected);
        for (const n of [65535,65536]) await run('enum-members-'+n,enumSource(Array.from({length:n},(_,i)=>'v'+i)),n===65535);
        for (const {name,source} of seededCases()) await run(name,source);
        check(JSON.stringify(snapshotDirectory(output)) === JSON.stringify(before),'repository output unchanged');
    } finally {
        if (admin) {
            for (const database of databases) await admin.query('DROP DATABASE '+quoteTemporaryDatabaseName(database));
            const [left] = await admin.query('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME LIKE ?', ['apiforge_e2e_%']);
            report.cleanup = left.length === 0;
            await admin.end();
        }
        if (process.env.APIFORGE_G16_REPORT) fs.writeFileSync(process.env.APIFORGE_G16_REPORT,JSON.stringify(report,null,2)+'\n');
    }
    check(report.cleanup,'no disposable databases remain');
    if (process.env.APIFORGE_G16_REPORT) fs.writeFileSync(process.env.APIFORGE_G16_REPORT,JSON.stringify(report,null,2)+'\n');
    console.log(`G16 native differential: ${report.cases.length} schemas, ${report.imported} imports / ${report.rejected} structural rejections, ${report.checks} checks PASS; cleanup PASS.`);
}
main().catch(error=>{ console.error(error.message); process.exitCode=1; });
