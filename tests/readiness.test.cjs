const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Readable } = require('node:stream');
const root = path.join(__dirname, '..');
const { isOwnedEvidencePath } = require('../api/_utils/storage-path');
const { fulfillEvent } = require('../api/_utils/fulfillment');
const { reserveAnalysis, completeAnalysis, releaseAnalysis, quotaResponse } = require('../api/_utils/usage');
const { freePreview } = require('../api/_utils/preview');

function response() { return { code:200, setHeader(){}, status(code){this.code=code;return this;}, json(body){this.body=body;return this;}, end(body){this.body=body;return this;} }; }
function query(data, error=null) {
  const q={};
  for(const m of ['select','eq','order','single','maybeSingle','upsert','update','insert','delete']) q[m]=()=>q;
  q.then=(resolve,reject)=>Promise.resolve({data,error}).then(resolve,reject);
  return q;
}
function handler(file, mocks={}, env={}) {
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(root,'api',file),'utf8'),{
    module,process:{env},require(name){
      if(name in mocks)return mocks[name];
      if(name.startsWith('./_utils/'))return require(path.join(root,'api',name));
      throw new Error('Unexpected dependency '+name);
    },console:{error(){},log(){}},Buffer,setTimeout,clearTimeout,URL
  },{filename:file});
  return module.exports;
}
const env={SUPABASE_URL:'https://example.invalid',SUPABASE_SERVICE_ROLE_KEY:'fake',STRIPE_SECRET_KEY:'fake',STRIPE_WEBHOOK_SECRET:'fake'};
const req=(method,body={},params={})=>({method,body,query:params,headers:{authorization:'Bearer synthetic'}});

test('storage paths require the exact user and case, without traversal/encoding',()=>{
  assert.equal(isOwnedEvidencePath('alice/case-a/report.pdf','alice','case-a'),true);
  for(const p of ['bob/case-a/report.pdf','alice/case-b/report.pdf','alice/case-a/../secret','alice/case-a/%2e%2e','alice/case-a/x%2fy','alice/case-a/x\\y','alice/case-a/','alice/case-a/..']) {
    assert.equal(isOwnedEvidencePath(p,'alice','case-a'),false,p);
  }
});
test('evidence rejects foreign paths on create, sign and delete before storage calls',async()=>{
  for(const method of ['POST','GET','DELETE']){
    let storageCalls=0;
    const sb={auth:{getUser:async()=>({data:{user:{id:'alice'}}})},from(t){return query(t==='cases'?{id:'case-a'}:{id:'ev',case_id:'case-a',file_path:'bob/case-a/private.pdf'});},storage:{from(){storageCalls++;throw new Error('Forbidden storage call');}}};
    const h=handler('evidence.js',{'@supabase/supabase-js':{createClient:()=>sb}},env),res=response();
    await h(req(method,{case_id:'case-a',file_path:'bob/case-a/private.pdf'},{id:'ev',action:'url'}),res);
    assert.equal(res.code,method==='POST'?400:403);assert.equal(storageCalls,0);
  }
});
test('evidence signs owned paths and fails closed when storage deletion fails',async()=>{
  let deletedRows=0;
  const sb={auth:{getUser:async()=>({data:{user:{id:'alice'}}})},from(){const q=query({id:'ev',case_id:'case-a',file_path:'alice/case-a/file.pdf'});q.delete=()=>{deletedRows++;return q;};return q;},storage:{from:()=>({createSignedUrl:async()=>({data:{signedUrl:'https://signed.invalid'}}),remove:async()=>({error:{message:'storage unavailable'}})})}};
  const h=handler('evidence.js',{'@supabase/supabase-js':{createClient:()=>sb}},env);
  const get=response();await h(req('GET',{}, {id:'ev',action:'url'}),get);assert.equal(get.code,200);assert.equal(get.body.url,'https://signed.invalid');
  const del=response();await h(req('DELETE',{}, {id:'ev'}),del);assert.equal(del.code,500);assert.equal(deletedRows,0);
});
test('evidence catches rejected auth service calls',async()=>{
  const h=handler('evidence.js',{'@supabase/supabase-js':{createClient:()=>({auth:{getUser:async()=>{throw new Error('offline');}}})}},env);
  const res=response();await h(req('GET'),res);assert.equal(res.code,500);
});
test('checkout requires auth, binds immutable account ID, and ignores hostile Origin/email',async()=>{
  let config;
  const sb={auth:{getUser:async()=>({data:{user:{id:'alice',email:'account@example.invalid'}}})},from:()=>query(null)};
  const h=handler('create-checkout.js',{'stripe':()=>({checkout:{sessions:{create:async c=>{config=c;return {url:'https://checkout.stripe.com/example',id:'session'};}}}}),'@supabase/supabase-js':{createClient:()=>sb}},env);
  const unauth=response();await h({method:'POST',headers:{},body:{tier:'single'}},unauth);assert.equal(unauth.code,401);assert.equal(config,undefined);
  const input=req('POST',{tier:'practitioner',email:'attacker@example.invalid'});input.headers.origin='https://attacker.invalid';
  const res=response();await h(input,res);assert.equal(res.code,200);assert.equal(config.customer_email,'account@example.invalid');assert.equal(config.client_reference_id,'alice');assert.equal(config.metadata.user_id,'alice');assert.equal(config.subscription_data.metadata.tier,'practitioner');assert.ok(config.success_url.startsWith('https://inveritaslaw.com/'));
});
test('checkout handles missing config without initializing Stripe and blocks duplicate subscriptions',async()=>{
  const noConfig=handler('create-checkout.js',{'@supabase/supabase-js':{}},{}),a=response();await noConfig(req('POST'),a);assert.equal(a.code,500);
  let called=false;
  const sb={auth:{getUser:async()=>({data:{user:{id:'alice',email:'a@example.invalid'}}})},from:()=>query({stripe_subscription_id:'sub_existing'})};
  const h=handler('create-checkout.js',{'stripe':()=>({checkout:{sessions:{create:async()=>{called=true;}}}}),'@supabase/supabase-js':{createClient:()=>sb}},env),b=response();await h(req('POST',{tier:'firm'}),b);assert.equal(b.code,409);assert.equal(called,false);
});
function paidEvent(overrides={}) {return {id:'evt_synthetic',type:'checkout.session.completed',data:{object:{id:'cs_synthetic',payment_status:'paid',metadata:{tier:'single',user_id:'alice'},...overrides}}};}
test('fulfillment uses an idempotent transactional RPC and rejects its failure',async()=>{
  let params;
  const sb={auth:{admin:{getUserById:async id=>{assert.equal(id,'alice');return {data:{user:{id,email:'a@example.invalid'}}};}}},rpc:async(name,p)=>{assert.equal(name,'fulfill_checkout_payment');params=p;return {error:{message:'write failed'}};}};
  await assert.rejects(fulfillEvent(sb,paidEvent()),/Transactional fulfillment failed/);
  assert.equal(params.p_user_id,'alice');assert.equal(params.p_stripe_event_id,'evt_synthetic');assert.equal(params.p_stripe_session_id,'cs_synthetic');
});
test('legacy checkout lookup paginates and missing users fail instead of acknowledging',async()=>{
  let pages=[];
  const sb={auth:{admin:{listUsers:async({page})=>{pages.push(page);return {data:{users:page===1?Array.from({length:100},()=>({email:'other@example.invalid'})):[{id:'alice',email:'A@EXAMPLE.INVALID'}]}};}}},rpc:async()=>({data:true}),from:()=>query(null)};
  await fulfillEvent(sb,paidEvent({metadata:{tier:'single'},customer_email:'a@example.invalid'}));assert.deepEqual(pages,[1,2]);
  await assert.rejects(fulfillEvent(sb,paidEvent({metadata:{tier:'single'},customer_email:'missing@example.invalid'})),/reconciliation/);
});
test('unpaid checkout does not grant access',async()=>{
  await fulfillEvent({from(){throw new Error('Must not grant');}},paidEvent({payment_status:'unpaid'}));
});
test('subscription recovery uses tier metadata and targets subscription ID',async()=>{
  let update,filters=[];
  const sb={from:()=>{const q=query({user_id:'alice',subscription_tier:'none'});q.update=v=>{update=v;return q;};q.eq=(k,v)=>{filters.push([k,v]);return q;};return q;}};
  await fulfillEvent(sb,{type:'customer.subscription.updated',data:{object:{id:'sub_a',status:'active',metadata:{tier:'practitioner'}}}});
  assert.equal(update.subscription_tier,'practitioner');assert.ok(filters.some(([k,v])=>k==='stripe_subscription_id'&&v==='sub_a'));
});
test('one-off subscription conflicts are surfaced by the transactional database function',async()=>{
  const sb={auth:{admin:{getUserById:async()=>({data:{user:{id:'alice'}}})}},rpc:async()=>({error:{message:'one-off purchase conflicts with active subscription'}})};
  await assert.rejects(fulfillEvent(sb,paidEvent()),/conflicts with active subscription/);
});
test('usage helpers reserve, complete, release, and map quota failures',async()=>{
  const calls=[];const sb={rpc:async(name,args)=>{calls.push([name,args]);return name==='reserve_analysis'?{data:[{reservation_id:'r1',reserved_tier:'single'}]}:{data:null};}};
  const reservation=await reserveAnalysis(sb,'alice');assert.equal(reservation.reservation_id,'r1');
  await completeAnalysis(sb,'alice','r1');await releaseAnalysis(sb,'alice','r1');
  assert.deepEqual(calls.map(c=>c[0]),['reserve_analysis','complete_analysis','release_analysis']);
  assert.equal(quotaResponse(new Error('credit_required')).status,403);
  await assert.rejects(reserveAnalysis({rpc:async()=>({error:{message:'offline'}})},'alice'),/Unable to reserve/);
});
test('free preview omits paid legal arguments and recommendation sections',()=>{
  const full={content:[{type:'text',text:JSON.stringify({charge_analysis:{offense:'Example'},inversion_vectors:[{title:'Vector',category:'STATUTORY',legal_tier:'STATE',confidence:70,argument:'paid secret',applicable_law:'paid citation'}],recommended_motions:['paid motion'],critical_deadlines:['paid deadline']})}]};
  const preview=freePreview(full),parsed=JSON.parse(preview.content[0].text);
  assert.equal(preview.preview_locked,true);assert.equal(parsed.vector_count,1);assert.equal(parsed.inversion_vectors[0].title,'Vector');
  assert.ok(!JSON.stringify(preview).includes('paid secret'));assert.ok(!JSON.stringify(preview).includes('paid motion'));assert.ok(!JSON.stringify(preview).includes('paid deadline'));
  assert.equal(JSON.parse(full.content[0].text).recommended_motions[0],'paid motion');
});
test('webhook rejects bad signatures and retries required fulfillment failure',async()=>{
  for(const badSignature of [true,false]){
    const sb={auth:{admin:{getUserById:async()=>({error:{message:'database offline'}})}}};
    const h=handler('stripe-webhook.js',{'stripe':()=>({webhooks:{constructEvent:()=>{if(badSignature)throw new Error('signature');return paidEvent();}}}),'@supabase/supabase-js':{createClient:()=>sb}},env);
    const request=Readable.from([Buffer.from('{"synthetic":true}')]);request.method='POST';request.headers={'stripe-signature':'test'};
    const res=response();await h(request,res);assert.equal(res.code,badSignature?400:500);
  }
});
test('all model request paths use the shared provider adapter and reject retired models',()=>{
  const p=path.join(root,'api/_utils/model.js'),module={exports:{}};
  vm.runInNewContext(fs.readFileSync(p,'utf8'),{module,process:{env:{AI_PROVIDER:'anthropic',ANTHROPIC_MODEL:'claude-sonnet-4-20250514'}}});
  assert.throws(()=>module.exports.getModel(),/retired/);
  const normal={exports:{}};vm.runInNewContext(fs.readFileSync(p,'utf8'),{module:normal,process:{env:{}}});assert.equal(normal.exports.getModel(),'gpt-5.6-sol');
  for(const f of ['analyze','reanalyze','generate-motion','platform']){const s=fs.readFileSync(path.join(root,'api',f+'.js'),'utf8');assert.ok(!s.includes('api.anthropic.com'));assert.ok(s.includes('callModel('));}
  const client=fs.readFileSync(path.join(root,'api','_utils','ai-client.js'),'utf8');
  assert.ok(client.includes("process.env.AI_FALLBACK_PROVIDER || ''"));
  assert.ok(!client.includes("const fallback = primary === 'openai'"));
});

test('health distinguishes configuration checks from dependency readiness',async()=>{
  for (const configured of [true,false]) {
    const modelMock={getProvider:()=> 'openai',getModel:()=> 'gpt-5.6-sol',hasAIConfig:()=>configured};
    const h=handler('health.js',{'./_utils/model':modelMock},configured?{...env,OPENAI_API_KEY:'fake'}:{}),res=response();
    await h({},res);
    assert.equal(res.code,configured?200:503);
    assert.equal(res.body.dependencies_tested,false);
    assert.equal(res.body.scope,'configuration_only');
  }
});

test('reanalysis returns atomic JSON within the hosting timeout',()=>{
  const api=fs.readFileSync(path.join(root,'api','reanalyze.js'),'utf8');
  const dashboard=fs.readFileSync(path.join(root,'public','dashboard.html'),'utf8');
  assert.ok(!api.includes("res.write(' ')"),'reanalyze must not commit partial whitespace responses');
  assert.ok(!api.includes('setInterval(function()'),'reanalyze must not use response keepalive timers');
  assert.ok(api.includes('maxTokens: 3000'),'reanalyze output must be bounded for the 60-second function');
  assert.ok(api.includes("reasoningEffort: 'low'"),'reanalyze must use bounded reasoning effort');
  assert.ok(api.includes("process.env.OPENAI_REANALYSIS_MODEL || 'gpt-5.6-terra'"),'reanalyze must use the benchmarked low-latency model');
  assert.ok(api.includes('return res.status(200).json({'),'reanalyze success must use an atomic JSON response');
  assert.ok(dashboard.includes('hosting gateway before a result was returned'),'dashboard must explain gateway termination');
  assert.ok(!dashboard.includes("prompt('Add any additional context"),'reanalysis must not block submission on a browser prompt');
});
