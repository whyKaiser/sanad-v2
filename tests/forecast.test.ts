import test from 'node:test';
import assert from 'node:assert/strict';
import fixtures from '../ml/fixtures.json';
import rawHistory from '../lib/sanad/forecast-assets/history.json';
import {createForecast,forecastCatalog,forecastCsv,forecastFeatures,localHour,predictFeatures,passengerSimulation,ForecastError} from '../lib/sanad/forecast';

const site='JFK|Terminal 4 (IAT)';
test('Exported model and timestamp feature builder match 40 independent Python test predictions',()=>{
  for(const fixture of fixtures){
    const record=rawHistory.sites.find(s=>s.id===fixture.site)!;
    const history=new Map(record.history.map(([stamp,count])=>[localHour(String(stamp)),Number(count)]));
    const time=localHour(fixture.time);
    const values=forecastFeatures(fixture.site,time,time-24*3600000,history);
    for(let i=0;i<values.length;i++){
      if(fixture.features[i]===null)assert.ok(Number.isNaN(values[i]));
      else assert.ok(Math.abs(values[i]-fixture.features[i]!)<1e-8,`feature ${i}`);
    }
    assert.ok(Math.abs(predictFeatures(fixture.site,values)-fixture.expected)<1e-7,fixture.time);
  }
});
test('Gaps are missing, exact day/week lags and future data cannot change a prediction',()=>{
  const t=localHour('2026-09-10 14:00'),h=3600000;
  const history=new Map([[t-23*h,9999],[t-24*h,18],[t-48*h,22],[t-168*h,7],[t,8888]]);
  const features=forecastFeatures(site,t,t-24*h,history);
  assert.deepEqual(features.slice(7,10),[18,22,7]);
  history.set(t-23*h,0);history.set(t,0);
  assert.deepEqual(forecastFeatures(site,t,t-24*h,history),features);
  history.delete(t-24*h);
  assert.ok(Number.isNaN(forecastFeatures(site,t,t-24*h,history)[7]));
});
test('All published sites return forecasts or explicit 422 coverage status, never runtime failures',()=>{
  const catalog=forecastCatalog();let available=0;
  for(const record of catalog.sites){
    if(!record.available){assert.throws(()=>createForecast({siteId:record.id}),e=>e instanceof ForecastError&&e.status===422);continue;}
    const result=createForecast({siteId:record.id});available++;
    assert.equal(result.rows.length,24);
    for(const row of result.rows){assert.ok(Number.isFinite(row.arrivals)&&row.arrivals>=0);assert.ok(row.lower<=row.arrivals&&row.upper>=row.arrivals);}
  }
  assert.ok(available>=27,'Formerly failing medium-coverage sites are usable');
});
test('Historical dates, validation and comparison distinguish missing from zero',()=>{
  const result=createForecast({siteId:site});
  assert.equal(result.mode,'historical_demo');assert.equal(result.rows[0].time,'2026-09-13 00:00');
  assert.equal(result.observedHours,0);assert.equal(result.replayMae,null);
  assert.equal(result.total,result.rows.reduce((sum,row)=>sum+row.arrivals,0));
  const replay=createForecast({siteId:site,asOf:'2026-09-10 23:00'});
  assert.ok(replay.observedHours>0);assert.ok(replay.replayMae!==null);
  assert.throws(()=>createForecast({siteId:site,asOf:'2026-09-15 23:00'}),e=>e instanceof ForecastError&&e.status===422);
  assert.throws(()=>createForecast({siteId:site,horizon:25}));
  assert.throws(()=>createForecast({siteId:{bad:1}}));
  assert.throws(()=>localHour('2026-02-30 00:00'));
  assert.throws(()=>localHour('2026-09-10 23:30'));
});
test('Capacity is an explicit bounded scenario; added capacity cannot raise a queue',()=>{
  const result=createForecast({siteId:site});
  const plan=passengerSimulation(result,{booths:4,additional:2,minutesPerPassenger:2,initialQueue:12});
  assert.equal(plan.baseline.capacityPerHour,120);assert.equal(plan.proposed.capacityPerHour,180);
  plan.baseline.points.forEach((p,i)=>{assert.ok(p.queue>=0);assert.ok(plan.proposed.points[i].queue<=p.queue);});
  const unchanged=passengerSimulation(result,{booths:4,additional:0,minutesPerPassenger:2,initialQueue:0});
  assert.deepEqual(unchanged.baseline,unchanged.proposed);
  assert.throws(()=>passengerSimulation(result,{booths:0,additional:2,minutesPerPassenger:0,initialQueue:-1}));
});
test('CSV comes from the exact API result with provenance and same rounded counts',()=>{
  const result=createForecast({siteId:site});const csv=forecastCsv(result);
  assert.equal(csv.split('\r\n').length,25);
  assert.ok(csv.includes('predicted_non_us_passengers'));assert.ok(csv.includes('historical_demo'));
  result.rows.forEach((row,i)=>assert.ok(csv.split('\r\n')[i+1].includes(`"${row.arrivals}"`)));
  assert.ok(forecastCatalog().metadata.test.mae<forecastCatalog().metadata.baseline.mae);
});
