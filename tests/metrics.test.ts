import test from 'node:test';
import assert from 'node:assert/strict';
import {recentEventSeries} from '../src/metrics.js';
import type {WebhookEvent,Status} from '../src/domain.js';
function event(day:number,status:Status,duration?:number):WebhookEvent{return {id:String(day),type:'test.event',source:'Test',receivedAt:`2026-10-${String(day).padStart(2,'0')}T00:00:00.000Z`,payload:{},raw:'{}',status,signatureValid:status!=='rejected',scenario:'success',nextRetryAt:null,attempts:duration===undefined?[]:[{number:1,at:'2026-10-01T00:00:00.000Z',code:status==='delivered'?200:503,duration,kind:'initial',reason:'Test'}]};}
test('recent metrics use chronological retained events, current outcomes, and observed simulated latency',()=>{
 const rows=[event(4,'delivered',90),event(2,'failed',320),event(3,'rejected'),event(1,'delivered',70)];
 const series=recentEventSeries(rows,3);
 assert.deepEqual(series.total,[1,2,3]);
 assert.deepEqual(series.deliveryRate,[0,0,100/3]);
 assert.deepEqual(series.failures,[1,1,1]);
 assert.deepEqual(series.latency,[320,90]);
 assert.equal(rows[0].id,'4','does not reorder caller data');
});
test('empty retained data has no invented trend values',()=>{
 assert.deepEqual(recentEventSeries([]),{total:[],deliveryRate:[],failures:[],latency:[]});
});
