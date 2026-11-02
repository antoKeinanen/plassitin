import test from 'node:test'
import assert from 'node:assert/strict'
import { eventSchema, evaluatePlan } from './model'
import type { Clause } from './model'
import { rebuildEvent } from './editor'
import { seatBlockCost, seatPreferenceBlocks, scoreSeatBlocks } from './seat-blocks'
import { placeSeats, scoreSeatCoverage, scoreSeatPlan } from './seat-optimizer'

function fixture(count:number){
  return eventSchema.parse({version:1,name:'Block example',attendees:Array.from({length:count},(_,i)=>({id:`p${i}`,name:`Guest ${i}`,aliases:[],groups:[],text:''})),tables:[{id:'one',name:'One',capacity:count}],clauses:[],locks:{},separations:[],objective:'balanced'})
}
const request=(owner:string,target:string):Extract<Clause,{state:'resolved'}>=>({id:`${owner}:${target}`,personId:owner,state:'resolved',kind:'prefer',reference:`Guest ${target.slice(1)}`,targets:[target],source:'name',weight:1})

test('a rectangular block beats a column of the same people, including odd group sizes',()=>{
  const group={members:[0,1,2,3],weight:1000}
  assert.equal(seatBlockCost(group,person=>person),0)
  assert.ok(seatBlockCost(group,person=>person*2)>0)
  assert.equal(seatBlockCost({...group,members:[0,1,2]},person=>person),0)
  assert.ok(seatBlockCost({...group,members:[0,1,2]},person=>person*2)>0)
})

test('blocks come from real tags, mutual cliques and incoming named requests',()=>{
  const event=fixture(8)
  event.attendees.slice(0,3).forEach(p=>p.groups=['Crew'])
  event.clauses=[request('p0','p1'),request('p1','p0'),request('p1','p2'),request('p2','p1'),request('p0','p2'),request('p2','p0'),request('p4','p3'),request('p5','p3'),request('p7','p6')]
  const groups=seatPreferenceBlocks(event)
  assert.equal(groups.filter(g=>g.members.join(',')==='p0,p1,p2').length,1)
  assert.deepEqual(groups.find(g=>g.members.includes('p3'))?.members,['p3','p4','p5'])
  assert.equal(groups.some(g=>g.members.includes('p6')||g.members.includes('p7')),false)
  event.clauses.push({...request('p4','p3'),id:'duplicate'})
  assert.deepEqual(seatPreferenceBlocks(event),groups)
})

test('all seating modes prefer blocks across both sides over columns despite strong cross-group pairings',()=>{
  for(const count of [8,12])for(const objective of ['balanced','fairness','preferences'] satisfies ReturnType<typeof fixture>['objective'][]){
    const event=fixture(count),half=count/2,links:Record<string,string[]>={}
    event.objective=objective
    event.attendees.forEach((person,index)=>{person.groups=[index<half?'first':'second'];links[person.id]=[`p${(index+half)%count}`]})
    const compiled=rebuildEvent({event,links,decisions:{}}),tables=Object.fromEntries(event.attendees.map(p=>[p.id,'one']))
    const columnSeats=Object.fromEntries(event.attendees.map((p,index)=>[p.id,index<half?index*2:(index-half)*2+1]))
    assert.ok(scoreSeatBlocks(compiled,tables,columnSeats)>0)
    const result=placeSeats(compiled,tables,performance.now()+3000)
    assert.equal(result.coveredGuests,count)
    assert.equal(result.blockCost,0)
    assert.equal(result.blockCost,scoreSeatBlocks(compiled,tables,result.seatIndices))
    assert.equal(result.coveredGuests,scoreSeatCoverage(compiled,tables,result.seatIndices))
    for(const group of ['first','second']){
      const seats=event.attendees.filter(p=>p.groups.includes(group)).map(p=>result.seatIndices[p.id])
      const rows=seats.map(seat=>Math.floor(seat/2))
      assert.equal(Math.max(...rows)-Math.min(...rows)+1,Math.ceil(half/2))
      assert.equal(new Set(seats.map(seat=>seat%2)).size,2)
    }
    assert.deepEqual(evaluatePlan(compiled,tables,result.seatIndices).violations,[])
    assert.equal(result.score,scoreSeatPlan(compiled,tables,result.seatIndices))
  }
})

test('block grouping never discards achievable nearby-companion coverage',()=>{
  const event=fixture(8)
  event.attendees.slice(0,4).forEach(p=>p.groups=['friends'])
  event.clauses=[request('p4','p0'),request('p5','p1'),request('p6','p2'),request('p7','p3')]
  const compiled=rebuildEvent({event,links:{},decisions:{}}),tables=Object.fromEntries(event.attendees.map(p=>[p.id,'one']))
  const result=placeSeats(compiled,tables,performance.now()+3000)
  assert.equal(result.coveredGuests,8)
  assert.equal(scoreSeatCoverage(compiled,tables,result.seatIndices),8)
  assert.equal(scoreSeatBlocks(compiled,tables,result.seatIndices),result.blockCost)
})
