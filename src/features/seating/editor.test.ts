import test from 'node:test'
import assert from 'node:assert/strict'
import { createDemo } from './demo'
import { applyDecision, createEmptyDocument, editorSchema, fillAssignments, fitCamera, rebuildEvent, referenceKey, resizeTables, updatePerson, zoomCamera } from './editor'
import type { EditorDocument } from './editor'
import { evaluatePlan, resolvedClauses, weightedClauses } from './model'
import { decodeDocumentFragment, encodeDocumentFragment } from './url-state'

function fixture():EditorDocument{
  const event=createDemo();event.clauses=[];event.attendees=event.attendees.map(p=>({...p,text:'',groups:[]}))
  return {version:2,event,links:{},decisions:{},assignments:fillAssignments(event)}
}
test('a cleared workspace stays empty through persistence and can accept a new attendee',()=>{
  const blank=createEmptyDocument(),saved=decodeDocumentFragment(encodeDocumentFragment(blank));assert.ok(saved)
  assert.deepEqual(saved,blank)
  assert.deepEqual(editorSchema.parse(JSON.parse(JSON.stringify(saved))),blank)
  assert.equal(saved.event.attendees.length,0);assert.equal(saved.event.clauses.length,0)
  assert.deepEqual(saved.event.tables.map(table=>table.capacity),[16,16,16])
  const event={...saved.event,attendees:[{id:'new',name:'New attendee',aliases:[],groups:[],text:''}]},assignments=fillAssignments(event)
  assert.deepEqual(evaluatePlan(event,assignments).violations,[])
  assert.deepEqual(rebuildEvent({...saved,event}).clauses,[])
})
test('message edits and arrangement compilation leave unused text unconstrained',()=>{
  const document=fixture()
  const person={...document.event.attendees[0],text:'Peter Laine, anyone from Helsinki, and unknown friends'}
  const edited=updatePerson(document,person)
  assert.equal(edited.event.attendees[0].text,person.text)
  assert.deepEqual(edited.event.clauses,[])
  assert.deepEqual(rebuildEvent(edited).clauses,[])
  edited.links.p1=['p3']
  const changed=updatePerson(edited,{...person,text:'Ignore this unused message mentioning Peter Laine'})
  const compiled=rebuildEvent(changed)
  assert.equal(compiled.clauses.length,1)
  assert.deepEqual(compiled.clauses[0].state==='resolved'&&compiled.clauses[0].targets,['p3'])
  assert.equal(compiled.attendees[0].text,'Ignore this unused message mentioning Peter Laine')
})
test('shared tags prefer every other member of the same tag',()=>{
  const document=fixture();document.event.attendees[0].groups=['club'];document.event.attendees[1].groups=['Club'];document.event.attendees[2].groups=['club']
  const event=rebuildEvent(document)
  assert.equal(event.clauses.length,3)
  const requests=resolvedClauses(event).filter(c=>c.personId==='p1')
  assert.deepEqual(requests.map(c=>c.state==='resolved'&&c.targets),[['p2'],['p3']])
})
test('large shared tags stay compact in saved state while preferring every member',()=>{
  const document=fixture(),sample=document.event.attendees[0]
  document.event.attendees=Array.from({length:60},(_,index)=>({...sample,id:`guest${index}`,groups:['shared']}))
  document.event.tables=[{id:'one',name:'One',capacity:60}];document.assignments=fillAssignments(document.event)
  const event=rebuildEvent(document)
  const saved=editorSchema.parse({...document,event})
  assert.equal(saved.event.clauses.length,60)
  assert.equal(resolvedClauses(saved.event).length,60*59)
})
test('name chips use stable attendee identity and survive renaming',()=>{
  const document=fixture();document.links.p1=['p2'];const renamed=updatePerson(document,{...document.event.attendees[1],name:'Renamed guest'})
  assert.equal(renamed.event.clauses[0].reference,'Renamed guest');assert.deepEqual(renamed.event.clauses[0].state==='resolved'&&renamed.event.clauses[0].targets,['p2'])
})
test('saved name chip order determines priorities before legacy mapped names',()=>{
  const document=fixture();document.links.p1=['p3','p2']
  document.event.clauses=[{id:'legacy',personId:'p1',kind:'prefer',weight:1,reference:document.event.attendees.find(p=>p.id==='p4')?.name||'Michael Smith',state:'resolved',targets:['p4']}]
  document.event=rebuildEvent(document)
  const restored=decodeDocumentFragment(encodeDocumentFragment(document));assert.ok(restored)
  const requests=weightedClauses(rebuildEvent(restored)).filter(r=>r.clause.personId==='p1')
  assert.deepEqual(requests.map(r=>r.clause.targets),[['p3'],['p2'],['p4']])
  assert.deepEqual(requests.map(r=>r.weight),[2500,1667,833])
})
test('a manual reference decision is reapplied after fresh interpretation',()=>{
  const document=fixture();const clause={id:'unclear',personId:'p1',kind:'prefer',weight:1,reference:'the old gang',state:'unresolved'} satisfies import('./model').Clause
  const decision={kind:'person',personId:'p2'} satisfies import('./editor').Decision
  document.decisions[referenceKey(clause)]=decision;document.event.clauses=[clause]
  const updated=rebuildEvent(document);assert.deepEqual(updated.clauses[0].state==='resolved'&&updated.clauses[0].targets,['p2'])
  assert.equal(applyDecision(clause,document.event.attendees,{kind:'ignore'}).state,'ignored')
})
test('table resizing reseats everyone when remaining capacity is sufficient',()=>{
  const document=fixture();document.event.tables=document.event.tables.map(t=>({...t,capacity:12}));document.assignments=fillAssignments(document.event)
  const resized=resizeTables(document,2)
  assert.equal(resized.event.tables.length,2);assert.deepEqual(evaluatePlan(resized.event,resized.assignments).violations,[])
})
test('initial placement respects valid locks and mandatory separation',()=>{
  const document=fixture();document.event.locks.p1='t2';document.event.separations=[['p1','p2']]
  const assignments=fillAssignments(document.event)
  assert.equal(assignments.p1,'t2');assert.notEqual(assignments.p2,'t2');assert.deepEqual(evaluatePlan(document.event,assignments).violations,[])
})
test('initial placement fills tables in order before opening another',()=>{
  const document=fixture()
  document.event.attendees=document.event.attendees.slice(0,6)
  document.event.tables=[{id:'one',name:'One',capacity:4},{id:'two',name:'Two',capacity:3},{id:'three',name:'Three',capacity:2}]
  const assignments=fillAssignments(document.event)
  assert.deepEqual(document.event.tables.map(t=>Object.values(assignments).filter(id=>id===t.id).length),[4,2,0])
})
test('zoom preserves the world position under the pointer and fit stays bounded',()=>{
  const camera={x:40,y:-12,scale:.5},point={x:200,y:100},next=zoomCamera(camera,1.5,point)
  assert.equal((point.x-camera.x)/camera.scale,(point.x-next.x)/next.scale)
  assert.equal((point.y-camera.y)/camera.scale,(point.y-next.y)/next.scale)
  const fit=fitCamera({width:700,height:800},{width:1000,height:1500})
  assert.ok(fit.scale>0&&fit.scale<=1);assert.ok(fit.x>=0&&fit.y>=0)
  const large=fitCamera({width:390,height:340},{width:20520,height:2600})
  assert.ok(20520*large.scale<=390);assert.ok(2600*large.scale<=340)
})
test('old from constraints migrate into ordinary shared tags',()=>{
  const document=fixture();document.event.attendees[1].groups=['Helsinki']
  document.event.clauses=[{id:'old-from',personId:'p1',kind:'prefer',weight:1,reference:'anyone from Helsinki',state:'resolved',targets:['p2']}]
  const migrated=editorSchema.parse({...document,manualReferences:{p1:['anyone from Helsinki'],p3:['anyone from London']}})
  assert.deepEqual(migrated.event.attendees[0].groups,['Helsinki'])
  assert.deepEqual(migrated.event.attendees[2].groups,['London'])
  assert.equal('manualReferences' in migrated,false)
  assert.equal(migrated.event.clauses.length,0)
  const event=rebuildEvent(migrated)
  assert.deepEqual(event.clauses.filter(c=>c.personId==='p1').map(c=>c.state==='resolved'&&c.targets),[['p2']])
  assert.deepEqual(event.clauses.filter(c=>c.personId==='p2').map(c=>c.state==='resolved'&&c.targets),[['p1']])
  const removed=rebuildEvent({...migrated,event:{...event,attendees:event.attendees.map(p=>p.id==='p1'?{...p,groups:[]}:p)}})
  assert.deepEqual(removed.clauses,[])
  assert.deepEqual(editorSchema.parse(JSON.parse(JSON.stringify(migrated))),migrated)
})
