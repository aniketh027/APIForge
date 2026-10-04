const assert = require('assert/strict');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');
const { compileProject } = require('./generated-backend-test-helpers');
const { originalFiles, projectDatabaseErrorChanges } = require('./db-error-taxonomy-test-helpers');
const driverErrors = require('../node_modules/mysql2/lib/constants/errors');
const requireRuntime = createRequire(path.resolve(__dirname, '../package.json'));
const privateText = 'alice@example.com secret_index secret_table SELECT private FROM secrets db.private.host:3307 password=secret';
const expected = [
    [409, 'Request conflicts with existing data.', [['ER_DUP_ENTRY',1062],['ER_NO_REFERENCED_ROW',1216],['ER_ROW_IS_REFERENCED',1217],['ER_NO_REFERENCED_ROW_2',1452],['ER_ROW_IS_REFERENCED_2',1451]]],
    [400, 'Request contains a value rejected by the database.', [['ER_BAD_NULL_ERROR',1048],['ER_NO_DEFAULT_FOR_FIELD',1364],['ER_DATA_TOO_LONG',1406],['ER_WARN_DATA_OUT_OF_RANGE',1264],['ER_CHECK_CONSTRAINT_VIOLATED',3819],['WARN_DATA_TRUNCATED',1265],['ER_TRUNCATED_WRONG_VALUE',1292],['ER_TRUNCATED_WRONG_VALUE_FOR_FIELD',1366]]],
    [503, 'Database temporarily unavailable.', [['ER_CON_COUNT_ERROR',1040],['ER_TOO_MANY_USER_CONNECTIONS',1203],['ER_LOCK_WAIT_TIMEOUT',1205],['ER_LOCK_DEADLOCK',1213],['ECONNREFUSED'],['ECONNRESET'],['EPIPE'],['ETIMEDOUT'],['PROTOCOL_CONNECTION_LOST'],['PROTOCOL_SEQUENCE_TIMEOUT']]]
];
let checks = 0, httpCalls = 0;
function load(source, requireImpl) { const module = {exports:{}}; vm.compileFunction(source,['require','module','console'])(requireImpl,module,{log:console.log,error(){}}); return module.exports; }
function runtime(files) {
    const modules = new Map(), calls = [];
    let failure, failureMatch, missing = false;
    const pool = {query: async (sql, values) => {
        calls.push({sql,values}); if (failure !== undefined && (!failureMatch || failureMatch.test(sql))) throw failure;
        if (sql.startsWith('INSERT') || sql.startsWith('UPDATE')) return [{insertId:42,affectedRows:1}];
        if (sql.startsWith('DELETE')) return [{affectedRows:missing ? 0 : 1}];
        if (sql.startsWith('SELECT COUNT')) return [[{total:missing ? 0 : 1}]];
        return [missing ? [] : [{id:1,email:'public',count:2,active:1}]];
    }};
    function get(name) {
        if (modules.has(name)) return modules.get(name);
        const value = load(files.find(f=>f.path===name).content, ref => {
            if (ref==='../config/db') return pool;
            if (ref==='dotenv') return {config(){}};
            if (ref==='express') {
                const original = requireRuntime(ref);
                const factory = () => { const app=original(); app.get('/test-global-error',()=>{throw failure;}); return app; };
                return Object.assign(factory,original);
            }
            if (!ref.startsWith('.')) return requireRuntime(ref);
            return get(path.posix.normalize(path.posix.join(path.posix.dirname(name),ref)) + '.js');
        }); modules.set(name,value); return value;
    }
    return {get,calls,fail(value,match){failure=value;failureMatch=match;},missing(value){missing=value;},app:get('server.js')};
}
function source(kind) { return 'ENTITY Parent\nid INT PRIMARY KEY\nemail STRING UNIQUE\ncount INT\nactive BOOLEAN\nENTITY Child\nid INT PRIMARY KEY\nname STRING\nRELATION Parent HAS Child ' + kind; }
async function listen(app, fn) {
    const server=app.listen(0,'127.0.0.1'); await new Promise(resolve=>server.once('listening',resolve));
    try { await fn('http://127.0.0.1:'+server.address().port); }
    finally { await new Promise(resolve=>server.close(resolve)); }
}
function endpoints(kind) {
    const many=['MANY_TO_MANY','ONE_TO_MANY'].includes(kind), segment=many?'childs':'child';
    return [
        ['GET','/parents','/parents','read'], ['GET','/parents/1','/parents/{id}','read'],
        ['POST','/parents','/parents','write',{email:'public'}], ['PUT','/parents/1','/parents/{id}','write',{email:'public'}],
        ['DELETE','/parents/1','/parents/{id}','delete'], ['GET','/parents/1/'+segment,'/parents/{id}/'+segment,'read'],
        ...(kind==='MANY_TO_MANY' ? [['POST','/parents/1/childs/2','/parents/{id}/childs/{childId}','association'],['DELETE','/parents/1/childs/2','/parents/{id}/childs/{childId}','association']] : [])
    ];
}
async function call(base, endpoint, body = endpoint[4]) {
    const res=await fetch(base+endpoint[1],{method:endpoint[0],headers:body===undefined?{}:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
    httpCalls++; const raw=await res.text(); return {status:res.status,body:JSON.parse(raw),raw,headers:[...res.headers].filter(([key])=>key.startsWith('x-total') || ['x-page','x-limit'].includes(key))};
}
function assertError(response,status,message,doc,ep) {
    assert.equal(response.status,status); assert.deepEqual(response.body,{success:false,error:message});
    assert(!JSON.stringify(response.body).includes('alice@example.com')); checks++;
    assert.equal(doc.paths[ep[2]][ep[0].toLowerCase()].responses[status].content['application/json'].schema.$ref,'#/components/schemas/.Error');
}
(async()=>{
    for(const [,,codes] of expected) for(const [code,errno] of codes) if(errno!==undefined) assert.equal(driverErrors[errno],code,'installed driver identifier');
    for(const kind of ['MANY_TO_MANY','ONE_TO_MANY','MANY_TO_ONE','ONE_TO_ONE']) {
        const files=compileProject(source(kind)), rt=runtime(files), doc=JSON.parse(files.find(f=>f.path==='swagger.json').content), eps=endpoints(kind);
        for(const f of files.filter(f=>f.path.endsWith('.js'))) new vm.Script(f.content,{filename:f.path});
        projectDatabaseErrorChanges(files,source(kind));
        assert.deepEqual(doc.components.schemas['.Error'].required,['success','error']);
        assert.deepEqual(Object.keys(doc.components.schemas['.Error'].properties),['success','error']);
        await listen(rt.app,async base=>{
            for(const ep of eps) {
                const statuses=ep[3]==='write'||ep[3]==='association' ? [400,409,500,503] : ep[3]==='delete' ? [404,409,500,503] : [500,503];
                if(ep[0]==='PUT') statuses.push(404);
                if(ep[1]==='/parents' && ep[0]==='GET') statuses.push(400);
                if((ep[1]==='/parents/1'||(!['MANY_TO_MANY','ONE_TO_MANY'].includes(kind) && ep[1].endsWith('/child'))) && ep[0]==='GET') statuses.push(404);
                assert.deepEqual(Object.keys(doc.paths[ep[2]][ep[0].toLowerCase()].responses).filter(s=>+s>=400).sort(),statuses.map(String).sort());
                for(const [status,message,codes] of expected) for(const [code,errno] of codes) {
                    const applicable=status===503 || (status===409 && ep[3]!=='read') || (status===400 && ['write','association'].includes(ep[3]));
                    for(const props of [{code,errno},...(errno===undefined?[]:[{errno}])]) {
                        rt.fail(Object.assign(new Error(privateText),props,{sql:privateText,sqlMessage:privateText,sqlState:'PRIVATE',statusCode:400}));
                        assertError(await call(base,ep),applicable?status:500,applicable?message:'Unable to complete request.',doc,ep);
                    }
                }
                for(const error of [new Error('private internal failure for alice@example.com'),new Error('Duplicate entry secret@example.com'),
                    Object.assign(new Error(privateText),{statusCode:400,safe:true,exposable:true}),
                    Object.assign(new Error(privateText),{code:'UNKNOWN',errno:1062}),Object.assign(new Error(privateText),{errno:'1062'}),
                    Object.assign(new Error(privateText),{code:'ER_ACCESS_DENIED_ERROR',errno:1045}),
                    Object.assign(new Error('Pool is closed.'),{statusCode:503}),new Error('Queue limit reached.'),null,'private thrown string']) {
                    rt.fail(error); assertError(await call(base,ep),500,'Unable to complete request.',doc,ep);
                }
            }
            rt.fail(undefined);
            const before=rt.calls.length;
            assertError(await call(base,eps[2],[]),400,'Request body must be a JSON object.',doc,eps[2]);
            assertError(await call(base,['GET','/parents?page=0','/parents','read']),400,'Invalid page parameter.',doc,eps[0]);
            assert.equal(rt.calls.length,before);
            const count=rt.calls.length;
            const malformed=await fetch(base+'/parents',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"email":'}); httpCalls++;
            assert.equal(malformed.status,400); assert.deepEqual(await malformed.json(),{success:false,error:'Request body must contain valid JSON.'});
            assert.equal(rt.calls.length,count);
            const model=rt.get('models/Parent.js'); let safe;
            try { model.parseQuery({page:'0'}); } catch(e) { safe=e; }
            safe.message=privateText; assert.equal(model.queryValidationMessage(safe),'Invalid page parameter.');
            assert.equal(model.queryValidationMessage(Object.assign(new Error(privateText),{statusCode:400})),undefined);
            rt.fail(safe); assertError(await call(base,eps[0]),500,'Unable to complete request.',doc,eps[0]);
            rt.fail(safe,/^SELECT COUNT/); assertError(await call(base,['GET','/parents?page=1','/parents','read']),500,'Unable to complete request.',doc,eps[0]);
            for(const [code,errno] of expected[2][2]) {
                rt.fail(Object.assign(new Error(privateText),{code,errno}),/^SELECT COUNT/);
                assertError(await call(base,['GET','/parents?page=1','/parents','read']),503,'Database temporarily unavailable.',doc,eps[0]);
                rt.fail(Object.assign(new Error(privateText),{code,errno}));
                const global=await call(base,['GET','/test-global-error','/parents','read']);
                assert.deepEqual(global.body,{success:false,error:'Database temporarily unavailable.'}); assert.equal(global.status,503);
            }
            const originalParse=model.parseQuery;
            model.parseQuery=()=>{throw Object.assign(new Error(privateText),{statusCode:400,safe:true});};
            rt.fail(undefined); const callsBefore=rt.calls.length;
            assertError(await call(base,eps[0]),500,'Unable to complete request.',doc,eps[0]); assert.equal(rt.calls.length,callsBefore);
            model.parseQuery=originalParse;
            rt.fail(Object.assign(new Error(privateText),{statusCode:400}));
            const global=await call(base,['GET','/test-global-error','/parents','read']);
            assert.equal(global.status,500); assert.deepEqual(global.body,{success:false,error:'Unable to complete request.'});
            rt.fail(undefined); rt.missing(true);
            for(const ep of eps.filter(ep=>ep[1]==='/parents/1' || (!['MANY_TO_MANY','ONE_TO_MANY'].includes(kind) && ep[1].endsWith('/child')))) assert.equal((await call(base,ep)).status,404);
            if(kind==='MANY_TO_MANY') assert.deepEqual((await call(base,eps.at(-1))).body,{success:true,message:'Association removed successfully'});
        });
        // Same pool returns: compare actual successful envelopes and pagination headers with main.
        const old=runtime(originalFiles(source(kind))); rt.fail(undefined); rt.missing(false);
        await listen(old.app,async oldBase=>listen(rt.app,async base=>{
            for(const ep of [...eps,['GET','/parents?page=1','/parents','read']]) assert.deepEqual(await call(base,ep),await call(oldBase,ep));
        }));
        console.log('PASS '+kind+': generated HTTP taxonomy, validation, 404, OpenAPI and main success compatibility');
    }
    console.log(`G06 PASS: ${checks} error assertions; ${httpCalls} HTTP requests; every code and numeric alias, all controller families.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
