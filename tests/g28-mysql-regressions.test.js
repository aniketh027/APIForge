'use strict';
const assert=require('assert/strict'),path=require('path');
const {mysqlSession}=require('./g28-mysql-session'),h=require('./generated-backend-test-helpers');
(async()=>{
    const session=await mysqlSession();
    const env={...process.env,APIFORGE_TEST_DB_HOST:session.config.host,APIFORGE_TEST_DB_PORT:String(session.config.port),APIFORGE_TEST_DB_USER:session.config.user,APIFORGE_TEST_DB_PASSWORD:session.config.password};
    const suites=['generated-backend-mysql','db-error-taxonomy-mysql','date-timestamp-mysql','uuid-mysql','migration-mysql'];
    try{
        for(const suite of suites){
            const result=await h.runCommand(process.execPath,[path.join(__dirname,suite+'.test.js')],{cwd:path.resolve(__dirname,'..'),env,timeoutMs:240000});
            assert.equal(result.code,0,result.stderr+'\n'+result.stdout);process.stdout.write(result.stdout);
        }
        console.log(JSON.stringify({gate:'shared MySQL native regressions',suites:suites.length,profile:session.profile,result:'PASS'}));
    }finally{await session.cleanup();}
})().catch(error=>{console.error(error);process.exitCode=1;});
