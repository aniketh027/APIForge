'use strict';
// Dedicated disposable-process harness, never imported by production code.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { DatabaseSync } = require('node:sqlite');
const api = require('../src/project-store');
let store, raw;
function connection(root) {
    const uri=pathToFileURL(path.join(root,'projects.sqlite3'));uri.searchParams.set('mode','rw');
    return new DatabaseSync(uri.href,{timeout:350,allowExtension:false});
}
process.on('message',async message=>{
    try {
        if(message.action==='release') {raw.exec('ROLLBACK');raw.close();process.send({released:true});process.disconnect();return;}
        if(message.action==='init') {store=await api.initializeProjectStore({root:message.root});store.close();process.send({ok:true});process.disconnect();return;}
        if(message.action==='lock') {raw=connection(message.root);raw.exec('BEGIN IMMEDIATE');process.send({locked:true});return;}
        if(message.action==='prepare-save') {store=await api.openProjectStore({root:message.root});process.send({prepared:true});return;}
        if(message.action==='save') {const result=await store.saveProject(message.id,message.revision,message.changes);store.close();process.send({ok:true,result});process.disconnect();return;}
        store=await api.openProjectStore({root:message.root});
        if(message.action==='read') {const result=await store.getProject(message.id);store.close();process.send({ok:true,result});process.disconnect();return;}
        if(message.action==='crash') {
            const original=DatabaseSync.prototype.exec;
            DatabaseSync.prototype.exec=function(sql) {
                if(sql==='BEGIN IMMEDIATE') original.call(this,'PRAGMA cache_size=10; PRAGMA cache_spill=ON;');
                if(sql==='COMMIT') {
                    if(message.afterCommit) original.call(this,sql);
                    const file=path.join(message.root,'projects.sqlite3-journal');
                    const journal=fs.existsSync(file)?fs.readFileSync(file):null;
                    process.send({transactionOpen:this.isTransaction,journalBytes:journal?journal.length:0,journalHeader:journal?journal.subarray(0,8).toString('hex'):null});
                    // Parent terminates this independently running process.
                    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);
                }
                return original.call(this,sql);
            };
            await store.saveProject(message.id,1,{source:'B'.repeat(1048576)});
            throw new Error('crash worker unexpectedly returned');
        }
        throw new Error('unknown worker command');
    } catch(error) {
        if(store)try{store.close();}catch{}
        if(raw)try{raw.close();}catch{}
        process.send({ok:false,code:error.code,message:error.message});process.disconnect();
    }
});
process.send({ready:true});
