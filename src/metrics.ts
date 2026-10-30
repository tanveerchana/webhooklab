import type {WebhookEvent} from './domain.js';
/** Scope is the latest retained events ordered oldest to newest, not a time-window trend. */
export function recentEventSeries(events:WebhookEvent[],limit=12):{total:number[];deliveryRate:number[];failures:number[];latency:number[]} {
 const recent=[...events].sort((a,b)=>Date.parse(a.receivedAt)-Date.parse(b.receivedAt)).slice(-limit);
 const series:{total:number[];deliveryRate:number[];failures:number[];latency:number[]}={total:[],deliveryRate:[],failures:[],latency:[]};
 let delivered=0,failed=0;
 recent.forEach((event,index)=>{
  if(event.status==='delivered')delivered++;
  if(event.status==='failed')failed++;
  series.total.push(index+1);
  series.deliveryRate.push(delivered*100/(index+1));
  series.failures.push(failed);
  const attempt=event.attempts.at(-1);
  if(attempt)series.latency.push(attempt.duration);
 });
 return series;
}
