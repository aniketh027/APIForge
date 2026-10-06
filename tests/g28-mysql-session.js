'use strict';
const assert=require('assert/strict'),mysql=require('mysql2/promise');
const {randomBytes}=require('crypto'),{execFileSync}=require('child_process');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function mysqlSession(){
    const container='apiforge-g28-'+randomBytes(8).toString('hex'),password=randomBytes(24).toString('hex');
    let connection;
    const cleanup=async()=>{try{if(connection)await connection.end();}finally{execFileSync('docker',['rm','--force',container],{stdio:'pipe',windowsHide:true});}};
    execFileSync('docker',['run','--detach','--name',container,'--label','apiforge.test=g28','--publish','127.0.0.1::3306','--env','MYSQL_ROOT_PASSWORD','mysql:8.4','--character-set-server=utf8mb4','--collation-server=utf8mb4_unicode_ci'],{env:{...process.env,MYSQL_ROOT_PASSWORD:password},stdio:'pipe',windowsHide:true});
    try{
        const published=execFileSync('docker',['port',container,'3306/tcp'],{encoding:'utf8',windowsHide:true}).trim();assert.match(published,/^127\.0\.0\.1:\d+$/);
        const config={host:'127.0.0.1',port:Number(published.split(':').at(-1)),user:'root',password};
        for(let i=0;i<120;i++){
            try{connection=await mysql.createConnection({...config,multipleStatements:true,dateStrings:true,connectTimeout:1000});break;}
            catch(error){if(i===119)throw error;await delay(250);}
        }
        const [rows]=await connection.query('SELECT VERSION() version, @@innodb_page_size pages, @@lower_case_table_names casing, @@sql_mode mode, @@innodb_default_row_format rowFormat');
        assert.match(rows[0].version,/^8\.4\./);assert.equal(rows[0].pages,16384);assert.equal(rows[0].casing,0);assert.equal(rows[0].rowFormat,'dynamic');assert(!rows[0].mode.includes('NO_BACKSLASH_ESCAPES'));
        const image=execFileSync('docker',['image','inspect','mysql:8.4','--format','{{index .RepoDigests 0}}'],{encoding:'utf8',windowsHide:true}).trim();
        return {config,connection,profile:{...rows[0],image},cleanup};
    }catch(error){await cleanup();throw error;}
}
module.exports={mysqlSession};
