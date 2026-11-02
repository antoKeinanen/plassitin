import test from 'node:test'
import assert from 'node:assert/strict'
import { eventSchema, evaluatePlan } from './model'
import { solveWithTrace } from './solver.server'
import { solverRunSchema } from './solver-debug'
import { constraintNetwork, networkLayout, rulePeople, ruleResolution } from './debug-network'
import { editorSchema, rebuildEvent } from './editor'
import { scoreSeatCentrality, scoreSeatCoverage, scoreSeatPlan } from './seat-optimizer'
import { scoreSeatBlocks } from './seat-blocks'

function fixture(){
  return eventSchema.parse({version:1,name:'Debug example',attendees:[...'abcdef'].map((id,index)=>({id,name:id,groups:[index<3?'crew':'friends'],aliases:[],text:''})),tables:[{id:'one',name:'One',capacity:4},{id:'two',name:'Two',capacity:4},{id:'three',name:'Three',capacity:4}],clauses:[{id:'like',personId:'a',kind:'prefer',reference:'b',state:'resolved',targets:['b'],weight:1},{id:'avoid',personId:'b',kind:'avoid',reference:'d',state:'resolved',targets:['d'],weight:1}],locks:{e:'three'},separations:[['a','d']],objective:'fairness'})
}
test('debug trace records real stage assignments and preserves frozen packing priorities',async()=>{
  const event=rebuildEvent({event:fixture(),links:{},decisions:{}}),run=solverRunSchema.parse(await solveWithTrace(event,4))
  assert.equal(run.result.kind,'plan');if(run.result.kind!=='plan')return
  assert.equal(run.result.status,'optimal')
  assert.deepEqual(run.stages.map(s=>s.objective),['Use fewer tables','Fill tables','Avoid unwanted pairings','Give guests a companion','Protect least satisfied guests','Prioritize named companions','Improve companion matches','Place nearby companions'])
  const used=(assignments:Record<string,string>)=>new Set(Object.values(assignments)).size
  const full=(assignments:Record<string,string>)=>event.tables.filter(t=>Object.values(assignments).filter(id=>id===t.id).length===t.capacity).length
  const first=run.stages[0],second=run.stages[1]
  assert.ok(first.assignments);assert.ok(second.assignments)
  assert.equal(first.value,-used(first.assignments));assert.equal(second.value,full(second.assignments))
  for(const [index,stage] of run.stages.filter(s=>s.objective!=='Place nearby companions').entries()){
    assert.equal(stage.status,'Optimal');assert.equal(stage.frozen,true);assert.ok(stage.assignments)
    assert.deepEqual(evaluatePlan(event,stage.assignments).violations,[])
    assert.equal(used(stage.assignments),used(first.assignments))
    if(index>=1)assert.equal(full(stage.assignments),full(second.assignments))
  }
  assert.deepEqual(run.stages.at(-1)?.assignments,run.result.assignments)
  assert.deepEqual(run.stages.at(-1)?.seatIndices,run.result.seatIndices)
  assert.ok(run.result.seatIndices)
  assert.deepEqual(evaluatePlan(event,run.result.assignments,run.result.seatIndices).violations,[])
  assert.equal(run.stages.at(-1)?.value,scoreSeatPlan(event,run.result.assignments,run.result.seatIndices))
  assert.equal(run.stages.at(-1)?.centralityCost,scoreSeatCentrality(event,run.result.assignments,run.result.seatIndices))
  assert.equal(run.stages.at(-1)?.coveredGuests,scoreSeatCoverage(event,run.result.assignments,run.result.seatIndices))
  assert.equal(run.stages.at(-1)?.blockCost,scoreSeatBlocks(event,run.result.assignments,run.result.seatIndices))
  assert.deepEqual(run.event,event)
  const restored=editorSchema.parse({version:2,event:run.event,assignments:run.result.assignments,links:{},decisions:{}})
  assert.equal(JSON.stringify(eventSchema.parse(rebuildEvent(restored))),JSON.stringify(run.event))
})
test('failed and unstarted solver stages never fabricate a seating plan',async()=>{
  const event=fixture();event.locks={a:'one',b:'one'};event.separations=[['a','b']]
  const infeasible=await solveWithTrace(event,3)
  assert.equal(infeasible.result.kind,'infeasible');assert.equal(infeasible.stages[0]?.status,'Infeasible');assert.equal(infeasible.stages[0]?.assignments,null);assert.equal(infeasible.stages[0]?.frozen,false)
  const timeout=await solveWithTrace(fixture(),0)
  assert.equal(timeout.result.kind,'timeout');assert.equal(timeout.stages[0]?.assignments,null);assert.equal(timeout.stages[0]?.frozen,false)
  event.tables=event.tables.map(t=>({...t,capacity:1}));event.locks={};event.separations=[]
  const shortage=await solveWithTrace(event,3)
  assert.equal(shortage.result.kind,'infeasible');assert.deepEqual(shortage.stages,[])
  const unresolved=fixture();unresolved.clauses.push({id:'unknown',personId:'a',kind:'prefer',reference:'unmapped',weight:1,state:'unresolved'})
  const blocked=await solveWithTrace(unresolved,3)
  assert.equal(blocked.result.kind,'error');assert.deepEqual(blocked.stages,[])
})
test('network represents shared tags compactly and evaluates actual assignments',()=>{
  const event=rebuildEvent({event:fixture(),links:{},decisions:{}}),rules=constraintNetwork(event)
  assert.equal(rules.filter(r=>r.kind==='tag').length,2)
  assert.equal(rules.filter(r=>r.kind==='prefer').length,1)
  const assignments={a:'one',b:'one',c:'one',d:'two',e:'three',f:'two'}
  const crew=rules.find(rule=>rule.kind==='tag'&&rule.label==='#crew');assert.ok(crew)
  assert.equal(ruleResolution(crew,event,assignments).satisfied,true)
  assert.equal(ruleResolution(crew,event,{...assignments,c:'two'}).satisfied,false)
  for(const kind of ['capacity','separation','lock'] as const){const rule=rules.find(rule=>rule.kind===kind);assert.ok(rule);assert.equal(ruleResolution(rule,event,assignments).satisfied,true);assert.equal(ruleResolution(rule,event,Object.fromEntries(event.attendees.map(p=>[p.id,'one']))).satisfied,false)}
  assert.deepEqual(rulePeople(crew,event,assignments),['a','b','c'])
  const layout=networkLayout(event,assignments,rules)
  assert.equal(layout.people.size,event.attendees.length)
  for(const table of layout.tables)for(const person of table.members){const point=layout.people.get(person.id);assert.ok(point);assert.ok(point.x>=table.x&&point.x+160<=table.x+table.width);assert.ok(point.y>=table.y&&point.y+44<=table.y+table.height)}
  assert.ok(layout.hubs.has(crew.id))
  const custom=constraintNetwork({...event,clauses:[{id:'external-each',personId:'a',kind:'prefer',reference:'b and c',state:'resolved',targets:['b','c'],match:'each',weight:1}]}).find(rule=>rule.kind==='prefer')
  assert.ok(custom)
  assert.equal(ruleResolution(custom,event,{...assignments,c:'two'}).satisfied,false)
  assert.equal(ruleResolution(custom,event,assignments).satisfied,true)
})
