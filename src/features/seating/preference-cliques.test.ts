import test from 'node:test'
import assert from 'node:assert/strict'
import { eventSchema, evaluatePlan } from './model'
import type { Clause, SeatingEvent } from './model'
import { findPreferenceCliques } from './preference-cliques'
import { solveWithTrace } from './solver.server'
import { constraintNetwork, networkLayout, rulePeople, ruleResolution } from './debug-network'

function fixture(ids=[...'abcdef']):SeatingEvent{
  return eventSchema.parse({version:1,name:'Mutual groups',attendees:ids.map(id=>({id,name:id,groups:[],aliases:[],text:''})),tables:[{id:'one',name:'One',capacity:3},{id:'two',name:'Two',capacity:3}],clauses:[],locks:{},separations:[],objective:'balanced'})
}
const request=(from:string,to:string):Extract<Clause,{state:'resolved'}>=>({id:`${from}:${to}`,personId:from,kind:'prefer',reference:to,state:'resolved',targets:[to],source:'name',weight:1})
const group=(ids:string[])=>ids.flatMap(from=>ids.filter(to=>to!==from).map(to=>request(from,to)))

test('finds maximal mutual groups, including overlaps, without duplicate subgroups',()=>{
  const event=fixture();event.clauses=[...group([...'abc']),...group([...'bcd']),request('e','a'),request('f','e')]
  assert.deepEqual(findPreferenceCliques(event),{cliques:[[...'abc'],[...'bcd']],truncated:false})
  event.clauses.push(...group([...'abcd']))
  assert.deepEqual(findPreferenceCliques(event),{cliques:[[...'abcd']],truncated:false})
})
test('shared tags, one-way requests, duplicates and alternatives do not invent mutual groups',()=>{
  const event=fixture();event.attendees.forEach(p=>p.groups=['everyone'])
  event.clauses=[request('a','b'),request('b','c'),request('c','a'),...group([...'def']).map(c=>({...c,source:'tag'} satisfies Clause)),request('a','b'),{...request('a','c'),targets:['c','d']}]
  assert.deepEqual(findPreferenceCliques(event),{cliques:[],truncated:false})
})
test('clique search agrees with exhaustive subsets on small reciprocal graphs',()=>{
  const event=fixture(),ids=event.attendees.map(p=>p.id)
  let seed=73
  for(let sample=0;sample<24;sample++){
    const neighbors=new Map(ids.map(id=>[id,new Set<string>()]));event.clauses=[]
    for(let a=0;a<ids.length;a++)for(let b=a+1;b<ids.length;b++){
      seed=(Math.imul(seed,1664525)+1013904223)>>>0
      if(seed%3===0)continue
      neighbors.get(ids[a])?.add(ids[b]);neighbors.get(ids[b])?.add(ids[a]);event.clauses.push(request(ids[a],ids[b]),request(ids[b],ids[a]))
    }
    const expected:string[][]=[]
    for(let subset=0;subset<2**ids.length;subset++){
      const members=ids.filter((_,index)=>(subset&(1<<index))!==0)
      if(members.length<3||members.some(a=>members.some(b=>a!==b&&!neighbors.get(a)?.has(b))))continue
      if(ids.some(other=>!members.includes(other)&&members.every(id=>neighbors.get(id)?.has(other))))continue
      expected.push(members)
    }
    assert.deepEqual(findPreferenceCliques(event).cliques.map(c=>c.join(',')).sort(),expected.map(c=>c.join(',')).sort())
  }
})
test('dense overlapping groups stop at a deterministic search limit',()=>{
  const ids=Array.from({length:21},(_,i)=>String(i)),event=fixture(ids)
  event.clauses=ids.flatMap((from,a)=>ids.flatMap((to,b)=>a%3!==b%3?[request(from,to)]:[]))
  const result=findPreferenceCliques(event)
  assert.equal(result.truncated,true);assert.equal(result.cliques.length,256)
  for(const members of result.cliques){assert.equal(members.length,3);assert.equal(new Set(members.map(id=>Number(id)%3)).size,3)}
  assert.deepEqual(findPreferenceCliques(event),result)
})
test('mutual groups cannot sacrifice companion coverage in balanced and fairness modes',async()=>{
  const event=fixture();event.clauses=[request('a','b'),request('a','c'),request('b','c'),request('b','a'),request('c','a'),request('c','b'),request('d','a'),request('e','b'),request('f','c')]
  for(const objective of ['balanced','preferences','fairness'] satisfies SeatingEvent['objective'][]){
    event.objective=objective
    const run=await solveWithTrace(event,3);assert.equal(run.result.kind,'plan');if(run.result.kind!=='plan')continue
    const coverage=evaluatePlan(event,run.result.assignments).coverage.met
    assert.equal(coverage,objective==='preferences'?3:4)
    assert.deepEqual(evaluatePlan(event,run.result.assignments,run.result.seatIndices).violations,[])
    const stage=run.stages.find(s=>s.objective==='Keep mutual groups together');assert.ok(stage)
    assert.equal(stage.value,objective==='preferences'?3:0);assert.equal(stage.frozen,true)
    assert.deepEqual(stage.cliqueSearch,{cliques:[[...'abc']],truncated:false})
  }
})
test('mutual groups stay intact when every guest can also get a companion',async()=>{
  const event=fixture();event.clauses=[...group([...'abc']),...group([...'def'])]
  const run=await solveWithTrace(event,3);assert.equal(run.result.kind,'plan');if(run.result.kind!=='plan')return
  for(const members of [[...'abc'],[...'def']])assert.equal(new Set(members.map(id=>run.result.kind==='plan'?run.result.assignments[id]:'')).size,1)
  assert.equal(evaluatePlan(event,run.result.assignments).coverage.met,6)
  assert.equal(run.stages.find(stage=>stage.objective==='Keep mutual groups together')?.value,6)
})
test('mutual groups remain soft when separation or capacity prevents keeping them intact',async()=>{
  const event=fixture();event.clauses=group([...'abc']);event.separations=[['a','b']]
  const run=await solveWithTrace(event,3);assert.equal(run.result.kind,'plan');if(run.result.kind!=='plan')return
  assert.notEqual(run.result.assignments.a,run.result.assignments.b)
  assert.equal(run.stages.find(s=>s.objective==='Keep mutual groups together')?.value,0)
  assert.deepEqual(evaluatePlan(event,run.result.assignments).violations,[])
  event.separations=[];event.clauses=group([...'abcd'])
  const oversized=await solveWithTrace(event,3);assert.equal(oversized.result.kind,'plan')
  assert.equal(oversized.stages.some(s=>s.objective==='Keep mutual groups together'),false)
})
test('debug network exposes mutual group members, placement and a visual hub',()=>{
  const event=fixture();event.clauses=group([...'abc'])
  const rules=constraintNetwork(event),rule=rules.find(r=>r.kind==='clique');assert.ok(rule)
  const assignments={a:'one',b:'one',c:'one',d:'two',e:'two',f:'two'}
  assert.deepEqual(rulePeople(rule,event,assignments),[...'abc'])
  assert.equal(ruleResolution(rule,event,assignments).satisfied,true)
  assert.equal(ruleResolution(rule,event,{...assignments,c:'two'}).satisfied,false)
  assert.ok(networkLayout(event,assignments,rules).hubs.has(rule.id))
})
