const {test} = require('node:test');
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('demo allocation enforces capability matching and operator authorization', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-test-'));
  const port = 32000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: {...process.env, PORT:String(port), AEGIS_DATA_PATH:path.join(temp, 'state.json')},
    stdio:'ignore', windowsHide:true
  });
  const base = `http://127.0.0.1:${port}`;
  async function request(url, options) { return fetch(`${base}${url}`, options); }
  try {
    let ready = false;
    for (let i=0; i<80 && !ready; i++) {
      try { ready=(await request('/api/state')).ok; } catch {}
      if (!ready) await new Promise(r=>setTimeout(r,50));
    }
    assert.equal(ready, true, 'server should start for the integration scenario');

    const initial = await request('/api/state').then(r=>r.json());
    assert.equal(initial.incidents.length, 3);
    assert.equal(initial.units.length, 6);

    const planResponse = await request('/api/optimize', {method:'POST',headers:{'content-type':'application/json'},body:'{}'});
    assert.equal(planResponse.status, 200);
    const {plans} = await planResponse.json();
    const fire = plans.find(p=>p.incidentId==='INC-104');
    const collision = plans.find(p=>p.incidentId==='INC-102');
    assert.ok(plans.every(p=>p.solver==='EXACT_BOUNDED_SEARCH'));
    const assignedIds=plans.flatMap(p=>p.assignments.map(a=>a.unitId));
    assert.equal(new Set(assignedIds).size,assignedIds.length,'the whole plan must not assign a unit twice');
    const weightsResponse = await request('/api/config/weights', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({severity:14,waitPerMinute:0.4,etaPenalty:3,operator:'Test Dispatcher'})});
    assert.equal(weightsResponse.status,200);
    const badWeights = await request('/api/config/weights', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({severity:0,waitPerMinute:-1,etaPenalty:999})});
    assert.equal(badWeights.status,400,'invalid objective weights are rejected');
    const staleApproval=await request('/api/decisions/INC-103/approve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({operator:'Test Dispatcher'})});assert.equal(staleApproval.status,409,'changed optimizer weights make old plans unapprovable');
    const recalculated=await request('/api/optimization/run',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}).then(r=>r.json());
    assert.ok(fire.assignments.some(a=>a.capability==='Fire'), 'building fire receives the specialized Fire capability');
    const incidentDetail = await request('/api/incidents/INC-104').then(r=>r.json());
    assert.equal(incidentDetail.assessment.status, 'validated');
    assert.ok(incidentDetail.assessment.specialists.some(a=>a.agent==='Hazard Analyst'));
    const simulation = await request('/api/simulation/run', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({incidentId:'INC-103'})}).then(r=>r.json());
    assert.equal(simulation.samples, 50);
    assert.ok(simulation.worstCaseEta >= simulation.p90Eta);
    assert.ok(simulation.p90Eta >= simulation.expectedEta);

    const blocked = await request('/api/decisions/INC-102/approve', {method:'POST',headers:{'content-type':'application/json'},body:'{}'});
    assert.equal(blocked.status, 409, 'incomplete plan must not dispatch');

    const approved = await request('/api/decisions/INC-103/approve', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({operator:'Test Dispatcher'})});
    assert.equal(approved.status, 200, 'complete plan can be explicitly approved');
    const after = await approved.json();
    assert.equal(after.incident.status, 'dispatched');
    assert.equal(after.units.find(u=>u.id==='MED-02').status, 'assigned');
    assert.ok(after.audit.some(a=>a.action==='DISPATCH_APPROVED'));

    const outcome = await request('/api/incidents/INC-103/outcome', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({actualSeverity:4,actualResponseMinutes:20,operator:'Test Dispatcher'})});
    assert.equal(outcome.status, 201);
    const evaluation = await outcome.json();
    assert.equal(evaluation.counterfactual.parameterUpdates, 'NONE - evaluation only');
    const afterOutcome = await request('/api/state').then(r=>r.json());
    assert.equal(afterOutcome.units.find(u=>u.id==='MED-02').status, 'available', 'outcome releases assigned demo units');

    const lock = await request('/api/constraints', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({instruction:'Lock MED-01'})}).then(r=>r.json());
    assert.equal(lock.status, 'APPLIED');
    const clarified = await request('/api/constraints', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({instruction:'Do not move ambulance one'})}).then(r=>r.json());
    assert.equal(clarified.status, 'CLARIFICATION_REQUIRED');
    const lockedPlans = await request('/api/optimization/run', {method:'POST',headers:{'content-type':'application/json'},body:'{}'}).then(r=>r.json());
    assert.ok(lockedPlans.plans.every(p=>!p.assignments.some(a=>a.unitId==='MED-01')));

    const invalid = await request('/api/incidents', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:'',type:'Medical',location:'Somewhere'})});
    assert.equal(invalid.status, 400, 'invalid intake must be rejected');
    const invalidType = await request('/api/incidents', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:'Unknown report',type:'Something else',location:'Somewhere',severity:3,patients:0})});
    assert.equal(invalidType.status, 400, 'unknown categories must not reach requirement rules');
    const manual=await request('/api/incidents',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:'Manual intake fallback',type:'Medical',location:'Basavanagudi',severity:2,patients:1})});assert.equal(manual.status,201,'structured manual incident entry remains available');
    const reset=await request('/api/reset',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}).then(r=>r.json());assert.equal(reset.incidents.find(i=>i.id==='INC-102').location,'Koramangala','reset restores the reproducible crisis scenario');
  } finally {
    child.kill();
    fs.rmSync(temp, {recursive:true,force:true});
  }
});

test('configured AI mode without credentials fails closed instead of using mock bids', async () => {
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'aegis-ai-test-'));
  const port=42000+Math.floor(Math.random()*15000);
  const child=spawn(process.execPath,[path.join(__dirname,'..','server.js')],{env:{...process.env,PORT:String(port),AEGIS_DATA_PATH:path.join(temp,'state.json'),AEGIS_AGENT_PROVIDER:'openai',OPENAI_API_KEY:'',OPENAI_MODEL:'test-model'},stdio:'ignore',windowsHide:true});
  const base=`http://127.0.0.1:${port}`;
  try{
    let ready=false;for(let i=0;i<80&&!ready;i++){try{ready=(await fetch(`${base}/api/health`)).ok;}catch{}if(!ready)await new Promise(r=>setTimeout(r,50));}
    assert.equal(ready,true,'AI-mode server should start');
    const health=await fetch(`${base}/api/health`).then(r=>r.json());assert.equal(health.agentRuntime.provider,'openai');assert.equal(health.agentRuntime.configured,false);
    const result=await fetch(`${base}/api/optimization/run`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'}).then(r=>r.json());
    assert.ok(result.plans.every(p=>p.missing.includes('ASSESSMENT_FAILED')),'missing credentials must block plans instead of fabricating mock bids');
    const state=await fetch(`${base}/api/state`).then(r=>r.json());assert.ok(state.assessments.every(a=>a.provider==='openai'&&a.status==='failed'));
    const intake=await fetch(`${base}/api/intake/report`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({report:'Major fire reported near Indiranagar. Several occupants are trapped. Heavy smoke is visible.'})});assert.equal(intake.status,201);const fallback=await intake.json();assert.equal(fallback.understanding.provider,'deterministic-fallback','raw report intake falls back when AI credentials are unavailable');assert.equal(fallback.incident.type,'Fire');assert.equal(fallback.assessment.status,'validated','fallback report receives deterministic specialist assessment');assert.ok(!fallback.plan.missing.includes('ASSESSMENT_FAILED'));
  }finally{child.kill();fs.rmSync(temp,{recursive:true,force:true});}
});

test('raw emergency report creates an assessed incident and responder failure automatically replans', async () => {
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'aegis-replan-test-'));
  const port=47000+Math.floor(Math.random()*12000);
  const child=spawn(process.execPath,[path.join(__dirname,'..','server.js')],{env:{...process.env,PORT:String(port),AEGIS_DATA_PATH:path.join(temp,'state.json'),AEGIS_AGENT_PROVIDER:'mock',OPENAI_API_KEY:'',OPENAI_MODEL:''},stdio:'ignore',windowsHide:true});
  const base=`http://127.0.0.1:${port}`;async function request(url,options){return fetch(`${base}${url}`,options);}
  try{
    let ready=false;for(let i=0;i<80&&!ready;i++){try{ready=(await request('/api/health')).ok;}catch{}if(!ready)await new Promise(r=>setTimeout(r,50));}
    assert.equal(ready,true,'demo server should start');
    const empty=await request('/api/intake/report',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({report:' '})});assert.equal(empty.status,400,'empty raw reports are rejected');
    const raw='Major fire reported near Indiranagar. Several people are trapped on the upper floor. Heavy smoke is visible.';
    const intakeResponse=await request('/api/intake/report',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({report:raw})});assert.equal(intakeResponse.status,201);
    const intake=await intakeResponse.json();assert.equal(intake.incident.type,'Fire');assert.equal(intake.incident.location,'Indiranagar');assert.equal(intake.incident.severity,5);assert.equal(intake.understanding.provider,'deterministic-rules');assert.equal(intake.assessment.status,'validated');assert.ok(intake.plan,'intake immediately produces a recommendation');
    assert.ok(intake.understanding.resourceRequirements.some(r=>r.capability==='Fire'&&r.quantity===1));assert.ok(intake.understanding.resourceRequirements.some(r=>r.capability==='Extrication'));assert.ok(intake.understanding.resourceRequirements.some(r=>r.capability==='BLS'));
    const prior=await request('/api/state').then(r=>r.json());assert.ok(prior.audit.some(a=>a.action==='INCIDENT_CREATED_FROM_REPORT'));
    const medicalPlan=intake.plans.find(p=>p.incidentId==='INC-103');assert.ok(medicalPlan&&!medicalPlan.missing.length,'the demo ambulance is assigned to a complete Jayanagar medical recommendation');const medicalApproval=await request('/api/decisions/INC-103/approve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({operator:'Demo Dispatcher'})});assert.equal(medicalApproval.status,200);
    const failed=await request('/api/demo/failure',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({unitId:'MED-02'})});assert.equal(failed.status,200);const replan=await failed.json();assert.equal(replan.unit.status,'out_of_service');assert.ok(replan.event.affected.some(a=>a.incidentId==='INC-103'),'the assigned medical incident is returned to review');
    assert.ok(replan.event.plans.every(p=>!p.assignments.includes('MED-02')),'failed ambulance is excluded from every new recommendation');assert.ok(replan.plans.some(p=>p.incidentId==='INC-103'&&p.missing.includes('ALS')),'new plan exposes the lost ALS coverage');
    const after=await request('/api/state').then(r=>r.json());assert.ok(after.replanEvents.length);assert.ok(after.audit.some(a=>a.action==='AUTOMATIC_REPLAN_COMPLETED'));
    const firePlan=replan.plans.find(p=>p.incidentId===intake.incident.id);assert.ok(firePlan&&!firePlan.missing.length,'available fire, rescue, and ambulance units are reassigned to the critical report');const approval=await request(`/api/decisions/${encodeURIComponent(firePlan.incidentId)}/approve`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({operator:'Demo Dispatcher'})});assert.equal(approval.status,200,'new recommendation remains subject to explicit human approval');
  }finally{child.kill();fs.rmSync(temp,{recursive:true,force:true});}
});

test('optional OR-Tools mode returns a safe single-assignment plan or falls back to bounded search', async () => {
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'aegis-solver-test-'));
  const port=52000+Math.floor(Math.random()*7000);
  const child=spawn(process.execPath,[path.join(__dirname,'..','server.js')],{env:{...process.env,PORT:String(port),AEGIS_DATA_PATH:path.join(temp,'state.json'),AEGIS_AGENT_PROVIDER:'mock',AEGIS_SOLVER:'ortools'},stdio:'ignore',windowsHide:true});
  const base=`http://127.0.0.1:${port}`;
  try{
    let ready=false;for(let i=0;i<80&&!ready;i++){try{ready=(await fetch(`${base}/api/health`)).ok;}catch{}if(!ready)await new Promise(r=>setTimeout(r,50));}assert.equal(ready,true);
    const result=await fetch(`${base}/api/optimization/run`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'}).then(r=>r.json());assert.ok(result.plans.every(p=>p.solver.startsWith('ORTOOLS_CP_SAT_')||['EXACT_BOUNDED_SEARCH','PRIORITY_GREEDY_NODE_LIMIT'].includes(p.solver)),'solver either uses CP-SAT or degrades to local bounded search');
    const ids=result.plans.flatMap(p=>p.assignments.map(a=>a.unitId));assert.equal(new Set(ids).size,ids.length,'optional solver output preserves unique unit assignment');
  }finally{child.kill();fs.rmSync(temp,{recursive:true,force:true});}
});
