import test from 'node:test'
import assert from 'node:assert/strict'
import { createDemo } from './demo'
import { editorSchema, fillAssignments, rotateTable, tableLayout } from './editor'
import type { EditorDocument } from './editor'
import { moveGuest, nearestSeat, resolveSeatIndices, seatInDirection } from './seat-placement'
import { evaluatePlan } from './model'
import { decodeDocumentFragment, encodeDocumentFragment } from './url-state'
import { networkLayout } from './debug-network'

function fixture():EditorDocument{
  const event=createDemo();event.attendees=event.attendees.slice(0,4);event.clauses=[];event.tables=[{id:'a',name:'A',capacity:4},{id:'b',name:'B',capacity:4}]
  return{version:2,event,assignments:{p1:'a',p2:'a',p3:'b',p4:'b'},links:{},decisions:{}}
}
test('dragging onto an occupied seat swaps people and exact positions',()=>{
  const original=fixture(),moved=moveGuest(original,'p1',{tableId:'a',index:1})
  assert.equal(moved.assignments.p1,'a');assert.equal(moved.assignments.p2,'a')
  assert.equal(moved.seatIndices?.p1,1);assert.equal(moved.seatIndices?.p2,0)
  assert.equal(original.seatIndices,undefined)
  assert.deepEqual(evaluatePlan(moved.event,moved.assignments).violations,[])
})
test('moving into an empty seat preserves its exact index through save and refresh',()=>{
  const moved=moveGuest(fixture(),'p1',{tableId:'b',index:3})
  const restored=editorSchema.parse(JSON.parse(JSON.stringify(moved)))
  const refreshedAssignments=fillAssignments(restored.event,restored.assignments)
  assert.equal(refreshedAssignments.p1,'b');assert.equal(resolveSeatIndices(restored.event,refreshedAssignments,restored.seatIndices).p1,3)
  assert.equal(restored.assignments.p2,'a')
})
test('cross-table swaps keep every guest seated even when both tables are full',()=>{
  const document=fixture();document.event.tables=document.event.tables.map(t=>({...t,capacity:2}))
  const moved=moveGuest(document,'p1',{tableId:'b',index:0})
  assert.equal(moved.assignments.p1,'b');assert.equal(moved.assignments.p3,'a')
  assert.equal(moved.seatIndices?.p1,0);assert.equal(moved.seatIndices?.p3,0)
  assert.deepEqual(evaluatePlan(moved.event,moved.assignments).violations,[])
})
test('locked placements and mandatory separations reject illegal moves',()=>{
  const document=fixture();document.event.locks.p1='a'
  assert.throws(()=>moveGuest(document,'p1',{tableId:'b',index:2}),/Unlock/)
  assert.doesNotThrow(()=>moveGuest(document,'p1',{tableId:'a',index:1}))
  document.event.locks={p3:'b'}
  assert.throws(()=>moveGuest(document,'p1',{tableId:'b',index:0}),/Unlock/)
  document.event.locks={};document.event.separations=[['p1','p4']]
  assert.throws(()=>moveGuest(document,'p1',{tableId:'b',index:2}),/mandatory separation/)
})
test('seat count changes reconcile invalid saved positions without collisions',()=>{
  const document=fixture();document.event.tables[0].capacity=2
  const indices=resolveSeatIndices(document.event,document.assignments,{p1:99,p2:99,p3:1,p4:1})
  assert.equal(indices.p1,0);assert.equal(indices.p2,1)
  assert.equal(indices.p3,1);assert.equal(indices.p4,0)
  assert.throws(()=>moveGuest(document,'p1',{tableId:'a',index:2}),/inside a table/)
})
test('snapping picks the nearest square, including at table gaps, and rejects far-away drops',()=>{
  const layout=tableLayout(fixture().event.tables),table=layout[1],seat=table.seats[3]
  assert.deepEqual(nearestSeat(layout,{x:table.x+seat.x+35,y:table.y+seat.y+37}),{tableId:'b',index:3})
  assert.equal(nearestSeat(layout,{x:-100,y:-100}),null)
})

test('table rotation preserves placements and survives saved seating links',()=>{
  const document=fixture();document.seatIndices={p1:3,p2:0,p3:2,p4:1}
  const rotated=rotateTable(document,'a'),saved=decodeDocumentFragment(encodeDocumentFragment(rotated));assert.ok(saved)
  assert.equal(saved.event.tables[0].rotation,90)
  assert.equal(saved.event.tables[1].rotation,undefined)
  assert.deepEqual(saved.assignments,document.assignments);assert.deepEqual(saved.seatIndices,document.seatIndices)
  assert.deepEqual(rotateTable(saved,'a'),document)
})

test('mixed table orientations stay apart and every rotated seat snaps to its original index',()=>{
  const document=fixture();document.event.tables[0].capacity=9;document.event.tables[1].capacity=7
  const vertical=tableLayout(document.event.tables),rotated=tableLayout(rotateTable(document,'a').event.tables)
  assert.equal(rotated[0].width,vertical[0].height);assert.equal(rotated[0].height,vertical[0].width)
  assert.ok(rotated[1].x>=rotated[0].x+rotated[0].width+72)
  for(const table of rotated)for(const [index,seat] of table.seats.entries()){
    assert.ok(seat.x>=0&&seat.y>=0&&seat.x+seat.size<=table.width&&seat.y+seat.size<=table.height)
    assert.deepEqual(nearestSeat(rotated,{x:table.x+seat.x+seat.size/2,y:table.y+seat.y+seat.size/2}),{tableId:table.id,index})
  }
})

test('keyboard seat moves follow screen directions after rotation without wrapping rows',()=>{
  const document=fixture();document.event.tables[0].capacity=7
  const vertical=tableLayout(document.event.tables)[0],horizontal=tableLayout(rotateTable(document,'a').event.tables)[0]
  assert.equal(seatInDirection(vertical,0,'ArrowDown'),2);assert.equal(seatInDirection(vertical,0,'ArrowRight'),1)
  assert.equal(seatInDirection(horizontal,0,'ArrowLeft'),2);assert.equal(seatInDirection(horizontal,0,'ArrowDown'),1)
  assert.equal(seatInDirection(horizontal,0,'ArrowRight'),null);assert.equal(seatInDirection(horizontal,1,'ArrowUp'),0)
  assert.equal(seatInDirection(horizontal,6,'ArrowDown'),null);assert.equal(seatInDirection(horizontal,6,'ArrowLeft'),null)
})

test('consecutive horizontal tables form parallel rows with room for their labels',()=>{
  const document=fixture();document.event.tables[0].capacity=20;document.event.tables[1].capacity=11
  const rotated=rotateTable(rotateTable(document,'a'),'b'),layout=tableLayout(rotated.event.tables)
  assert.equal(layout[0].x,layout[1].x)
  assert.ok(layout[1].y>=layout[0].y+layout[0].height+72)
  for(const table of layout)for(const [index,seat] of table.seats.entries())assert.deepEqual(nearestSeat(layout,{x:table.x+seat.x+36,y:table.y+seat.y+36}),{tableId:table.id,index})
})

test('debug replay uses horizontal table geometry while keeping each guest inside the table',()=>{
  const document=fixture();document.event.tables[0].capacity=8;document.assignments={p1:'a',p2:'a',p3:'a',p4:'b'};document.seatIndices={p1:0,p2:1,p3:6,p4:0}
  const rotated=rotateTable(document,'a'),layout=networkLayout(rotated.event,rotated.assignments,[],rotated.seatIndices),table=layout.tables[0]
  assert.ok(table.width>table.height)
  for(const person of table.members){const point=layout.people.get(person.id);assert.ok(point);assert.ok(point.x>=table.x&&point.y>=table.y&&point.x+160<=table.x+table.width&&point.y+44<=table.y+table.height)}
  assert.ok(layout.tables[1].x>table.x+table.width)
})
