import {z} from 'zod';
import {createForecast,forecastCatalog,forecastCsv,forecastSchema,passengerSimulation,capacitySchema} from './forecast';
import {GovernanceError} from './integrity-server';

export async function forecastHandle(request:Request):Promise<Response|null>{
  const path=new URL(request.url).pathname;
  const json=(data:unknown)=>Response.json(data,{headers:{'Cache-Control':'no-store'}});
  if(path==='/api/forecast/sites'&&request.method==='GET')return json(forecastCatalog());
  if(!['/api/forecast','/api/forecast/csv','/api/forecast/simulation'].includes(path)||request.method!=='POST')return null;
  const text=await request.text();
  if(text.length>10000)throw new GovernanceError(413,'طلب التنبؤ أكبر من المسموح.');
  const input=JSON.parse(text);
  if(path==='/api/forecast/simulation'){
    const values=z.object({forecast:forecastSchema,capacity:capacitySchema}).strict().parse(input);
    return json(passengerSimulation(createForecast(values.forecast),values.capacity));
  }
  const result=createForecast(input);
  if(path.endsWith('/csv'))return new Response(forecastCsv(result),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="sanad-historical-forecast.csv"','Cache-Control':'no-store'}});
  return json(result);
}
