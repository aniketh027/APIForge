'use strict';
const {Client}=require('pg');
const {randomBytes}=require('crypto');
const {execFileSync}=require('child_process');
const assert=require('assert/strict');
const names=require('../src/targets/postgres/names');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function nativeSession() {
    let container,config;
    const keys=['HOST','PORT','USER','PASSWORD'];
    if(keys.every(k=>process.env['APIFORGE_TEST_PG_'+k]!==undefined))config={host:process.env.APIFORGE_TEST_PG_HOST,port:Number(process.env.APIFORGE_TEST_PG_PORT),user:process.env.APIFORGE_TEST_PG_USER,password:process.env.APIFORGE_TEST_PG_PASSWORD};
    else {
        container='apiforge-g27-'+randomBytes(8).toString('hex');
        const password=randomBytes(24).toString('hex');
        execFileSync('docker',['run','--detach','--name',container,'--label','apiforge.test=g27','--publish','127.0.0.1::5432','--env','POSTGRES_PASSWORD','--env','POSTGRES_INITDB_ARGS=--encoding=UTF8 --locale=C','postgres:18'],{env:{...process.env,POSTGRES_PASSWORD:password},stdio:'pipe',windowsHide:true});
        const port=execFileSync('docker',['port',container,'5432/tcp'],{encoding:'utf8',windowsHide:true}).trim();
        assert.match(port,/^127\.0\.0\.1:\d+$/);
        config={host:'127.0.0.1',port:Number(port.split(':').at(-1)),user:'postgres',password};
    }
    let admin;
    const owned=new Set();
    const cleanup=async()=>{
        try {
            if(admin) {
                for(const name of owned)await admin.query('DROP DATABASE IF EXISTS '+names.quoteIdentifier(name)+' WITH (FORCE)');
                const leftovers=await admin.query("SELECT datname FROM pg_database WHERE datname=ANY($1::text[])",[[...owned]]);
                assert.equal(leftovers.rowCount,0,'owned database cleanup');
                await admin.end();admin=null;
            }
        } finally {if(container)execFileSync('docker',['rm','--force',container],{stdio:'pipe',windowsHide:true});}
    };
    try {
        for(let i=0;i<80;i++) {
            const client=new Client({...config,database:'postgres'});
            try {await client.connect();admin=client;break;}catch(error){await client.end().catch(()=>{});if(i===79)throw error;await delay(250);}
        }
        const {rows:[profile]}=await admin.query("SELECT version() AS version,current_setting('server_version_num') AS major,current_setting('server_encoding') AS encoding,current_setting('block_size') AS block_size,current_setting('standard_conforming_strings') AS standard_conforming_strings");
        assert.equal(Math.floor(Number(profile.major)/10000),18);assert.equal(profile.encoding,'UTF8');assert.equal(profile.block_size,'8192');assert.equal(profile.standard_conforming_strings,'on');
        if(container)profile.image=execFileSync('docker',['image','inspect','postgres:18','--format','{{index .RepoDigests 0}}'],{encoding:'utf8',windowsHide:true}).trim();
        return {config,admin,profile,container,cleanup,async database(){
            const name='apiforge_g27_'+randomBytes(12).toString('hex');assert.match(name,/^apiforge_g27_[a-f0-9]{24}$/);owned.add(name);
            await admin.query('CREATE DATABASE '+names.quoteIdentifier(name)+" TEMPLATE template0 ENCODING 'UTF8'");
            const client=new Client({...config,database:name});await client.connect();
            return {name,client,config:{...config,database:name},async close(){await client.end();await admin.query('DROP DATABASE '+names.quoteIdentifier(name)+' WITH (FORCE)');}};
        }};
    } catch(error){await cleanup();throw error;}
}
function admit(source) {
    const c=require('./pinned-compiler-loader').currentCompiler();
    const ast=c.Parser.parse(c.Lexer.tokenize(source));const semantic=c.Semantic.analyze(ast,{target:'postgres'});
    assert.equal(semantic.valid,true,JSON.stringify(semantic.diagnostics));
    const ir=c.Optimizer.optimize(c.IR.generate(ast,semantic)).ir;
    return c.Codegen.prepareAdmittedGeneration(ir,{target:'postgres'});
}
module.exports={nativeSession,admit,delay};
