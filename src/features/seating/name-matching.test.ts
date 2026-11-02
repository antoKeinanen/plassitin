import test from 'node:test'
import assert from 'node:assert/strict'
import { createNameMatcher } from './name-matching'
import { applyDecision, createEmptyDocument, editorSchema, inferMessageNames, isInferredNameClause, rebuildEvent, referenceKey, updatePerson } from './editor'
import { decodeDocumentFragment, encodeDocumentFragment } from './url-state'
import type { Attendee } from './model'

function registry():Attendee[]{
  return [
    {id:'writer',name:'Writer Example'},
    {id:'anna1',name:'Anna Smith'},
    {id:'anna2',name:'Anna Jones'},
    {id:'mike',name:'Michael Brown'},
    {id:'emilie',name:'Émilie Virtanen'},
  ].map(person=>({...person,aliases:[],groups:[],text:''}))
}
function fixture(text:string){
  const document=createEmptyDocument();document.event.attendees=registry();document.event.attendees[0].text=text
  return document
}
test('matches names from the registry in prose with full names taking precedence',()=>{
  const match=createNameMatcher(registry())
  assert.deepEqual(match('I would love ANNA SMITH, then Brown, and Émilie.','writer'),[
    {state:'resolved',reference:'ANNA SMITH',preference:'prefer',personId:'anna1'},
    {state:'resolved',reference:'Brown',preference:'prefer',personId:'mike'},
    {state:'resolved',reference:'Émilie',preference:'prefer',personId:'emilie'},
  ])
  assert.deepEqual(match('Joanna, browning, the marketing team, or unknown friends.','writer'),[])
})
test('flags shared first names and duplicate full names instead of guessing',()=>{
  const attendees=registry();attendees.push({...attendees[1],id:'duplicate'})
  const mentions=createNameMatcher(attendees)('Anna, Anna Smith, Jones','writer')
  assert.deepEqual(mentions,[
    {state:'ambiguous',reference:'Anna',preference:'prefer',candidates:['anna1','anna2','duplicate']},
    {state:'ambiguous',reference:'Anna Smith',preference:'prefer',candidates:['anna1','duplicate']},
    {state:'resolved',reference:'Jones',preference:'prefer',personId:'anna2'},
  ])
})
test('ignores self mentions and hidden aliases and preserves explicit avoidance',()=>{
  const attendees=registry();attendees[3].aliases=['Mike']
  const match=createNameMatcher(attendees)
  assert.deepEqual(match('Writer Example, Mike, or Helsinki','writer'),[])
  assert.deepEqual(match('Preferably not Anna Smith, Michael Brown','writer').map(m=>[m.state,m.preference]),[['resolved','avoid'],['resolved','avoid']])
  assert.deepEqual(match('not Michael Brown','writer').map(m=>m.preference),['avoid'])
})
test('name inference is explicit, additive, ordered and safe to repeat',()=>{
  const document=fixture('Brown, Anna Smith, Émilie. Unknown text remains unused.')
  document.links.writer=['anna2'];document.event.attendees[0].groups=['crew'];document.event.attendees[3].groups=['crew']
  const untouched=rebuildEvent(document)
  assert.equal(untouched.clauses.some(isInferredNameClause),false)
  const inferred=inferMessageNames({...document,event:untouched})
  assert.deepEqual(inferred.links,document.links)
  assert.deepEqual(inferred.event.attendees,document.event.attendees)
  assert.deepEqual(inferred.event.clauses.filter(isInferredNameClause).map(c=>c.state==='resolved'?c.targets:[]),[['mike'],['anna1'],['emilie']])
  assert.deepEqual(inferMessageNames(inferred),inferred)
  const restored=decodeDocumentFragment(encodeDocumentFragment(inferred));assert.ok(restored)
  assert.deepEqual(restored,inferred)
  assert.deepEqual(editorSchema.parse(restored),inferred)
})
test('ambiguous references persist for review and a manual choice resolves them',()=>{
  const inferred=inferMessageNames(fixture('Anna and Brown'))
  const ambiguous=inferred.event.clauses.find(c=>c.state==='unresolved');assert.ok(ambiguous)
  assert.equal(ambiguous.reference,'Anna')
  const next={...inferred,decisions:{[referenceKey(ambiguous)]:{kind:'person',personId:'anna2'} satisfies import('./editor').Decision}}
  next.event=rebuildEvent(next)
  assert.deepEqual(next.event.clauses.filter(isInferredNameClause).map(c=>c.state==='resolved'?c.targets:[]),[['anna2'],['mike']])
  assert.deepEqual(inferMessageNames(next),next)
})
test('editing messages does not infer new names or change existing inferred identities',()=>{
  const inferred=inferMessageNames(fixture('Michael Brown'))
  const changed=updatePerson(inferred,{...inferred.event.attendees[0],text:'Anna Jones instead'})
  assert.deepEqual(changed.event.clauses.filter(isInferredNameClause).flatMap(c=>c.state==='resolved'?c.targets:[]),['mike'])
  const renamed=updatePerson(changed,{...changed.event.attendees[3],name:'Renamed Person'})
  assert.deepEqual(renamed.event.clauses.filter(isInferredNameClause).flatMap(c=>c.state==='resolved'?c.targets:[]),['mike'])
  assert.equal(applyDecision(inferred.event.clauses[0],inferred.event.attendees,{kind:'ignore'}).state,'ignored')
  const ignored={...inferred,decisions:{[referenceKey(inferred.event.clauses[0])]:{kind:'ignore'} satisfies import('./editor').Decision}}
  ignored.event=rebuildEvent(ignored)
  assert.deepEqual(inferMessageNames(ignored),ignored)
})
