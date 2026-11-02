import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { interpret } from './engine.server'

const attendees=[{id:'a',name:'Anna Virtanen',aliases:['Annie'],groups:['Marketing'],text:''},{id:'b',name:'Michael Smith',aliases:['Mike'],groups:['Sales'],text:''}]
test('unconfigured extraction reports list mode and preserves unknown prose',async()=>{
  delete process.env.PREFERENCE_EXTRACTOR_URL
  const result=await interpret({personId:'a',text:'Mike, the old university gang',attendees})
  assert.equal(result.mode,'lists');assert.equal(result.clauses[0].state,'resolved');assert.equal(result.clauses[1].state,'unresolved')
})
test('configured extractor receives text only and returned references still use registry resolution',async()=>{
  const server=createServer((request,response)=>{
    const chunks:Buffer[]=[];request.on('data',chunk=>chunks.push(chunk));request.on('end',()=>{
      assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()),{text:'My old friend Mike, and the mystery gang'})
      response.setHeader('Content-Type','application/json');response.end(JSON.stringify([{reference:'Mike',kind:'prefer',weight:3},{reference:'mystery gang',kind:'prefer',weight:1}]))
    })
  })
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address==='object')
  process.env.PREFERENCE_EXTRACTOR_URL=`http://127.0.0.1:${address.port}`
  try{const result=await interpret({personId:'a',text:'My old friend Mike, and the mystery gang',attendees});assert.equal(result.mode,'ai');assert.deepEqual(result.clauses[0].state==='resolved'&&result.clauses[0].targets,['b']);assert.equal(result.clauses[1].state,'unresolved')}
  finally{delete process.env.PREFERENCE_EXTRACTOR_URL;await new Promise<void>(resolve=>server.close(()=>resolve()))}
})
