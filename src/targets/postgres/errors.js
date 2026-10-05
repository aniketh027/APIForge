'use strict';
const GROUPS=Object.freeze([
    {status:409,message:'Request conflicts with existing data.',codes:['23505','23503']},
    {status:400,message:'Request contains a value rejected by the database.',codes:['23502','23514','22P02','22003','22001','22007','22008','22021']},
    {status:503,message:'Database temporarily unavailable.',codes:['08000','08001','08003','08006','08007','40001','40P01','55P03','53300','57P01','57P02','57P03','ECONNREFUSED','ECONNRESET','EPIPE','ETIMEDOUT']}
]);
function classify(error,operation='read') {
    const known=DATABASE_ERRORS.find(group=>typeof error?.code==='string'&&group.codes.includes(error.code));
    const applicable=known&&(known.status===503||(known.status===409&&operation!=='read')||(known.status===400&&(operation==='write'||operation==='association')));
    return {status:applicable?known.status:500,error:applicable?known.message:'Unable to complete request.'};
}
const DATABASE_ERRORS=GROUPS;
function generateDatabaseErrorHandler() {
    return '// Database error taxonomy\nconst DATABASE_ERRORS = '+JSON.stringify(GROUPS,null,4)+';\n\n'+classify.toString()+`\n\nfunction sendDatabaseError(res,error,operation='read') {
    const result=classify(error,operation);
    return res.status(result.status).json({success:false,error:result.error});
}
// End database error taxonomy\n\n`;
}
module.exports={GROUPS,classify,generateDatabaseErrorHandler};
