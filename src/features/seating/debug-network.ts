import { normalize } from './model'
import type { SeatingEvent } from './model'
import { resolveSeatIndices } from './seat-placement'
import { seatProximity, seatRelation } from './seat-optimizer'
import { findPreferenceCliques } from './preference-cliques'

type RuleBase={id:string;label:string}
export type NetworkRule=RuleBase&(
  |{kind:'tag'|'clique';members:string[]}
  |{kind:'prefer'|'avoid';owner:string;targets:string[];match:'any'|'each'}
  |{kind:'separation';members:[string,string]}
  |{kind:'lock';owner:string;tableId:string}
  |{kind:'capacity';tableId:string}
  |{kind:'assignment'|'unresolved'|'ignored';owner:string}
)
export function constraintNetwork(event:SeatingEvent):NetworkRule[]{
  const name=(id:string)=>event.attendees.find(p=>p.id===id)?.name||id
  const tags=new Map<string,{label:string;members:string[]}>()
  for(const person of event.attendees)for(const tag of person.groups){const key=normalize(tag),existing=tags.get(key);if(existing)existing.members.push(person.id);else tags.set(key,{label:tag,members:[person.id]})}
  const rules:NetworkRule[]=[...tags].map(([key,tag])=>({id:`tag:${key}`,kind:'tag',label:`#${tag.label}`,members:[...new Set(tag.members)]}))
  for(const members of findPreferenceCliques(event).cliques)rules.push({id:`clique:${JSON.stringify(members)}`,kind:'clique',label:members.map(name).join(' / '),members})
  for(const clause of event.clauses){
    if(clause.state==='resolved'&&clause.match==='each'&&clause.id.startsWith(`chip:${clause.personId}:code:`))continue
    if(clause.state!=='resolved'){rules.push({id:`clause:${clause.id}`,kind:clause.state,label:`${name(clause.personId)}: ${clause.reference}`,owner:clause.personId});continue}
    rules.push({id:`clause:${clause.id}`,kind:clause.kind,label:`${name(clause.personId)} ${clause.kind==='prefer'?'with':'apart from'} ${clause.targets.map(name).join(clause.match==='each'?' and ':' or ')}`,owner:clause.personId,targets:clause.targets,match:clause.match||'any'})
  }
  for(const [index,members] of event.separations.entries())rules.push({id:`separate:${index}`,kind:'separation',label:`${members.map(name).join(' / ')}`,members})
  for(const [owner,tableId] of Object.entries(event.locks))rules.push({id:`lock:${owner}`,kind:'lock',label:`${name(owner)} at ${event.tables.find(t=>t.id===tableId)?.name}`,owner,tableId})
  for(const table of event.tables)rules.push({id:`capacity:${table.id}`,kind:'capacity',label:table.name,tableId:table.id})
  for(const person of event.attendees)rules.push({id:`assignment:${person.id}`,kind:'assignment',label:person.name,owner:person.id})
  return rules
}
export function rulePeople(rule:NetworkRule,event:SeatingEvent,assignments:Record<string,string>):string[]{
  switch(rule.kind){
    case 'tag':case 'clique':case 'separation':return rule.members
    case 'prefer':case 'avoid':return [rule.owner,...rule.targets]
    case 'capacity':return event.attendees.filter(p=>assignments[p.id]===rule.tableId).map(p=>p.id)
    default:return [rule.owner]
  }
}
export function ruleResolution(rule:NetworkRule,event:SeatingEvent,assignments:Record<string,string>,seatIndices?:Record<string,number>):{text:string;satisfied:boolean|null}{
  const table=(id:string)=>event.tables.find(t=>t.id===assignments[id])
  switch(rule.kind){
    case 'tag':case 'clique':{
      if(rule.members.length<2)return{text:'No other member yet',satisfied:null}
      if(rule.members.some(id=>!table(id)))return{text:'Members still unassigned',satisfied:false}
      const together=new Set(rule.members.map(id=>assignments[id])).size===1
      return{text:together?'Members together':'Members split between tables',satisfied:together}
    }
    case 'prefer':case 'avoid':{
      if(!table(rule.owner))return{text:'Not seated yet',satisfied:null}
      if(rule.kind==='prefer'&&rule.match==='each'&&rule.targets.some(id=>!table(id)))return{text:'Not seated yet',satisfied:null}
      const together=rule.targets.some(id=>table(id)&&assignments[id]===assignments[rule.owner]),satisfied=rule.kind==='prefer'?(rule.match==='each'?rule.targets.every(id=>assignments[id]===assignments[rule.owner]):together):!together
      if(!together&&rule.targets.some(id=>!table(id)))return{text:'Not seated yet',satisfied:null}
      if(rule.kind==='prefer'&&together&&seatIndices&&Number.isInteger(seatIndices[rule.owner])){
        const targets=rule.targets.filter(id=>assignments[id]===assignments[rule.owner]&&Number.isInteger(seatIndices[id]))
        if(targets.length){
          const qualities=targets.map(id=>({id,quality:seatProximity(seatIndices[rule.owner],seatIndices[id])})).sort((a,b)=>b.quality-a.quality)
          if(rule.match==='each'&&targets.length>1){const near=qualities.every(q=>q.quality>0)&&satisfied;return{text:near?'Companions in nearby seats':'Some companions farther away',satisfied:near}}
          return{text:seatRelation(seatIndices[rule.owner],seatIndices[qualities[0].id]),satisfied:qualities[0].quality>0}
        }
      }
      return{text:satisfied?'Preference met':'Preference unmet',satisfied}
    }
    case 'separation':{
      if(rule.members.some(id=>!table(id)))return{text:'Not seated yet',satisfied:null}
      const satisfied=assignments[rule.members[0]]!==assignments[rule.members[1]]
      return{text:satisfied?'Kept apart':'Mandatory rule violated',satisfied}
    }
    case 'lock':{
      const satisfied=assignments[rule.owner]===rule.tableId
      return{text:satisfied?'Locked table respected':'Locked table not assigned',satisfied}
    }
    case 'capacity':{
      const occupied=event.attendees.filter(p=>assignments[p.id]===rule.tableId).length,capacity=event.tables.find(t=>t.id===rule.tableId)?.capacity||0
      return{text:occupied>capacity?'Capacity exceeded':occupied===0?'Unused table':occupied===capacity?'Table full':'Seats available',satisfied:occupied<=capacity}
    }
    case 'assignment':return{text:table(rule.owner)?.name||'Unassigned',satisfied:!!table(rule.owner)}
    case 'unresolved':return{text:'Blocks optimization until mapped or removed',satisfied:null}
    case 'ignored':return{text:'Not used by the solver',satisfied:null}
  }
}
export function networkLayout(event:SeatingEvent,assignments:Record<string,string>,rules:NetworkRule[],seatIndices?:Record<string,number>){
  const people=new Map<string,{x:number;y:number}>()
  const indices=resolveSeatIndices(event,assignments,seatIndices)
  const tables=[...event.tables.map(t=>({id:t.id,name:t.name,capacity:t.capacity,rotation:t.rotation??0})),...(event.attendees.some(p=>!event.tables.some(t=>t.id===assignments[p.id]))?[{id:'__unassigned',name:'Unassigned',capacity:0,rotation:0}]:[])]
  let left=48,top=64,runWidth=0
  const columns=tables.map((table,index)=>{
    const members=event.attendees.filter(p=>table.id==='__unassigned'?!event.tables.some(t=>t.id===assignments[p.id]):assignments[p.id]===table.id)
    const x=left,y=table.rotation===90?top:64
    const position=(personId:string,fallback:number)=>indices[personId]??fallback
    const lastSeat=Math.max(-1,...members.map((person,index)=>position(person.id,index)))
    const rows=Math.max(1,Math.ceil((lastSeat+1)/2)),horizontal=table.rotation===90
    const width=horizontal?rows*176+16:368,height=horizontal?186:Math.max(110,Math.ceil((lastSeat+1)/2)*62+62)
    members.forEach((person,index)=>{const seat=position(person.id,index);people.set(person.id,horizontal?{x:x+16+(rows-1-Math.floor(seat/2))*176,y:y+42+(seat%2)*62}:{x:x+16+(seat%2)*176,y:y+42+Math.floor(seat/2)*62})})
    if(horizontal){top+=height+40;runWidth=Math.max(runWidth,width);if(tables[index+1]?.rotation!==90){left+=runWidth+40;top=64;runWidth=0}}
    else left+=width+40
    return {...table,x,y,width,height,members}
  })
  const width=Math.max(550,left+12),bottom=Math.max(...columns.map(t=>t.y+t.height))+80
  const hubs=new Map<string,{x:number;y:number;label:string}>(),perRow=Math.max(2,Math.floor((width-70)/196))
  for(const rule of rules)if(rule.kind==='tag'||rule.kind==='clique'||rule.kind==='unresolved'||rule.kind==='ignored'||(rule.kind==='prefer'||rule.kind==='avoid')&&rule.targets.length>1){
    const index=hubs.size
    hubs.set(rule.id,{x:48+(index%perRow)*196,y:bottom+Math.floor(index/perRow)*70,label:rule.kind==='tag'?rule.label:rule.kind==='clique'?'Mutual group':rule.kind==='prefer'||rule.kind==='avoid'?rule.label.split(' ').slice(0,3).join(' '):rule.kind==='ignored'?'Ignored request':'Unmapped request'})
  }
  return{people,tables:columns,hubs,width,height:Math.max(bottom+70,bottom+Math.ceil(hubs.size/perRow)*70)}
}
