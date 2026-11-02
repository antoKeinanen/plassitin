import test from 'node:test'
import assert from 'node:assert/strict'
import { deflateSync } from 'fflate'
import { createDemo } from './demo'
import { editorSchema, fillAssignments } from './editor'
import type { EditorDocument } from './editor'
import { decodeDocumentFragment, encodeDocumentFragment } from './url-state'

function fixture():EditorDocument{
  const event=createDemo()
  event.attendees[0]={...event.attendees[0],name:'Äänestäjä 李 🎉',text:'Please sit with Mike,\n"anyone from Helsinki"',aliases:['Åke'],groups:['Helsinki']}
  event.clauses=[
    {id:'custom',personId:'p1',kind:'prefer',reference:'my old friends',weight:5,state:'resolved',targets:['p2','p3']},
    {id:'ignored',personId:'p2',kind:'avoid',reference:'do not reinterpret me',weight:2,state:'ignored'},
    {id:'unknown',personId:'p3',kind:'prefer',reference:'unresolved nickname',weight:1,state:'unresolved'},
  ]
  event.locks={p1:event.tables[0].id};event.separations=[['p1','p2']];event.objective='fairness'
  return {version:2,event,assignments:fillAssignments(event),seatIndices:{p1:3,p3:8},links:{p1:['p3']},decisions:{
    a:{kind:'ignore'},b:{kind:'person',personId:'p3'},c:{kind:'code',code:'Helsinki'},d:{kind:'reference',reference:'Mike'},
  }}
}
function encodedBytes(bytes:Uint8Array){return '#1.'+Buffer.from(deflateSync(bytes,{level:9})).toString('base64url')}

test('URL snapshots preserve complete state exactly, including interpretation and Unicode',()=>{
  const original=fixture(),before=JSON.stringify(original),fragment=encodeDocumentFragment(original)
  assert.match(fragment,/^#1\.[A-Za-z0-9_-]+$/)
  assert.deepEqual(decodeDocumentFragment(fragment),editorSchema.parse(original))
  assert.equal(JSON.stringify(original),before)
})

test('raw DEFLATE and unpadded base64url shorten the same complete document',()=>{
  const document=fixture(),fragment=encodeDocumentFragment(document)
  const plain=Buffer.from(JSON.stringify(editorSchema.parse(document))).toString('base64url')
  assert.ok(fragment.length<plain.length/2)
  assert.deepEqual(decodeDocumentFragment(fragment),editorSchema.parse(document))
  assert.equal(encodeDocumentFragment(document),fragment)
})

test('absent hashes are distinct from unsupported or damaged links',()=>{
  assert.equal(decodeDocumentFragment(''),null);assert.equal(decodeDocumentFragment('#'),null)
  assert.throws(()=>decodeDocumentFragment('#2.abc'),/unsupported/)
  for(const hash of ['#1.','#1.a','#1.abc=','#1.ab+c','#1.abc%20',encodeDocumentFragment(fixture()).slice(0,-20)])assert.throws(()=>decodeDocumentFragment(hash),/invalid/)
  assert.throws(()=>decodeDocumentFragment(encodedBytes(new Uint8Array([255,255]))),/invalid/)
  assert.throws(()=>decodeDocumentFragment(encodedBytes(new TextEncoder().encode('{"version":2}'))),/invalid/)
})

test('decoding bounds both incoming URLs and decompressed documents',()=>{
  assert.throws(()=>decodeDocumentFragment('#1.'+'a'.repeat(128*1024)),/invalid/)
  const oversized=new Uint8Array(8*1024*1024+1).fill(32)
  assert.throws(()=>decodeDocumentFragment(encodedBytes(oversized)),/invalid/)
})
