const {test}=require('node:test');
const assert=require('node:assert/strict');
const handler=require('../api/portal-analysis');
test('portal reader fails closed before database access when unconfigured',async()=>{
 delete process.env.COURT_PORTAL_READ_TOKEN;
 const res={setHeader(){},status(n){this.code=n;return this;},json(body){this.body=body;}};
 await handler({method:'GET',headers:{}},res);
 assert.equal(res.code,503);
 assert.deepEqual(res.body,{error:'Case connection is not configured'});
});
test('portal reader rejects wrong tokens and caller-selected case IDs',async()=>{
 process.env.COURT_PORTAL_READ_TOKEN='test-only-token-never-used-in-production-1234567890';
 process.env.COURT_PORTAL_CASE_ID='00000000-0000-4000-8000-000000000001';process.env.COURT_PORTAL_OWNER_ID='00000000-0000-4000-8000-000000000002';
 const res={setHeader(){},status(n){this.code=n;return this;},json(body){this.body=body;}};
 await handler({method:'GET',headers:{authorization:'Bearer incorrect'},query:{case_id:'different-case'}},res);
 assert.equal(res.code,401);
 delete process.env.COURT_PORTAL_READ_TOKEN;delete process.env.COURT_PORTAL_CASE_ID;delete process.env.COURT_PORTAL_OWNER_ID;
});
test('portal reader does not accept requests to mutate or start analysis',async()=>{
 const res={setHeader(){},status(n){this.code=n;return this;},json(body){this.body=body;}};
 await handler({method:'POST',headers:{}},res);assert.equal(res.code,405);
});
