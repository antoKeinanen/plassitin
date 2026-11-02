import test from 'node:test'
import assert from 'node:assert/strict'
import { eventSchema, evaluatePlan, weightedClauses } from './model'
import type { Clause } from './model'
import { placeSeats, scoreSeatCentrality, scoreSeatCoverage, scoreSeatPlan, seatProximity } from './seat-optimizer'
import { rebuildEvent } from './editor'
import { solve } from './solver.server'

function fixture(count=4,capacity=count){
  return eventSchema.parse({version:1,name:'Seat example',attendees:Array.from({length:count},(_,i)=>({id:String.fromCharCode(97+i),name:String.fromCharCode(97+i),groups:[],aliases:[],text:''})),tables:[{id:'one',name:'One',capacity}],clauses:[],locks:{},separations:[],objective:'balanced'})
}
const request=(owner:string,targets:string[],weight=1):Extract<Clause,{state:'resolved'}>=>({id:crypto.randomUUID(),personId:owner,reference:targets.join(' or '),kind:'prefer',state:'resolved',source:'name',targets,weight})
const assignments=(event:ReturnType<typeof fixture>)=>Object.fromEntries(event.attendees.map(p=>[p.id,'one']))

test('long-table geometry ranks opposite, same-side, diagonal and distant seats',()=>{
  assert.equal(seatProximity(0,1),4);assert.equal(seatProximity(0,2),2);assert.equal(seatProximity(0,3),1);assert.equal(seatProximity(0,4),0)
  assert.equal(seatProximity(1,3),2);assert.equal(seatProximity(2,1),1);assert.equal(seatProximity(2,3),4)
})
test('chair placement prefers opposite, then side, then diagonal for competing names',()=>{
  const event=fixture();event.clauses=[request('a',['b'],5),request('b',['c']),request('a',['c'])]
  const tables=assignments(event),result=placeSeats(event,tables,performance.now()+2000),seats=result.seatIndices
  assert.equal(seatProximity(seats.a,seats.b),4);assert.equal(seatProximity(seats.b,seats.c),2);assert.equal(seatProximity(seats.a,seats.c),1)
  assert.deepEqual(evaluatePlan(event,tables,seats).violations,[])
  assert.equal(result.score,scoreSeatPlan(event,tables,seats));assert.equal(result.optimalWithinTables,true)
})
test('chair placement gives every guest a nearby wish before improving stronger pairings',()=>{
  for(const count of [6,10])for(const objective of ['balanced','fairness'] satisfies ReturnType<typeof fixture>['objective'][]){
    const event=fixture(count);event.objective=objective
    const targets=['e','f','b','b','c','a']
    event.clauses=targets.map((target,index)=>request(event.attendees[index].id,[target],index<3?5:1))
    const tables=assignments(event),previous={a:0,b:2,c:3,d:5,e:1,f:4}
    assert.equal(scoreSeatCoverage(event,tables,previous),5)
    const result=placeSeats(event,tables,performance.now()+2000)
    assert.equal(result.coveredGuests,6)
    for(const clause of event.clauses)if(clause.state==='resolved')assert.ok(seatProximity(result.seatIndices[clause.personId],result.seatIndices[clause.targets[0]])>0)
    assert.equal(result.coveredGuests,scoreSeatCoverage(event,tables,result.seatIndices))
    assert.equal(result.score,scoreSeatPlan(event,tables,result.seatIndices))
    assert.equal(result.centralityCost,scoreSeatCentrality(event,tables,result.seatIndices))
    assert.deepEqual(evaluatePlan(event,tables,result.seatIndices).violations,[])
  }
})

test('small-table fairness matches exhaustive proximity-coverage enumeration',()=>{
  const event=fixture(6);event.clauses=[request('a',['e'],5),request('b',['f'],5),request('c',['b'],5),request('d',['b']),request('e',['c']),request('f',['a'])]
  const tables=assignments(event),result=placeSeats(event,tables,performance.now()+2000)
  let bestCoverage=-1,bestScore=-Infinity
  const visit=(order:string[])=>{
    if(order.length===6){
      const seats=Object.fromEntries(order.map((id,index)=>[id,index]))
      const count=event.clauses.filter(clause=>clause.state==='resolved'&&clause.targets.some(target=>seatProximity(seats[clause.personId],seats[target])>0)).length
      const score=scoreSeatPlan(event,tables,seats)
      if(count>bestCoverage||count===bestCoverage&&score>bestScore){bestCoverage=count;bestScore=score}
      return
    }
    for(const person of event.attendees)if(!order.includes(person.id))visit([...order,person.id])
  }
  visit([])
  assert.equal(result.coveredGuests,bestCoverage);assert.equal(result.score,bestScore)
  assert.equal(result.optimalWithinTables,true)
})
test('interleaved shared-tag groups form compact blocks along a long table',()=>{
  const event=fixture(30);event.attendees.forEach((person,index)=>person.groups=[`group ${index%3}`])
  const compiled=rebuildEvent({event,links:{},decisions:{}}),tables=assignments(event)
  const result=placeSeats(compiled,tables,performance.now()+2000)
  assert.equal(result.coveredGuests,30)
  for(let group=0;group<3;group++){
    const seats=event.attendees.filter(p=>p.groups.includes(`group ${group}`)).map(p=>result.seatIndices[p.id]).sort((a,b)=>a-b)
    assert.equal(seats.length,10)
    assert.equal(seats[seats.length-1]-seats[0]+1,10)
  }
  assert.equal(result.score,scoreSeatPlan(compiled,tables,result.seatIndices))
  assert.equal(result.centralityCost,scoreSeatCentrality(compiled,tables,result.seatIndices))
  assert.deepEqual(evaluatePlan(compiled,tables,result.seatIndices).violations,[])
})
test('an explicit name takes the opposite seat ahead of a shared tag',()=>{
  const event=fixture();event.attendees[0].groups=['crew'];event.attendees[2].groups=['crew']
  const compiled=rebuildEvent({event,links:{a:['b']},decisions:{}}),result=placeSeats(compiled,assignments(event),performance.now()+2000)
  assert.equal(seatProximity(result.seatIndices.a,result.seatIndices.b),4)
  assert.equal(seatProximity(result.seatIndices.a,result.seatIndices.c),2)
})
test('the narrower named preference wins the opposite seat when several guests want one person',()=>{
  const event=fixture();event.clauses=[request('a',['b']),request('c',['b']),request('c',['a']),request('c',['d'])]
  const weights=weightedClauses(event),narrow=weights.find(r=>r.clause.personId==='a'),broad=weights.find(r=>r.clause.personId==='c'&&r.clause.targets.includes('b'))
  assert.ok(narrow);assert.ok(broad);assert.ok(narrow.weight>broad.weight)
  const result=placeSeats(event,assignments(event),performance.now()+2000)
  assert.equal(seatProximity(result.seatIndices.a,result.seatIndices.b),4)
  assert.notEqual(seatProximity(result.seatIndices.c,result.seatIndices.b),4)
  const before=weightedClauses(event).map(r=>r.weight)
  event.clauses.push({...event.clauses[0],id:'duplicate'})
  assert.deepEqual(weightedClauses(event).map(r=>r.weight),before)
})
test('seat refinement optimizes compact seating with odd capacities, alternatives and avoidance',()=>{
  const event=fixture(3,5);event.clauses=[request('a',['b','c']),{...request('b',['c']),kind:'avoid'}]
  const tables=assignments(event),result=placeSeats(event,tables,performance.now()+2000)
  assert.deepEqual(evaluatePlan(event,tables,result.seatIndices).violations,[])
  let best=-Infinity
  for(let a=0;a<3;a++)for(let b=0;b<3;b++)for(let c=0;c<3;c++)if(new Set([a,b,c]).size===3)best=Math.max(best,scoreSeatPlan(event,tables,{a,b,c}))
  assert.equal(result.score,best)
})
test('bounded large-table refinement retains a valid incumbent and improves distant named partners',()=>{
  const event=fixture(10,12);event.clauses=[request('a',['f']),request('c',['d'])]
  const tables=assignments(event),expired=placeSeats(event,tables,0),improved=placeSeats(event,tables,performance.now()+2000)
  assert.deepEqual(evaluatePlan(event,tables,expired.seatIndices).violations,[])
  assert.deepEqual(evaluatePlan(event,tables,improved.seatIndices).violations,[])
  assert.ok(improved.score>=expired.score)
  assert.equal(seatProximity(improved.seatIndices.a,improved.seatIndices.f),4)
  assert.equal(improved.score,scoreSeatPlan(event,tables,improved.seatIndices))
})
test('table assignment prioritizes explicit names when companion coverage is equal',async()=>{
  const event=fixture();event.tables=[{id:'one',name:'One',capacity:2},{id:'two',name:'Two',capacity:2}]
  event.attendees=event.attendees.map(p=>({...p,groups:p.id==='a'||p.id==='c'?['crew']:[]}))
  const compiled=rebuildEvent({event,links:{a:['b'],b:['a']},decisions:{}}),result=await solve(compiled,3)
  assert.equal(result.kind,'plan');if(result.kind!=='plan')return
  assert.equal(result.assignments.a,result.assignments.b);assert.notEqual(result.assignments.a,result.assignments.c)
  assert.ok(result.seatIndices);assert.equal(seatProximity(result.seatIndices.a,result.seatIndices.b),4)
})
test('narrow named requests beat broad alternatives when table space is limited',async()=>{
  const event=fixture(3);event.tables=[{id:'one',name:'One',capacity:2},{id:'two',name:'Two',capacity:1}]
  event.clauses=[request('a',['b']),request('c',['a','b'])]
  for(const mode of ['balanced','preferences','fairness'] satisfies typeof event.objective[]){
    event.objective=mode
    const result=await solve(event,3);assert.equal(result.kind,'plan');if(result.kind!=='plan')continue
    assert.equal(result.assignments.a,result.assignments.b)
    assert.notEqual(result.assignments.c,result.assignments.b)
  }
})
test('reversing named request order changes the preferred table companion in every mode',async()=>{
  const event=fixture(3);event.tables=[{id:'one',name:'One',capacity:2},{id:'two',name:'Two',capacity:1}]
  for(const mode of ['balanced','preferences','fairness'] satisfies typeof event.objective[]){
    event.objective=mode
    for(const order of [['b','c'],['c','b']]){
      event.clauses=order.map(id=>request('a',[id]))
      const result=await solve(event,3);assert.equal(result.kind,'plan');if(result.kind!=='plan')continue
      assert.equal(result.assignments.a,result.assignments[order[0]])
      assert.notEqual(result.assignments.a,result.assignments[order[1]])
    }
  }
})
test('the first named request wins the opposite seat ahead of later requests',()=>{
  const event=fixture()
  for(const order of [['b','c','d'],['d','c','b']]){
    event.clauses=order.map(id=>request('a',[id]))
    const weights=weightedClauses(event).map(request=>request.weight)
    assert.deepEqual(weights,[2500,1667,833]);assert.equal(weights.reduce((sum,w)=>sum+w,0),5000)
    const result=placeSeats(event,assignments(event),performance.now()+2000)
    assert.equal(seatProximity(result.seatIndices.a,result.seatIndices[order[0]]),4)
    assert.equal(seatProximity(result.seatIndices.a,result.seatIndices[order[1]]),2)
    assert.equal(seatProximity(result.seatIndices.a,result.seatIndices[order[2]]),1)
  }
})
test('large-table swaps score alternatives and avoidance consistently',()=>{
  const event=fixture(10,12);event.clauses=[request('a',['f']),request('b',['a','e']),{...request('f',['b','e']),kind:'avoid'}]
  const tables=assignments(event),initial=Object.fromEntries(event.attendees.map((p,i)=>[p.id,i]))
  const result=placeSeats(event,tables,performance.now()+2000)
  assert.ok(result.score>=scoreSeatPlan(event,tables,initial))
  assert.equal(result.score,scoreSeatPlan(event,tables,result.seatIndices))
  assert.deepEqual(evaluatePlan(event,tables,result.seatIndices).violations,[])
})
test('plan validation rejects chair collisions and out-of-capacity indices',()=>{
  const event=fixture(),tables=assignments(event)
  assert.ok(evaluatePlan(event,tables,{a:0,b:0,c:2,d:3}).violations.some(v=>v.includes('same seat')))
  assert.ok(evaluatePlan(event,tables,{a:0,b:1,c:2,d:4}).violations.some(v=>v.includes('valid seat')))
})

test('automatic placement leaves unused seats at the end, including under avoidance and time limits',()=>{
  for(const count of [1,3,8,10,11]){
    const event=fixture(count,100),tables=assignments(event)
    event.clauses=event.attendees.flatMap(a=>event.attendees.filter(b=>b.id!==a.id).map(b=>({...request(a.id,[b.id]),kind:'avoid' satisfies 'avoid'})))
    for(const deadline of [0,performance.now()+2000]){
      const result=placeSeats(event,tables,deadline)
      assert.deepEqual(Object.values(result.seatIndices).sort((a,b)=>a-b),Array.from({length:count},(_,i)=>i))
      assert.deepEqual(evaluatePlan(event,tables,result.seatIndices).violations,[])
      assert.equal(result.score,scoreSeatPlan(event,tables,result.seatIndices))
    }
  }
})

test('each partially occupied table gets its own continuous seating block',()=>{
  const event=fixture(7,20);event.tables.push({id:'two',name:'Two',capacity:21})
  const tables:Record<string,string>={...assignments(event),e:'two',f:'two',g:'two'},result=placeSeats(event,tables,performance.now()+2000)
  for(const table of event.tables){
    const occupied=event.attendees.filter(p=>tables[p.id]===table.id).map(p=>result.seatIndices[p.id]).sort((a,b)=>a-b)
    assert.deepEqual(occupied,occupied.map((_,index)=>index))
  }
  assert.deepEqual(evaluatePlan(event,tables,result.seatIndices).violations,[])
})

test('popular companions stay central to their requesters at partially occupied tables',()=>{
  for(const capacity of [8,12]){
    const event=fixture(7,capacity);event.clauses=event.attendees.slice(1).map(p=>request(p.id,['a']))
    const tables=assignments(event),compact={a:2,b:3,c:0,d:4,e:1,f:5,g:6},distant={...compact,g:capacity-2}
    assert.equal(scoreSeatPlan(event,tables,compact),scoreSeatPlan(event,tables,distant))
    if(capacity===12)assert.ok(scoreSeatCentrality(event,tables,compact)<scoreSeatCentrality(event,tables,distant))
    const result=placeSeats(event,tables,performance.now()+2000),seats=result.seatIndices
    assert.equal(result.score,scoreSeatPlan(event,tables,compact))
    assert.equal(result.centralityCost,8*5000)
    assert.equal(result.centralityCost,scoreSeatCentrality(event,tables,seats))
    const row=Math.floor(seats.a/2),otherRows=event.attendees.slice(1).map(p=>Math.floor(seats[p.id]/2))
    assert.ok(row>Math.min(...otherRows)&&row<Math.max(...otherRows))
    assert.deepEqual(evaluatePlan(event,tables,seats).violations,[])
    if(capacity===8)assert.equal(result.optimalWithinTables,true)
  }
})

test('centering uses distinct named requesters and retains narrower-request influence',()=>{
  const event=fixture(4,8),tables=assignments(event),seats={a:2,b:0,c:6,d:7}
  event.clauses=[request('b',['a']),request('c',['a']),request('c',['d'])]
  assert.equal(scoreSeatCentrality(event,tables,seats),5000+3333*4)
  event.clauses.push({...event.clauses[0],id:'duplicate'})
  assert.equal(scoreSeatCentrality(event,tables,seats),5000+3333*4)
  event.clauses=[request('b',['a']),{...request('c',['a']),source:'tag'}]
  assert.equal(scoreSeatCentrality(event,tables,seats),1000*4)
  event.clauses=[request('b',['a']),request('c',['a'])]
  assert.equal(scoreSeatCentrality(event,{...tables,c:'another'},seats),0)
})
