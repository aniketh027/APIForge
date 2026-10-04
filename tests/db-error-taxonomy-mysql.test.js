// Opt-in live verification. Never part of npm test; only disposable apiforge_e2e_* DBs.
const assert = require('assert/strict');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');
const mysql = require('mysql2/promise');
const { compileProject } = require('./generated-backend-test-helpers');
const { readServerConfig, createTemporaryDatabaseName, quoteTemporaryDatabaseName } = require('./generated-backend-mysql-helpers');
const requireRuntime = createRequire(path.resolve(__dirname, '../package.json'));
const files = compileProject('ENTITY Storage\nkey STRING PRIMARY KEY\nlabel STRING UNIQUE\namount INT\nENTITY Target\nid INT PRIMARY KEY\nname STRING\nRELATION Storage HAS Target MANY_TO_MANY');
let admin, connection, server, created = false;
const database = createTemporaryDatabaseName(), quoted = quoteTemporaryDatabaseName(database);
const observed = [];
async function main() {
    const config = {...readServerConfig(process.env),connectTimeout:4000};
    admin = await mysql.createConnection(config);
    const [version] = await admin.query('SELECT VERSION() AS version');
    console.log('Live MySQL version: '+version[0].version+'; mysql2 '+require('mysql2/package.json').version);
    await admin.query('CREATE DATABASE '+quoted+' CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'); created = true;
    connection = await mysql.createConnection({...config,database});
    await connection.query("SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION'");
    for (const sql of files.find(f=>f.path==='database/schema.sql').content.split(';').filter(s=>s.trim())) await connection.query(sql);
    const modules = new Map(), pool = {query:async (...args)=>{
        try { return await connection.query(...args); }
        catch(e) { observed.push({code:e.code,errno:e.errno}); throw e; }
    }};
    function get(name) {
        if(modules.has(name)) return modules.get(name);
        const module={exports:{}};
        vm.compileFunction(files.find(f=>f.path===name).content,['require','module'])(ref=>{
            if(ref==='../config/db') return pool;
            if(ref==='dotenv') return {config(){}};
            if(!ref.startsWith('.')) return requireRuntime(ref);
            return get(path.posix.normalize(path.posix.join(path.posix.dirname(name),ref))+'.js');
        },module); modules.set(name,module.exports); return module.exports;
    }
    server=get('server.js').listen(0,'127.0.0.1'); await new Promise(resolve=>server.once('listening',resolve));
    const base='http://127.0.0.1:'+server.address().port;
    async function call(method,url,body,status,code,errno) {
        const response=await fetch(base+url,{method,headers:body===undefined?{}:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
        const data=await response.json(); assert.equal(response.status,status);
        if(code) {
            assert.deepEqual(observed.at(-1),{code,errno});
            const message=status===409?'Request conflicts with existing data.':'Request contains a value rejected by the database.';
            assert.deepEqual(data,{success:false,error:message});
            console.log(`Live PASS: ${method} ${url} -> ${status}, ${code}/${errno}`);
        }
    }
    await call('POST','/storages',{key:'a',label:'private@example.com',amount:1},201);
    await call('POST','/storages',{key:'b',label:'different',amount:2},201);
    await call('POST','/targets',{name:'public'},201);
    await call('POST','/storages',{key:'c',label:'private@example.com'},409,'ER_DUP_ENTRY',1062);
    await call('PUT','/storages/b',{label:'private@example.com'},409,'ER_DUP_ENTRY',1062);
    await call('POST','/storages/a/targets/1',undefined,201);
    await call('POST','/storages/a/targets/1',undefined,409,'ER_DUP_ENTRY',1062);
    await call('POST','/storages/a/targets/999999',undefined,409,'ER_NO_REFERENCED_ROW_2',1452);
    await call('POST','/storages',{key:'long',label:'x'.repeat(256)},400,'ER_DATA_TOO_LONG',1406);
    await call('POST','/storages',{key:'range',amount:2147483648},400,'ER_WARN_DATA_OUT_OF_RANGE',1264);
    await call('POST','/storages',{label:'missing key'},400,'ER_NO_DEFAULT_FOR_FIELD',1364);
    await call('POST','/storages',{key:null},400,'ER_BAD_NULL_ERROR',1048);
    // Supplemental DB fixtures: generated relationships cascade; a restrictive
    // FK and a stricter external CHECK let real route errors reach the controller.
    // These additions are confined to this disposable DB, not generated schema.
    await connection.query('CREATE TABLE Restrictor (storage_key VARCHAR(255), FOREIGN KEY (storage_key) REFERENCES Storage (`key`))');
    await connection.query("INSERT INTO Restrictor VALUES ('a')");
    await call('DELETE','/storages/a',undefined,409,'ER_ROW_IS_REFERENCED_2',1451);
    await connection.query('ALTER TABLE Storage ADD CONSTRAINT external_amount_check CHECK (amount >= 0)');
    await call('PUT','/storages/b',{amount:-1},400,'ER_CHECK_CONSTRAINT_VIOLATED',3819);
    console.log('G06 live constraint verification PASS; observed codes and generic HTTP envelopes verified.');
}
(async()=>{
    let failure;
    try { await main(); } catch(e) { failure=e; console.error('G06 live verification failed:',e.code || e.name,e.errno ?? ''); }
    finally {
        try {
            if(server) await new Promise(resolve=>server.close(resolve));
            if(connection) await connection.end();
            if(created) {
                await admin.query('DROP DATABASE '+quoteTemporaryDatabaseName(database));
                const [rows]=await admin.query('SELECT COUNT(*) AS total FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?',[database]);
                assert.equal(Number(rows[0].total),0); console.log('Disposable database cleanup PASS.');
            }
        } catch(e) { failure=e; console.error('G06 live cleanup failed:',e.code || e.name); }
        finally { if(admin) await admin.end(); }
    }
    if(failure) process.exitCode=1;
})().catch(e=>{console.error('G06 live failure:',e.code || e.name);process.exitCode=1;});
