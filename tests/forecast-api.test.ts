import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {base,request} from './session';
import type {ForecastCatalog,ForecastResult,PassengerSimulation} from '../lib/sanad/forecast';
type Journal={integrity:{total:number}};

test('Forecast routes require a session, allow viewers to calculate, validate input, and preserve audit state',async()=>{
  assert.equal((await fetch(base+'/api/forecast/sites')).status,401);
  const catalog=await request('/api/forecast/sites');assert.equal(catalog.status,200);
  const data=await catalog.json() as ForecastCatalog;assert.equal(data.sites.length,35);
  const journalBefore=await(await request('/api/journal')).json() as Journal;
  const input={siteId:'JFK|Terminal 4 (IAT)',horizon:24};
  const r=await request('/api/forecast','POST',input);assert.equal(r.status,200);
  const prediction=await r.json() as ForecastResult;assert.equal(prediction.mode,'historical_demo');assert.equal(prediction.rows.length,24);
  assert.equal((await request('/api/forecast','POST',{siteId:{wrong:1}})).status,400);
  assert.equal((await request('/api/forecast','POST',{siteId:'unknown'})).status,404);
  assert.equal((await request('/api/forecast','POST',{...input,asOf:'2099-01-01 00:00'})).status,422);
  const sparse=data.sites.find((s:{available:boolean})=>!s.available);
  if(sparse)assert.equal((await request('/api/forecast','POST',{siteId:sparse.id})).status,422);
  const csv=await request('/api/forecast/csv','POST',input);assert.equal(csv.status,200);assert.match(csv.headers.get('content-type')!,/text\/csv/);
  assert.equal((await csv.text()).split('\r\n').length,25);
  const plan=await request('/api/forecast/simulation','POST',{forecast:input,capacity:{booths:4,additional:2,minutesPerPassenger:2,initialQueue:0}});assert.equal(plan.status,200);
  const result=await plan.json() as PassengerSimulation;assert.equal(result.proposed.capacityPerHour,180);
  const accounts=JSON.parse(readFileSync('work/team-private.json','utf8'));
  const viewer=accounts.find((a:{role:string})=>a.role==='viewer');
  const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({username:viewer.username,password:viewer.password})});assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie')!.split(';')[0];
  for(const path of ['/api/forecast','/api/forecast/csv']){
    const response=await fetch(base+path,{method:'POST',headers:{cookie,origin:base,'content-type':'application/json'},body:JSON.stringify(input)});assert.equal(response.status,200);
  }
  assert.equal((await fetch(base+'/api/forecast',{method:'POST',headers:{cookie,origin:'https://untrusted.example','content-type':'application/json'},body:JSON.stringify(input)})).status,403);
  const journalAfter=await(await request('/api/journal')).json() as Journal;
  assert.equal(journalBefore.integrity.total,journalAfter.integrity.total,'Forecast calculations do not modify case journals');
});
