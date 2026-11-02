import test from 'node:test'
import assert from 'node:assert/strict'
import { parseReferenceList, resolveReferences } from './preferences'
import { evaluatePlan, eventSchema } from './model'
import { importAttendees, parseCsv } from './files'
import { createDemo } from './demo'

const people = [
  {id:'a',name:'Anna Virtanen',aliases:['Annie'],groups:['Marketing'],text:''},
  {id:'b',name:'Michael Smith',aliases:['Mike'],groups:['Sales'],text:''},
  {id:'c',name:'Anna Jones',aliases:[],groups:['Marketing'],text:''},
]
test('aliases resolve, duplicate first names and unknown acquaintances stay unresolved',()=>{
  const result=resolveReferences(parseReferenceList('Mike, Anna, someone I know'),'c',people)
  assert.equal(result[0].state,'resolved');assert.equal(result[1].state,'unresolved');assert.equal(result[2].state,'unresolved')
})
test('explicit name alternatives resolve while from descriptions remain unused',()=>{
  const result=resolveReferences(parseReferenceList('Annie or Mike, anyone from Marketing; avoid Mike'),'c',people)
  assert.equal(result.length,3)
  assert.deepEqual(result[0].state==='resolved'&&result[0].targets,['a','b'])
  assert.equal(result[1].state,'unresolved')
  assert.equal(result[2].kind,'avoid')
})
test('CSV handles quoted names, commas and multiline preferences',()=>{
  const csv='name,groups,aliases,preferences\r\n"Smith, Mike",Sales|London,Mike,"Annie,\nAnna"'
  const result=importAttendees(csv)
  assert.equal(result[0].name,'Smith, Mike');assert.equal(result[0].text,'Annie,\nAnna');assert.deepEqual(result[0].groups,['Sales','London'])
  assert.throws(()=>parseCsv('name\n"Unclosed'))
})
test('registry boundary rejects invented targets and illegal self preferences',()=>{
  const event=createDemo();event.clauses=[{state:'resolved',id:'bad',personId:'p1',kind:'prefer',reference:'ghost',weight:1,targets:['ghost']}]
  assert.equal(eventSchema.safeParse(event).success,false)
  event.clauses[0]={...event.clauses[0],state:'resolved',targets:['p1']}
  assert.equal(eventSchema.safeParse(event).success,false)
})
test('report validates capacities, locks, separations and scores actual assignments',()=>{
  const event=createDemo();const assignments=Object.fromEntries(event.attendees.map((p,i)=>[p.id,event.tables[Math.floor(i/6)].id]))
  assert.equal(evaluatePlan(event,assignments).violations.length,0)
  event.locks.p1='t2';assert.ok(evaluatePlan(event,assignments).violations.some(s=>s.includes('lock')))
  delete event.locks.p1;event.separations=[['p1','p2']];assert.ok(evaluatePlan(event,assignments).violations.length)
})
test('adding a member requires fresh group resolution rather than invented membership',()=>{
  const group=resolveReferences(parseReferenceList('Marketing'),'b',people)
  assert.equal(group[0].state,'unresolved')
})
