import test from 'node:test'
import assert from 'node:assert/strict'
import { parsePastedAttendees } from './files'

test('pasted two-column CSV accepts optional headers, commas, quotes and multiline messages',()=>{
  const rows=parsePastedAttendees('name,preferences\r\nAnna,"Mike, Sarah"\r\nMike,"Anna says ""hi""\nand Sarah"')
  assert.deepEqual(rows.map(p=>[p.name,p.text]),[['Anna','Mike, Sarah'],['Mike','Anna says "hi"\nand Sarah']])
  assert.deepEqual(parsePastedAttendees('Anna,\nMike,Anna').map(p=>[p.name,p.text]),[['Anna',''],['Mike','Anna']])
  assert.equal(new Set(rows.map(p=>p.id)).size,2)
})
test('pasted CSV rejects incomplete, malformed and oversized imports before confirmation',()=>{
  for(const text of ['', 'name,preferences', 'Anna', 'Anna,Mike,Sarah', ',Mike', 'Anna,"Mike'])assert.throws(()=>parsePastedAttendees(text))
  assert.throws(()=>parsePastedAttendees(Array.from({length:301},()=> 'Anna,Mike').join('\n')),/300/)
  assert.throws(()=>parsePastedAttendees('Anna,'+'x'.repeat(5001)),/5,000/)
})
