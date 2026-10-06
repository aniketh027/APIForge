'use strict';
const {cliSelection}=require('../targets');
const {fail}=require('./errors');
function fileSelection(args){
    if(!args.includes('--root'))return cliSelection(args);
    const remaining=[];let root;
    for(let i=0;i<args.length;i++){
        if(args[i]!=='--root'){remaining.push(args[i]);continue;}
        if(root!==undefined || i+1===args.length || args[i+1].startsWith('--'))fail('INVALID_COMPILATION_ROOT');
        root=args[++i];
    }
    return {...cliSelection(remaining),root};
}
module.exports={fileSelection};
