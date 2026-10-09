'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn, fork } = require('node:child_process');
const bootstrap = require('../src/windows-bootstrap');
const results = [];
const errorMessages = new Map();
const MARKER = 'bootstrap.identity.json';
const DATABASE = 'projects.sqlite3';
const JOURNAL = 'projects.sqlite3-journal';
let fixtures;
const workers = new Set();
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const exe = path.join(process.env.SystemRoot || '', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
async function ps(source, data = {}) {
    const encoded = Buffer.from('[Console]::InputEncoding=New-Object Text.UTF8Encoding($false); [Console]::OutputEncoding=New-Object Text.UTF8Encoding($false); $ErrorActionPreference="Stop"; $d=[Console]::In.ReadToEnd()|ConvertFrom-Json; ' + source, 'utf16le').toString('base64');
    return new Promise((resolve, reject) => {
        const child = spawn(exe, ['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',encoded], { shell:false, windowsHide:true, stdio:['pipe','pipe','pipe'], env:{...process.env,PSModulePath:path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','Modules')} });
        let out='', err='';
        child.stdout.on('data',b=>out+=b); child.stderr.on('data',b=>err+=b);
        child.on('error',reject); child.on('close',code=>code===0?resolve(out.trim()):reject(new Error(err || out)));
        child.stdin.end(JSON.stringify(data));
    });
}
async function securityRequest(source, request, env = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(exe, ['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(source.replace(/\r\n/g,'\n'),'utf16le').toString('base64')], {
            shell:false, windowsHide:true, stdio:['pipe','pipe','ignore'],
            env:{...process.env,...env,PSModulePath:path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','Modules')}
        });
        let out='';child.stdout.on('data',b=>out+=b);child.once('error',reject);
        child.once('close',exitCode=>{try{resolve({...JSON.parse(out.trim()),exitCode});}catch(error){reject(error);}});
        child.stdin.end(JSON.stringify(request));
    });
}
function owned(file) {
    const absolute = path.resolve(file);
    assert.ok(absolute.startsWith(fixtures + path.sep));
    return absolute;
}
async function fixture(name) {
    const folder = owned(path.join(fixtures, name + '-' + crypto.randomUUID()));
    await fsp.mkdir(folder);
    return path.join(folder, 'store');
}
async function init(name) { const root=await fixture(name); await bootstrap.initializePrivateStoreRoot({root}); return root; }
async function reject(action, code) {
    await assert.rejects(action, error => {
        assert.equal(error.name, 'WindowsBootstrapError'); assert.equal(error.code, code);
        assert.ok(!error.message.includes(fixtures)); assert.equal(Object.hasOwn(error,'cause'),false);
        if(errorMessages.has(code)) assert.equal(error.message,errorMessages.get(code)); else errorMessages.set(code,error.message);
        return true;
    });
}
async function snapshot(root) {
    const files={};
    async function walk(p) {
        const s=await fsp.lstat(p,{bigint:true});
        const key=path.relative(root,p);
        files[key]={ino:String(s.ino),dev:String(s.dev),mode:String(s.mode),size:String(s.size)};
        if(s.isSymbolicLink()) files[key].link=await fsp.readlink(p);
        else if(s.isFile()) files[key].hash=hash(await fsp.readFile(p));
        else if(s.isDirectory()) for(const n of (await fsp.readdir(p)).sort()) await walk(path.join(p,n));
    }
    await walk(root);
    const paths=Object.entries(files).filter(([,value])=>!Object.hasOwn(value,'link')).map(([relative])=>path.join(root,relative));
    const acl=await ps('$d.paths | ForEach-Object {$p=$_; $a=Get-Acl -LiteralPath $p; [pscustomobject]@{path=$p;sddl=$a.Sddl;attributes=[int][IO.File]::GetAttributes($p)}} | ConvertTo-Json -Depth 3 -Compress',{paths});
    return {files,acl};
}
async function mutateAcl(file, change) {
    owned(file);
    assert.equal((await fsp.lstat(file)).isSymbolicLink(),false);
    const source = '$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User; $directory=([IO.File]::GetAttributes($d.path) -band [IO.FileAttributes]::Directory) -ne 0; $sections=[Security.AccessControl.AccessControlSections]"Owner,Group,Access"; $acl=if($directory){[IO.Directory]::GetAccessControl($d.path,$sections)}else{[IO.File]::GetAccessControl($d.path,$sections)}; ' + change + '; if($directory){[IO.Directory]::SetAccessControl($d.path,$acl)}else{[IO.File]::SetAccessControl($d.path,$acl)}';
    await ps(source,{path:file});
}
const broad = '$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier("S-1-1-0")),[Security.AccessControl.FileSystemRights]::FullControl,[Security.AccessControl.AccessControlType]::Allow)))';
async function unchanged(root, action, code) { const before=await snapshot(root); await reject(action,code); assert.deepEqual(await snapshot(root),before); }
async function test(name, action) {
    const start=Date.now();
    try { await action(); results.push({name,status:'PASS',ms:Date.now()-start}); }
    catch(error) { results.push({name,status:'FAIL',ms:Date.now()-start,error:error.stack}); console.error(error.message); process.exitCode=1; }
    console.log(results[results.length-1].status + ' ' + name);
}
function notRun(name, reason) { results.push({name,status:'NOT RUN',reason}); console.log('NOT RUN ' + name + ': ' + reason); }
async function worker() {
    const child=fork(path.join(__dirname,'windows-bootstrap-worker.js'),[],{windowsHide:true,stdio:['ignore','ignore','pipe','ipc']});
    workers.add(child); child.once('exit',()=>workers.delete(child));
    await new Promise((resolve,reject)=>{child.once('error',reject);child.once('message',message=>message.ready?resolve():reject(new Error('worker not ready')));});
    return child;
}
function reply(child) {
    return new Promise((resolve,reject)=>{child.once('message',resolve);child.once('error',reject);child.once('exit',code=>{if(code)reject(new Error('worker exit '+code));});});
}
async function main() {
    if(process.platform!=='win32'||process.arch!=='x64') {notRun('native Windows bootstrap','requires Windows x64');return;}
    // Never use os.tmpdir(): its ancestor security may be unsuitable.
    fixtures=path.join(os.homedir(),'APIForge-M2A-W-tests-'+crypto.randomUUID());
    await fsp.mkdir(fixtures);
    console.log('Retained disposable fixtures: '+fixtures);
    const localData=await ps('[Environment]::GetFolderPath("LocalApplicationData")');
    const profile=await ps('[Environment]::GetFolderPath("UserProfile")');
    const realRoots=[path.join(profile,'.apiforge-projects'),path.join(localData,'APIForge-ProjectStore'),path.join(localData,'APIForge')];
    const realBefore=await Promise.all(realRoots.map(async root=>fs.existsSync(root)?snapshot(root):null));
    const source=fs.readFileSync(path.join(__dirname,'../src/windows-bootstrap/security.ps1'),'utf8');
    let parentSecurity, directRoot;
    await test('default root uses the OS known folder without initialization',async()=>{
        const value=await securityRequest(source,{action:'resolve',root:null});
        assert.equal(value.exitCode,0);assert.equal(value.root,path.join(profile,'.apiforge-projects'));
        const spoofed=await securityRequest(source,{action:'resolve',root:null},{HOME:fixtures,LOCALAPPDATA:fixtures});
        assert.deepEqual(spoofed,value);
        // Windows may fail the legacy known-folder lookup with a malformed USERPROFILE.
        // Refusal is required when that lookup is unavailable; it must not select a fallback.
        const unavailable=await securityRequest(source,{action:'resolve',root:null},{USERPROFILE:path.join(fixtures,'nonexistent-profile')});
        assert.equal(unavailable.exitCode,1);assert.equal(unavailable.code,'BOOTSTRAP_UNSAFE_LOCATION');
        assert.ok(Buffer.from(source.replace(/\r\n/g,'\n'),'utf16le').toString('base64').length<=30000);
    });
    await test('actual default-parent security evaluated read-only; direct profile fixture admitted without repair',async()=>{
        const policy=source.slice(source.indexOf('function Refuse'),source.indexOf('function Create-PrivateDirectory'));
        const setup='$script:sid=[Security.Principal.WindowsIdentity]::GetCurrent().User; $script:privateTrusted=@($sid.Value,"S-1-5-18","S-1-5-32-544"); $script:ancestorTrusted=$privateTrusted+"S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464"; ';
        parentSecurity=JSON.parse(await ps(policy+setup+'$a=@(Check-Ancestors $d.root); [pscustomobject]@{ancestors=$a;windows=[Environment]::OSVersion.Version.ToString();powershell=$PSVersionTable.PSVersion.ToString()}|ConvertTo-Json -Depth 5 -Compress',{root:realRoots[0]}));
        directRoot=fixtures+'-private-root';
        assert.equal(path.dirname(directRoot),profile);assert.equal(fs.existsSync(directRoot),false);
        const first=await bootstrap.initializePrivateStoreRoot({root:directRoot});
        assert.deepEqual(await bootstrap.openPrivateStoreRoot({root:directRoot}),first);
        const after=JSON.parse(await ps(policy+setup+'@(Check-Ancestors $d.root)|ConvertTo-Json -Depth 5 -Compress',{root:realRoots[0]}));
        assert.deepEqual(after,parentSecurity.ancestors);
    });
    // Test-only OS-folder responses in a copy of fixed helper code; no production override.
    const fakeFolders=source.replace("[Environment]::GetFolderPath('UserProfile')",'[string]$request.testProfile')
        .replace("[Environment]::GetFolderPath('LocalApplicationData')",'[string]$request.testLocalData');
    await test('default selection refuses retained legacy storage instead of switching or adopting',async()=>{
        const root=await fixture('legacy');const folder=path.dirname(root);const local=owned(path.join(folder,'local'));await fsp.mkdir(local);
        await bootstrap.initializePrivateStoreRoot({root:path.join(local,'APIForge-ProjectStore')});
        await bootstrap.initializePrivateStoreRoot({root:path.join(folder,'.apiforge-projects')});
        const before=await snapshot(folder);
        for(const action of ['resolve','initialize','verifyRoot']) {
            const result=await securityRequest(fakeFolders,{action,root:null,testProfile:folder,testLocalData:local});
            assert.equal(result.code,'BOOTSTRAP_LEGACY_LOCATION');assert.equal(result.exitCode,1);
        }
        assert.deepEqual(await snapshot(folder),before);
    });
    await test('dangerous capability ancestor access refused with no default fallback or ACL repair',async()=>{
        const root=await fixture('capability');const folder=path.dirname(root);const local=owned(path.join(folder,'local'));await fsp.mkdir(local);
        await mutateAcl(folder,'$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier("S-1-15-3-1")),[Security.AccessControl.FileSystemRights]::FullControl,[Security.AccessControl.AccessControlType]::Allow)))');
        const before=await snapshot(folder);
        const result=await securityRequest(fakeFolders,{action:'initialize',root:null,testProfile:folder,testLocalData:local});
        assert.equal(result.code,'BOOTSTRAP_UNSAFE_ANCESTOR');assert.equal(result.exitCode,1);
        assert.equal(fs.existsSync(path.join(folder,'.apiforge-projects')),false);
        assert.equal(fs.existsSync(path.join(local,'APIForge-ProjectStore')),false);
        assert.deepEqual(await snapshot(folder),before);
    });
    await test('unknown legacy file, directory and junction destinations refused without new default creation',async()=>{
        for(const kind of ['file','directory','junction']) {
            const root=await fixture('legacy-unknown');const folder=path.dirname(root);const local=owned(path.join(folder,'local'));await fsp.mkdir(local);
            const legacy=owned(path.join(local,'APIForge-ProjectStore'));
            if(kind==='file')await fsp.writeFile(legacy,'unknown',{flag:'wx'});
            else if(kind==='directory'){await fsp.mkdir(legacy);await fsp.writeFile(path.join(legacy,'sentinel'),'unknown',{flag:'wx'});}
            else {const target=owned(path.join(folder,'target'));await fsp.mkdir(target);await fsp.symlink(target,legacy,'junction');}
            const before=await snapshot(folder);
            const result=await securityRequest(fakeFolders,{action:'initialize',root:null,testProfile:folder,testLocalData:local});
            assert.equal(result.code,'BOOTSTRAP_LEGACY_LOCATION');assert.equal(result.exitCode,1);
            assert.equal(fs.existsSync(path.join(folder,'.apiforge-projects')),false);
            assert.deepEqual(await snapshot(folder),before);
        }
    });
    await test('fresh private initialization and reopen without elevation',async()=>{
        const root=await fixture('fresh'); const first=await bootstrap.initializePrivateStoreRoot({root});
        assert.deepEqual(await bootstrap.openPrivateStoreRoot({root}),first);
        assert.equal(first.formatVersion,1); assert.equal(Object.isFrozen(first),true);
        assert.deepEqual(first.sqlite,{main:null,journal:null,contentValidated:false});assert.equal(Object.isFrozen(first.sqlite),true);
        assert.deepEqual(await fsp.readdir(root),[MARKER]);
        const acl=JSON.parse(await ps('$a=Get-Acl -LiteralPath $d.path; [pscustomobject]@{protected=$a.AreAccessRulesProtected;owner=$a.GetOwner([Security.Principal.SecurityIdentifier]).Value;rules=@($a.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])|ForEach-Object{[pscustomobject]@{sid=$_.IdentityReference.Value;rights=[int]$_.FileSystemRights;inherited=$_.IsInherited}});elevated=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)}|ConvertTo-Json -Depth 5 -Compress',{path:root}));
        assert.equal(acl.elevated,false); assert.equal(acl.protected,true);assert.equal(acl.owner,first.ownerSid);
        assert.deepEqual(acl.rules.map(r=>r.sid).sort(),[first.ownerSid,'S-1-5-18','S-1-5-32-544'].sort());
        assert.ok(acl.rules.every(r=>r.rights===2032127&&!r.inherited));
        await unchanged(root,()=>bootstrap.initializePrivateStoreRoot({root}),'BOOTSTRAP_ROOT_EXISTS');
    });
    await test('DACL verified before the first marker byte is written',async()=>{
        const root=await fixture('birth'); const child=await worker(); const pending=reply(child);
        child.send({root,pauseBeforeMarker:true}); assert.equal((await pending).barrier,'private-directory-created');
        assert.deepEqual(await fsp.readdir(root),[]);
        assert.equal(await ps('(Get-Acl -LiteralPath $d.path).AreAccessRulesProtected',{path:root}),'True');
        const exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGKILL');await exited;
        await unchanged(root,()=>bootstrap.openPrivateStoreRoot({root}),'BOOTSTRAP_RECOVERY_REQUIRED');
        await unchanged(root,()=>bootstrap.initializePrivateStoreRoot({root}),'BOOTSTRAP_ROOT_EXISTS');
    });
    await test('process termination after exclusive marker creation retains incomplete state',async()=>{
        const root=await fixture('empty-marker');const child=await worker();const pending=reply(child);
        child.send({root,pauseAfterMarker:true});assert.equal((await pending).barrier,'empty-marker-created');
        assert.equal((await fsp.stat(path.join(root,MARKER))).size,0);
        const exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGKILL');await exited;
        await unchanged(root,()=>bootstrap.openPrivateStoreRoot({root}),'BOOTSTRAP_CORRUPT_IDENTITY');
        await unchanged(root,()=>bootstrap.initializePrivateStoreRoot({root}),'BOOTSTRAP_ROOT_EXISTS');
    });
    await test('two independent first initializers have one exclusive winner',async()=>{
        const root=await fixture('concurrent'); const children=await Promise.all([worker(),worker()]);
        const pending=children.map(reply); children.forEach(child=>child.send({root})); const responses=await Promise.all(pending);
        assert.equal(responses.filter(r=>r.ok).length,1);assert.equal(responses.find(r=>!r.ok).code,'BOOTSTRAP_ROOT_EXISTS');
        const third=await worker();const reading=reply(third);third.send({root,open:true});
        assert.deepEqual((await reading).value,responses.find(r=>r.ok).value);
    });
    await test('unknown existing directory and unrelated sentinel preserved',async()=>{
        const root=await fixture('unknown');await fsp.mkdir(root);await fsp.writeFile(path.join(root,'sentinel'),'unrelated');
        await unchanged(root,()=>bootstrap.initializePrivateStoreRoot({root}),'BOOTSTRAP_ROOT_EXISTS');
        await unchanged(root,()=>bootstrap.openPrivateStoreRoot({root}),'BOOTSTRAP_UNSAFE_ACL');
    });
    await test('broad root DACL refused without repair',async()=>{
        const root=await init('broad-root');await mutateAcl(root,broad);
        await unchanged(root,()=>bootstrap.openPrivateStoreRoot({root}),'BOOTSTRAP_UNSAFE_ACL');
    });
    await test('unsafe ancestor replacement authority refused before creation',async()=>{
        const root=await fixture('broad-parent');await mutateAcl(path.dirname(root),broad);
        await unchanged(path.dirname(root),()=>bootstrap.initializePrivateStoreRoot({root}),'BOOTSTRAP_UNSAFE_ANCESTOR');
        assert.equal(fs.existsSync(root),false);
    });
    await test('private child under newly broadened ancestor refused',async()=>{
        const root=await init('changed-parent');await mutateAcl(path.dirname(root),broad);
        await unchanged(path.dirname(root),()=>bootstrap.openPrivateStoreRoot({root}),'BOOTSTRAP_UNSAFE_ANCESTOR');
    });
    await test('current-user deny-write refused without permission mutation',async()=>{
        const root=await init('deny');await mutateAcl(root,'$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid,[Security.AccessControl.FileSystemRights]::Write,[Security.AccessControl.AccessControlType]::Deny)))');
        await unchanged(root,()=>bootstrap.openPrivateStoreRoot({root}),'BOOTSTRAP_ACCESS_DENIED');
    });
    await test('group deny overrides current-user allow conservatively',async()=>{
        const root=await init('deny-group');await mutateAcl(root,'$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier("S-1-1-0")),[Security.AccessControl.FileSystemRights]::Write,[Security.AccessControl.AccessControlType]::Deny)))');
        await unchanged(root,()=>bootstrap.openPrivateStoreRoot({root}),'BOOTSTRAP_ACCESS_DENIED');
    });
    const ownerRoot=await init('owner');
    try {
        await mutateAcl(ownerRoot,'$acl.SetOwner((New-Object Security.Principal.SecurityIdentifier("S-1-5-32-545")))');
        await test('native unexpected owner refused',()=>unchanged(ownerRoot,()=>bootstrap.openPrivateStoreRoot({root:ownerRoot}),'BOOTSTRAP_UNSAFE_OWNER'));
    } catch(error) {
        if(error.message.includes('not allowed to be the owner')) notRun('native unexpected owner refused','unelevated token cannot assign this group as owner; synthetic owner policy checked separately');
        else await test('native unexpected owner refused',()=>{throw error;});
    }
    await test('unsupported root inheritance structure refused',async()=>{
        const root=await init('inherit-only');await mutateAcl(root,'$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid,[Security.AccessControl.FileSystemRights]::Read,[Security.AccessControl.InheritanceFlags]::ContainerInherit,[Security.AccessControl.PropagationFlags]::InheritOnly,[Security.AccessControl.AccessControlType]::Allow)))');
        await unchanged(root,()=>bootstrap.openPrivateStoreRoot({root}),'BOOTSTRAP_UNSAFE_ACL');
    });
    await test('synthetic raw-descriptor policy rejects null DACL, missing owner, object and callback ACEs',async()=>{
        const source=fs.readFileSync(path.join(__dirname,'../src/windows-bootstrap/security.ps1'),'utf8');
        const policy=source.slice(source.indexOf('function Refuse'),source.indexOf('function Check-Ancestors'));
        const setup='$script:sid=[Security.Principal.WindowsIdentity]::GetCurrent().User; $script:privateTrusted=@($sid.Value,"S-1-5-18","S-1-5-32-544"); $script:ancestorTrusted=$privateTrusted; ';
        const probes=`
            $cases=@(); $base='O:'+$sid.Value+'G:'+$sid.Value+'D:P(A;OICI;FA;;;'+$sid.Value+')(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)';
            $valid=New-Object Security.AccessControl.RawSecurityDescriptor($base); Check-Descriptor $valid $true $true 'root';
            $generic=New-Object Security.AccessControl.RawSecurityDescriptor($base); foreach($a in $generic.DiscretionaryAcl){$a.AccessMask=268435456}; Check-Descriptor $generic $true $true 'root';
            $unknown=New-Object Security.AccessControl.RawSecurityDescriptor($base); $unknown.DiscretionaryAcl[0].AccessMask=33554432; $cases+=,$unknown;
            $nullDacl=New-Object Security.AccessControl.RawSecurityDescriptor($base); $nullDacl.DiscretionaryAcl=$null; $cases+=,$nullDacl;
            $missing=New-Object Security.AccessControl.RawSecurityDescriptor($base); $missing.Owner=$null; $cases+=,$missing;
            $wrong=New-Object Security.AccessControl.RawSecurityDescriptor($base); $wrong.Owner=New-Object Security.Principal.SecurityIdentifier('S-1-1-0');
            try {Check-Descriptor $wrong $true $true 'root'; throw 'ADMITTED_WRONG_OWNER'} catch {if($_.Exception.Message -ne 'BOOTSTRAP_UNSAFE_OWNER'){throw}};
            $object=New-Object Security.AccessControl.RawSecurityDescriptor($base);
            $ace=New-Object Security.AccessControl.ObjectAce([Security.AccessControl.AceFlags]::None,[Security.AccessControl.AceQualifier]::AccessAllowed,2032127,$sid,[Security.AccessControl.ObjectAceFlags]::None,[Guid]::Empty,[Guid]::Empty,$false,$null);
            $object.DiscretionaryAcl.InsertAce(0,$ace); $cases+=,$object;
            $callback=New-Object Security.AccessControl.RawSecurityDescriptor($base);
            $ace=New-Object Security.AccessControl.CommonAce([Security.AccessControl.AceFlags]::None,[Security.AccessControl.AceQualifier]::AccessAllowed,2032127,$sid,$true,(New-Object byte[] 4));
            $callback.DiscretionaryAcl.InsertAce(0,$ace); $cases+=,$callback;
            foreach($case in $cases){try{Check-Descriptor $case $true $true 'root';throw 'ADMITTED_UNSUPPORTED'}catch{if($_.Exception.Message -ne 'BOOTSTRAP_UNSUPPORTED_ACL'){throw}}}; 'policy-rejections-confirmed'
        `;
        assert.equal(await ps(policy+setup+probes),'policy-rejections-confirmed');
    });
    await test('broad identity-file DACL refused before identity read',async()=>{
        const root=await init('marker-acl');await mutateAcl(path.join(root,MARKER),broad);
        await unchanged(root,()=>bootstrap.openPrivateStoreRoot({root}),'BOOTSTRAP_UNSAFE_ACL');
    });
    await test('static root junction and parent junction refused',async()=>{
        const root=await fixture('junction');const target=owned(path.join(path.dirname(root),'target'));await fsp.mkdir(target);await fsp.writeFile(path.join(target,'sentinel'),'junction destination');
        await fsp.symlink(target,root,'junction');await unchanged(path.dirname(root),()=>bootstrap.openPrivateStoreRoot({root}),'BOOTSTRAP_UNSAFE_PATH');
        await unchanged(path.dirname(root),()=>bootstrap.initializePrivateStoreRoot({root:path.join(root,'nested')}),'BOOTSTRAP_UNSAFE_PATH');
    });
    const linkRoot=await fixture('symlink');const linkTarget=owned(path.join(path.dirname(linkRoot),'target'));await fsp.mkdir(linkTarget);
    try {
        await fsp.symlink(linkTarget,linkRoot,'dir');
        await test('native static directory symbolic link refused',()=>unchanged(path.dirname(linkRoot),()=>bootstrap.openPrivateStoreRoot({root:linkRoot}),'BOOTSTRAP_UNSAFE_PATH'));
    } catch(error) {if(error.code==='EPERM'||error.code==='EACCES')notRun('native static directory symbolic link refused','Windows denied symbolic-link creation; no elevation or policy change');else throw error;}
    await test('root replacement with copied identity bytes refused',async()=>{
        const root=await init('replacement');const old=owned(root+'-old');await fsp.rename(root,old);
        await fsp.mkdir(root);await mutateAcl(root,'$acl.SetSecurityDescriptorSddlForm((Get-Acl -LiteralPath ($d.path+"-old")).Sddl,[Security.AccessControl.AccessControlSections]"Owner,Group,Access")');
        await fsp.copyFile(path.join(old,MARKER),path.join(root,MARKER));
        await unchanged(path.dirname(root),()=>bootstrap.openPrivateStoreRoot({root}),'BOOTSTRAP_IDENTITY_MISMATCH');
    });
    await test('identity file replacement and hard links refused',async()=>{
        const root=await init('marker-replace');const file=path.join(root,MARKER);const bytes=await fsp.readFile(file);
        await fsp.rename(file,owned(path.join(path.dirname(root),'old-marker')));await fsp.writeFile(file,bytes);
        await unchanged(root,()=>bootstrap.openPrivateStoreRoot({root}),'BOOTSTRAP_IDENTITY_MISMATCH');
        const second=await init('marker-link');await fsp.link(path.join(second,MARKER),owned(path.join(path.dirname(second),'alias')));
        await unchanged(path.dirname(second),()=>bootstrap.openPrivateStoreRoot({root:second}),'BOOTSTRAP_UNSAFE_PATH');
    });
    await test('missing established root is never reinitialized',async()=>{
        const root=await init('missing');await fsp.rename(root,owned(root+'-retained'));
        await unchanged(path.dirname(root),()=>bootstrap.openPrivateStoreRoot({root}),'BOOTSTRAP_ROOT_MISSING');assert.equal(fs.existsSync(root),false);
    });
    await test('absent marker and unknown files are retained',async()=>{
        const root=await init('absent-marker');await fsp.rename(path.join(root,MARKER),owned(path.join(path.dirname(root),'marker-retained')));
        await unchanged(root,()=>bootstrap.openPrivateStoreRoot({root}),'BOOTSTRAP_RECOVERY_REQUIRED');
        const other=await init('unknown-file');await fsp.writeFile(path.join(other,'unrelated.txt'),'keep');
        await unchanged(other,()=>bootstrap.openPrivateStoreRoot({root:other}),'BOOTSTRAP_RECOVERY_REQUIRED');
    });
    await test('safe simulated SQLite main and rollback journal admitted as unvalidated; bytes and security untouched',async()=>{
        const root=await init('sqlite-files');
        await fsp.writeFile(path.join(root,DATABASE),'SIMULATED, NOT A SQLITE DATABASE\0',{flag:'wx'});
        let before=await snapshot(root);let value=await bootstrap.openPrivateStoreRoot({root});
        assert.deepEqual(await snapshot(root),before);assert.equal(value.sqlite.main.name,DATABASE);
        assert.equal(value.sqlite.journal,null);assert.equal(value.sqlite.contentValidated,false);
        assert.equal(Object.isFrozen(value.sqlite.main),true);
        await fsp.writeFile(path.join(root,JOURNAL),'SIMULATED interrupted journal bytes',{flag:'wx'});
        before=await snapshot(root);
        const opened=[];const original=fsp.open;
        fsp.open=async(file,...args)=>{opened.push({file,flags:args[0]});return original(file,...args);};
        try {value=await bootstrap.openPrivateStoreRoot({root});} finally {fsp.open=original;}
        assert.deepEqual(opened,[{file:path.join(root,MARKER),flags:'r'}]);
        assert.deepEqual(await snapshot(root),before);assert.equal(value.sqlite.journal.name,JOURNAL);
        assert.equal(value.sqlite.contentValidated,false);assert.equal(Object.isFrozen(value.sqlite.journal),true);
        await unchanged(root,()=>bootstrap.initializePrivateStoreRoot({root}),'BOOTSTRAP_ROOT_EXISTS');
    });
    await test('orphan journal, WAL/SHM, alternate spelling and wildcard lookalikes refused without cleanup',async()=>{
        for(const name of [JOURNAL,'projects.sqlite3-wal','projects.sqlite3-shm','other.sqlite3','other-journal','Projects.sqlite3']) {
            const root=await init('sqlite-unknown');await fsp.writeFile(path.join(root,name),'retain',{flag:'wx'});
            await unchanged(root,()=>bootstrap.openPrivateStoreRoot({root}),'BOOTSTRAP_RECOVERY_REQUIRED');
        }
    });
    await test('recognized SQLite names with directories, junctions or hard links refused',async()=>{
        for(const name of [DATABASE,JOURNAL]) for(const kind of ['directory','junction','hardlink']) {
            const root=await init('sqlite-'+kind);
            if(name===JOURNAL)await fsp.writeFile(path.join(root,DATABASE),'simulated',{flag:'wx'});
            const file=path.join(root,name);const target=owned(path.join(path.dirname(root),'target'));
            if(kind==='directory')await fsp.mkdir(file);
            else if(kind==='junction'){await fsp.mkdir(target);await fsp.symlink(target,file,'junction');}
            else {await fsp.writeFile(file,'simulated',{flag:'wx'});await fsp.link(file,target);}
            await unchanged(path.dirname(root),()=>bootstrap.openPrivateStoreRoot({root}),'BOOTSTRAP_UNSAFE_PATH');
        }
    });
    await test('recognized SQLite files with broad DACLs or unexpected attributes refused without repair',async()=>{
        for(const name of [DATABASE,JOURNAL]) for(const kind of ['broad','ReadOnly','Hidden']) {
            const root=await init('sqlite-'+kind);await fsp.writeFile(path.join(root,DATABASE),'simulated',{flag:'wx'});
            const file=path.join(root,name);if(name===JOURNAL)await fsp.writeFile(file,'simulated journal',{flag:'wx'});
            if(kind==='broad')await mutateAcl(file,broad);
            else await ps('[IO.File]::SetAttributes($d.path,([IO.File]::GetAttributes($d.path) -bor [IO.FileAttributes]$d.attribute))',{path:owned(file),attribute:kind});
            await unchanged(root,()=>bootstrap.openPrivateStoreRoot({root}),kind==='broad'?'BOOTSTRAP_UNSAFE_ACL':'BOOTSTRAP_UNSAFE_PATH');
        }
    });
    await test('marker corruption still refuses populated storage and preserves SQLite evidence',async()=>{
        const root=await init('sqlite-corrupt-marker');await fsp.writeFile(path.join(root,DATABASE),'simulated',{flag:'wx'});
        await fsp.writeFile(path.join(root,JOURNAL),'simulated interrupted journal',{flag:'wx'});
        await fsp.writeFile(path.join(root,MARKER),'{');
        await unchanged(root,()=>bootstrap.openPrivateStoreRoot({root}),'BOOTSTRAP_CORRUPT_IDENTITY');
    });
    await test('termination during populated-store reopen preserves all simulated SQLite-owned evidence',async()=>{
        const root=await init('sqlite-interrupted-reopen');await fsp.writeFile(path.join(root,DATABASE),'simulated',{flag:'wx'});
        await fsp.writeFile(path.join(root,JOURNAL),'simulated interrupted journal',{flag:'wx'});
        const before=await snapshot(root);const child=await worker();const pending=reply(child);
        child.send({root,open:true,pauseBeforeReadMarker:true});assert.equal((await pending).barrier,'before-marker-read');
        const exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGKILL');await exited;
        assert.deepEqual(await snapshot(root),before);
        assert.equal((await bootstrap.openPrivateStoreRoot({root})).sqlite.contentValidated,false);
        assert.deepEqual(await snapshot(root),before);
    });
    await test('corrupt, incompatible, and incomplete marker bytes retained',async()=>{
        for(const mutation of ['empty','json','version','sid','extra','oversize','utf8','bom']) {
            const root=await init('corrupt-'+mutation);const file=path.join(root,MARKER);const record=JSON.parse(await fsp.readFile(file,'utf8'));
            let bytes;
            if(mutation==='empty')bytes='';else if(mutation==='json')bytes='{';else if(mutation==='oversize')bytes='x'.repeat(4097);else if(mutation==='utf8')bytes=Buffer.from([255]);else if(mutation==='bom')bytes='\ufeff'+JSON.stringify(record)+'\n';
            else {if(mutation==='version')record.formatVersion=2;if(mutation==='sid')record.ownerSid='S-1-1-0';if(mutation==='extra')record.extra=1;bytes=JSON.stringify(record)+'\n';}
            await fsp.writeFile(file,bytes);await unchanged(root,()=>bootstrap.openPrivateStoreRoot({root}),'BOOTSTRAP_CORRUPT_IDENTITY');
        }
    });
    await test('file at root or parent directory path refused',async()=>{
        const root=await fixture('file');await fsp.writeFile(root,'keep');
        await unchanged(path.dirname(root),()=>bootstrap.openPrivateStoreRoot({root}),'BOOTSTRAP_UNSAFE_PATH');
        await unchanged(path.dirname(root),()=>bootstrap.initializePrivateStoreRoot({root:path.join(root,'child')}),'BOOTSTRAP_UNSAFE_PATH');
    });
    await test('relative, malformed, UNC, namespace, ADS and DOS-device paths refused',async()=>{
        for(const root of ['relative','C:relative','C:\\','\\\\server\\share\\store','\\\\?\\C:\\store','C:\\a\\..\\b','C:\\a\\','C:\\a.','C:\\a ','C:\\NUL','C:\\COM¹','C:\\a:stream','C:/store','C:\\a\0b'])
            await reject(()=>bootstrap.initializePrivateStoreRoot({root}),'BOOTSTRAP_INVALID_PATH');
        await reject(()=>bootstrap.openPrivateStoreRoot({root:42}),'BOOTSTRAP_INVALID_PATH');
        await reject(()=>bootstrap.openPrivateStoreRoot({root:fixtures,repair:true}),'BOOTSTRAP_INVALID_OPTIONS');
    });
    await test('unrelated location refused without writes',async()=>{
        const root='C:\\APIForge-M2A-W-unrelated-'+crypto.randomUUID();
        await reject(()=>bootstrap.initializePrivateStoreRoot({root}),'BOOTSTRAP_UNSAFE_LOCATION');assert.equal(fs.existsSync(root),false);
    });
    await test('Git checkout location refused without writes',async()=>{
        const root=await fixture('git');await fsp.writeFile(path.join(path.dirname(root),'.git'),'test sentinel');
        await unchanged(path.dirname(root),()=>bootstrap.initializePrivateStoreRoot({root}),'BOOTSTRAP_UNSAFE_LOCATION');
    });
    notRun('cross-user unauthorized access attempt','no appropriately authorized second-user credentials/session available');
    notRun('native non-NTFS, remote, removable and substituted-volume fixtures','no authorized mounted unsupported-volume fixture; lexical UNC rejection exercised separately');
    notRun('missing owner, null DACL and callback/object ACE native fixtures','no approved privilege/low-level fixture mechanism to install these descriptors');
    notRun('Windows 10 and Node 18 execution','host is Windows 11 with Node '+process.version+'; compatibility reviewed, separate native matrix required');
    notRun('native SQLite structure, transaction and hot-journal recovery','filesystem admission uses simulated bytes only; future Project Store owns SQLite validation and recovery');
    await test('real application-data storage unchanged',async()=>{
        assert.deepEqual(await Promise.all(realRoots.map(async root=>fs.existsSync(root)?snapshot(root):null)),realBefore);
    });
    await fsp.writeFile(path.join(fixtures,'results.json'),JSON.stringify({fixtures,directRoot,parentSecurity,node:process.version,platform:process.platform,arch:process.arch,realRoots,realBefore,results},null,2)+'\n',{flag:'wx'});
    console.log(JSON.stringify({fixtures,counts:results.reduce((a,r)=>(a[r.status]=(a[r.status]||0)+1,a),{})}));
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{for(const child of workers)child.kill('SIGKILL');});
