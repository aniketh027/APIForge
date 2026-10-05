'use strict';
const keys=Object.freeze([
    ['Implicit','value STRING'],['Generated','identity INT PRIMARY KEY'],
    ['StaticInt','identity INT PRIMARY KEY DEFAULT 42'],['TextKey','identity STRING PRIMARY KEY'],
    ['RuntimeUuid','identity UUID PRIMARY KEY'],['StaticUuid','identity UUID PRIMARY KEY DEFAULT "00000000-0000-0000-0000-000000000000"']
]);
const scalars=`ENTITY Scalars
identity INT PRIMARY KEY
integerValue INT MIN -2 MAX 12 DEFAULT 4
textValue STRING REQUIRED UNIQUE MIN_LENGTH 1 MAX_LENGTH 260 DEFAULT "A'\\B"
realValue FLOAT MIN 0 MAX 12 DEFAULT 1.5
flag BOOLEAN DEFAULT FALSE
choice ENUM("z","A","é","a'","a\\b",""," leading","trailing ") DEFAULT "trailing "
day DATE DEFAULT "2000-02-29"
moment TIMESTAMP DEFAULT "2000-02-29T12:34:56Z"
token UUID DEFAULT "ffffffff-ffff-ffff-ffff-ffffffffffff"
__proto__ STRING
constructor STRING
prototype STRING`;
const relations=Object.freeze(['ONE_TO_MANY','MANY_TO_ONE','ONE_TO_ONE','MANY_TO_MANY'].map((kind,i)=>`ENTITY Source${i} sourceKey UUID PRIMARY KEY ENTITY Target${i} targetKey STRING PRIMARY KEY MAX_LENGTH 260 RELATION Source${i} related Target${i} ${kind}`));
module.exports={keys,scalars,relations};
