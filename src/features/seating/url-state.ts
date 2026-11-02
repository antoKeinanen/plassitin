import { deflateSync, Inflate } from 'fflate'
import { editorSchema } from './editor'
import type { EditorDocument } from './editor'

const PREFIX='#1.', MAX_FRAGMENT=128*1024, MAX_DOCUMENT=8*1024*1024
const invalidLink='This seating link is invalid or incomplete. Your current seating has been kept.'

function base64url(bytes:Uint8Array):string{
  let binary=''
  for(const byte of bytes)binary+=String.fromCharCode(byte)
  return btoa(binary).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'')
}

export function encodeDocumentFragment(document:EditorDocument):string{
  const bytes=new TextEncoder().encode(JSON.stringify(editorSchema.parse(document)))
  if(bytes.length>MAX_DOCUMENT)throw new Error('This seating plan is too large to store in a link. It is still saved in this browser.')
  const fragment=PREFIX+base64url(deflateSync(bytes,{level:9}))
  if(fragment.length>MAX_FRAGMENT)throw new Error('This seating plan is too large to store in a link. It is still saved in this browser.')
  return fragment
}

export function decodeDocumentFragment(fragment:string):EditorDocument|null{
  if(!fragment||fragment==='#')return null
  if(!fragment.startsWith(PREFIX))throw new Error('This seating link uses an unsupported format. Your current seating has been kept.')
  try{
    const payload=fragment.slice(PREFIX.length)
    if(fragment.length>MAX_FRAGMENT||!payload||!/^[A-Za-z0-9_-]+$/.test(payload)||payload.length%4===1)throw new Error(invalidLink)
    const binary=atob(payload.replaceAll('-','+').replaceAll('_','/'))
    const compressed=Uint8Array.from(binary,char=>char.charCodeAt(0))
    if(base64url(compressed)!==payload)throw new Error(invalidLink)
    let length=0
    const chunks:Uint8Array[]=[],inflater=new Inflate(chunk=>{
      length+=chunk.length
      if(length>MAX_DOCUMENT)throw new Error(invalidLink)
      chunks.push(chunk)
    })
    for(let offset=0;offset<compressed.length;offset+=1024)inflater.push(compressed.subarray(offset,offset+1024),offset+1024>=compressed.length)
    const bytes=new Uint8Array(length)
    let offset=0
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
    const raw:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))
    return editorSchema.parse(raw)
  }catch{throw new Error(invalidLink)}
}
