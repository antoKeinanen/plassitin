import test from 'node:test'
import assert from 'node:assert/strict'
import { solve } from './solver.server'
import { evaluatePlan, eventSchema, isTagPreference, resolvedClauses } from './model'
import type { Clause, SeatingEvent } from './model'
import { rebuildEvent } from './editor'

const clause=(personId:string,targets:string[],kind:'prefer'|'avoid'='prefer',weight=1):Clause=>({id:crypto.randomUUID(),personId,targets,kind,weight,state:'resolved',reference:targets.join(' or ')})
function fixture():SeatingEvent{
  return eventSchema.parse({version:1,name:'Small event',attendees:[...'abcdef'].map(id=>({id,name:id,aliases:[],groups:[],text:''})),tables:[{id:'one',name:'One',capacity:3},{id:'two',name:'Two',capacity:3}],locks:{},separations:[],objective:'balanced',clauses:[]})
}
// Independent observed objective, using exact fractions on fixtures whose budgets divide evenly.
function score(event:SeatingEvent,assignments:Record<string,string>):number[]{
  const clauses=resolvedClauses(event),hit=(c:Extract<Clause,{state:'resolved'}>)=>c.targets.some(t=>assignments[t]===assignments[c.personId])
  const weight=(clause:Extract<Clause,{state:'resolved'}>)=>{
    const choices=[...new Set(clauses.filter(c=>c.personId===clause.personId&&c.kind==='prefer'&&!isTagPreference(c)).flatMap(c=>c.targets))],count=choices.length||1
    const rank=clause.kind==='prefer'&&clause.targets.length===1?choices.indexOf(clause.targets[0]):-1
    const budget=rank>=0?2*(count-rank)/(count*(count+1)):1/count
    return Math.max(1,Math.round(clause.weight*1000*(isTagPreference(clause)?1:5*(clause.kind==='prefer'?budget:1))))
  }
  const loads=event.tables.map(t=>Object.values(assignments).filter(id=>id===t.id).length)
  const packing=[-loads.filter(load=>load>0).length,loads.filter((load,i)=>load===event.tables[i].capacity).length]
  if(event.objective==='preferences')return[...packing,clauses.reduce((sum,c)=>sum+weight(c)*Number(hit(c))*(c.kind==='prefer'?1:-1),0)]
  const named=clauses.filter(c=>c.kind==='prefer'&&!isTagPreference(c)).reduce((sum,c)=>sum+weight(c)*Number(hit(c)),0)
  let penalty=0,coverage=0,total=0;const fractions:number[]=[]
  for(const person of event.attendees){
    const likes=clauses.filter(c=>c.personId===person.id&&c.kind==='prefer'),avoids=clauses.filter(c=>c.personId===person.id&&c.kind==='avoid')
    if(likes.length){const value=1000*likes.reduce((s,c)=>s+weight(c)*Number(hit(c)),0)/likes.reduce((s,c)=>s+weight(c),0);fractions.push(value);total+=value;coverage+=Number(likes.some(hit))}
    if(avoids.length)penalty+=1000*avoids.reduce((s,c)=>s+c.weight*Number(hit(c)),0)/avoids.reduce((s,c)=>s+c.weight,0)
  }
  return [...packing,...(event.objective==='fairness'&&fractions.length?[-penalty,coverage,Math.min(...fractions),named,total]:[-penalty,coverage,named,total])]
}
const compare=(a:number[],b:number[])=>{for(let i=0;i<a.length;i++){if(a[i]!==b[i])return a[i]-b[i]}return 0}

test('all objective modes agree with exhaustive tiny seating enumeration',async()=>{
  const event=fixture();event.clauses=[clause('a',['b','c']),clause('b',['e']),clause('c',['d']),clause('d',['a'],'avoid'),clause('e',['f']),clause('a',['f'],'prefer',3)];event.locks={a:'one'};event.separations=[['e','c']]
  event.tables=[{id:'one',name:'One',capacity:4},{id:'two',name:'Two',capacity:3},{id:'three',name:'Three',capacity:2}]
  for(const mode of ['balanced','preferences','fairness'] satisfies SeatingEvent['objective'][]){
    event.objective=mode;const result=await solve(event,3);assert.equal(result.kind,'plan');if(result.kind!=='plan')continue
    assert.equal(result.status,'optimal');assert.deepEqual(evaluatePlan(event,result.assignments).violations,[])
    let best:number[]|null=null
    for(let combination=0;combination<event.tables.length**event.attendees.length;combination++){
      const assignments=Object.fromEntries(event.attendees.map((p,i)=>[p.id,event.tables[Math.floor(combination/event.tables.length**i)%event.tables.length].id]))
      if(evaluatePlan(event,assignments).violations.length)continue
      const current=score(event,assignments);if(!best||compare(current,best)>0)best=current
    }
    assert.deepEqual(score(event,result.assignments),best)
  }
})
test('group ANY reward and duplicate requests remain capped',async()=>{
  const event=fixture();event.clauses=[clause('a',['b','c','d']),clause('b',['e']),clause('c',['f'])]
  const original=await solve(event,3);event.clauses.push(...event.clauses.map(c=>({...c,id:crypto.randomUUID()})));const duplicated=await solve(event,3)
  assert.equal(original.kind,'plan');assert.equal(duplicated.kind,'plan')
  if(original.kind==='plan'&&duplicated.kind==='plan')assert.deepEqual(score(event,original.assignments),score(event,duplicated.assignments))
})
test('mandatory conflicts and insufficient capacity return infeasible',async()=>{
  const event=fixture();event.locks={a:'one',b:'one'};event.separations=[['a','b']]
  assert.equal((await solve(event,3)).kind,'infeasible')
  event.tables[0].capacity=2;assert.equal((await solve(event,3)).kind,'infeasible')
})
test('events with no preferences still produce valid seats',async()=>{
  const event=fixture(),result=await solve(event,3);assert.equal(result.kind,'plan')
  if(result.kind==='plan')assert.deepEqual(evaluatePlan(event,result.assignments).violations,[])
})
test('packing uses fewer tables before optimizing soft preferences in every mode',async()=>{
  const event=fixture()
  event.tables=[{id:'one',name:'One',capacity:4},{id:'two',name:'Two',capacity:4},{id:'three',name:'Three',capacity:4}]
  event.clauses=[clause('a',['b']),clause('c',['d']),clause('e',['f']),clause('a',['c','e'],'avoid'),clause('c',['e'],'avoid')]
  for(const mode of ['balanced','preferences','fairness'] satisfies SeatingEvent['objective'][]){
    event.objective=mode
    const result=await solve(event,3);assert.equal(result.kind,'plan');if(result.kind!=='plan')continue
    assert.equal(result.status,'optimal')
    const counts=event.tables.map(t=>Object.values(result.assignments).filter(id=>id===t.id).length).sort((a,b)=>b-a)
    assert.deepEqual(counts,[4,2,0])
    assert.deepEqual(evaluatePlan(event,result.assignments).violations,[])
  }
})
test('packing fills unequal tables and opens extra tables when hard rules require them',async()=>{
  const event=fixture()
  event.attendees=event.attendees.slice(0,5)
  event.tables=[{id:'one',name:'One',capacity:4},{id:'two',name:'Two',capacity:3},{id:'three',name:'Three',capacity:2}]
  const packed=await solve(event,3);assert.equal(packed.kind,'plan')
  if(packed.kind==='plan'){
    const loads=event.tables.map(t=>Object.values(packed.assignments).filter(id=>id===t.id).length)
    assert.equal(loads.filter(n=>n>0).length,2)
    assert.equal(loads.filter((n,i)=>n===event.tables[i].capacity).length,2)
  }
  event.separations=[['a','b'],['b','c'],['a','c']];event.locks={a:'three'}
  const separated=await solve(event,3);assert.equal(separated.kind,'plan')
  if(separated.kind==='plan'){
    assert.equal(new Set(Object.values(separated.assignments)).size,3)
    assert.equal(separated.assignments.a,'three')
    assert.deepEqual(evaluatePlan(event,separated.assignments).violations,[])
  }
})
test('matching tags keep their members together when tables have room',async()=>{
  const event=fixture()
  event.tables.push({id:'three',name:'Three',capacity:3})
  event.attendees=event.attendees.map((person,index)=>({...person,groups:[index<3?'crew':'friends']}))
  const compiled=rebuildEvent({event,links:{},decisions:{}})
  const result=await solve(compiled,3);assert.equal(result.kind,'plan')
  if(result.kind==='plan'){
    const assignments=result.assignments
    for(const group of ['crew','friends']){
      const members=event.attendees.filter(person=>person.groups.includes(group))
      const tables=members.map(person=>assignments[person.id])
      assert.equal(new Set(tables).size,1)
    }
    assert.notEqual(result.assignments.a,result.assignments.d)
    assert.deepEqual(evaluatePlan(compiled,result.assignments).violations,[])
  }
})
test('unresolved requests are blocked and zero deadline is a timeout',async()=>{
  const event=fixture();event.clauses=[{state:'unresolved',id:'unknown',personId:'a',kind:'prefer',reference:'someone I know',weight:1}]
  await assert.rejects(()=>solve(event,3),/Resolve or ignore/)
  event.clauses=[];assert.equal((await solve(event,0)).kind,'timeout')
})
