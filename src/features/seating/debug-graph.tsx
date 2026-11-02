import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { fitCamera, zoomCamera } from './editor'
import type { Camera } from './editor'
import type { SeatingEvent } from './model'
import { networkLayout, rulePeople, ruleResolution } from './debug-network'
import type { NetworkRule } from './debug-network'

type Point={x:number;y:number}
export function DebugGraph({event,assignments,seatIndices,rules,visibleRules,selectedRule,selectedPerson,onRule,onPerson}:{
  event:SeatingEvent;assignments:Record<string,string>;seatIndices?:Record<string,number>;rules:NetworkRule[];visibleRules:NetworkRule[];selectedRule:string|null;selectedPerson:string|null;onRule:(id:string)=>void;onPerson:(id:string)=>void
}){
  const viewport=useRef<HTMLDivElement>(null),drag=useRef<{start:Point;camera:Camera}|null>(null),moved=useRef(false)
  const [camera,setCamera]=useState<Camera>({x:0,y:0,scale:1}),cameraRef=useRef(camera)
  const layout=networkLayout(event,assignments,rules,seatIndices),size=`${layout.width}:${layout.height}`
  const update=(next:Camera)=>{cameraRef.current=next;setCamera(next)}
  const fit=()=>{const box=viewport.current?.getBoundingClientRect();if(box)update(fitCamera(box,layout))}
  const latestFit=useRef(fit);latestFit.current=fit
  useLayoutEffect(()=>{latestFit.current()},[size])
  useEffect(()=>{
    const element=viewport.current;if(!element)return
    const observer=new ResizeObserver(()=>latestFit.current());observer.observe(element)
    const wheel=(e:WheelEvent)=>{e.preventDefault();const rect=element.getBoundingClientRect();update(zoomCamera(cameraRef.current,Math.exp(-e.deltaY*.002),{x:e.clientX-rect.left,y:e.clientY-rect.top}))}
    element.addEventListener('wheel',wheel,{passive:false})
    return()=>{observer.disconnect();element.removeEventListener('wheel',wheel)}
  },[])
  const zoom=(factor:number)=>{const box=viewport.current?.getBoundingClientRect();if(box)update(zoomCamera(cameraRef.current,factor,{x:box.width/2,y:box.height/2}))}
  const activeRule=rules.find(rule=>rule.id===selectedRule),highlighted=new Set(activeRule?rulePeople(activeRule,event,assignments):selectedPerson?[selectedPerson]:[])
  const related=(rule:NetworkRule)=>selectedRule?rule.id===selectedRule:selectedPerson?rulePeople(rule,event,assignments).includes(selectedPerson):true
  const personPoint=(id:string)=>{const point=layout.people.get(id);return point?{x:point.x+80,y:point.y+22}:null}
  const paths: {key:string;rule:NetworkRule;from:Point;to:Point}[]=[]
  const connect=(rule:NetworkRule,from:Point|null,to:Point|null,suffix:string)=>{if(from&&to)paths.push({key:`${rule.id}:${suffix}`,rule,from,to})}
  for(const rule of visibleRules){
    const hub=layout.hubs.get(rule.id),center=hub?{x:hub.x+80,y:hub.y+18}:null
    if(rule.kind==='tag'||rule.kind==='clique')for(const id of rule.members)connect(rule,personPoint(id),center,id)
    else if(rule.kind==='prefer'||rule.kind==='avoid'){
      if(center){connect(rule,personPoint(rule.owner),center,'owner');for(const id of rule.targets)connect(rule,center,personPoint(id),id)}
      else connect(rule,personPoint(rule.owner),personPoint(rule.targets[0]),'target')
    }else if(rule.kind==='separation')connect(rule,personPoint(rule.members[0]),personPoint(rule.members[1]),'pair')
    else if(rule.kind==='lock'){const table=layout.tables.find(t=>t.id===rule.tableId);connect(rule,personPoint(rule.owner),table?{x:table.x+table.width/2,y:table.y+12}:null,'table')}
    else if(rule.kind==='unresolved'||rule.kind==='ignored')connect(rule,personPoint(rule.owner),center,'request')
  }
  const visibleIds=new Set(visibleRules.map(rule=>rule.id))
  return <div ref={viewport} className="map-viewport debug-network" role="region" aria-label="Constraint network. Drag to pan, scroll to zoom, select a guest or relationship to inspect it." tabIndex={0}
    onPointerDown={e=>{if(e.button!==0||e.target instanceof Element&&e.target.closest('.map-controls'))return;moved.current=false;drag.current={start:{x:e.clientX,y:e.clientY},camera:cameraRef.current};if(!(e.target instanceof Element&&e.target.closest('[role="button"],.debug-edge')))e.currentTarget.setPointerCapture(e.pointerId)}}
    onPointerMove={e=>{if(!drag.current)return;const dx=e.clientX-drag.current.start.x,dy=e.clientY-drag.current.start.y;if(Math.hypot(dx,dy)>4){moved.current=true;if(!e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.setPointerCapture(e.pointerId)}if(moved.current)update({...drag.current.camera,x:drag.current.camera.x+dx,y:drag.current.camera.y+dy})}}
    onPointerUp={()=>{drag.current=null}} onPointerCancel={()=>{drag.current=null}}
    onClickCapture={e=>{if(moved.current){e.stopPropagation();moved.current=false}}}
    onKeyDown={e=>{if(e.target!==e.currentTarget)return;const directions:Record<string,Point>={ArrowLeft:{x:45,y:0},ArrowRight:{x:-45,y:0},ArrowUp:{x:0,y:45},ArrowDown:{x:0,y:-45}};const delta=directions[e.key];if(delta){e.preventDefault();update({...cameraRef.current,x:cameraRef.current.x+delta.x,y:cameraRef.current.y+delta.y})}else if(e.key==='0'){e.preventDefault();fit()}else if(e.key==='+'||e.key==='='){e.preventDefault();zoom(1.2)}else if(e.key==='-'){e.preventDefault();zoom(1/1.2)}}}>
    <svg width="100%" height="100%" aria-label="Seating relationships"><g transform={`translate(${camera.x} ${camera.y}) scale(${camera.scale})`}>
      {layout.tables.map(table=><g key={table.id} data-table-id={table.id} className={`debug-table ${selectedRule===`capacity:${table.id}`?'is-selected':''}`} role="button" tabIndex={0} aria-label={`Inspect ${table.name} capacity`} onClick={()=>onRule(`capacity:${table.id}`)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onRule(`capacity:${table.id}`)}}}><title>{table.name}: {table.capacity?`${table.capacity} seats`:'guests without a table'}</title><rect x={table.x} y={table.y} width={table.width} height={table.height} rx="3"/><text x={table.x+98} y={table.y-13} textAnchor="middle">{table.name}</text></g>)}
      <g className="debug-edges">{paths.map(({key,rule,from,to},index)=>{
        const resolution=ruleResolution(rule,event,assignments,seatIndices),curve=Math.min(100,Math.abs(to.y-from.y)*.25+26)+(index%3)*8
        return <path key={key} className={`debug-edge rule-${rule.kind} ${resolution.satisfied===false?'is-unmet':''} ${rule.id===selectedRule?'is-selected':''}`} style={{opacity:related(rule)?1:.1}} d={`M ${from.x} ${from.y} C ${from.x+curve} ${from.y}, ${to.x+curve} ${to.y}, ${to.x} ${to.y}`} onClick={()=>onRule(rule.id)}><title>{rule.label}: {resolution.text}</title></path>
      })}</g>
      {event.attendees.map(person=>{const point=layout.people.get(person.id);if(!point)return null;const nameParts=person.name.split(' '),first=nameParts.slice(0,Math.ceil(nameParts.length/2)).join(' '),last=nameParts.slice(Math.ceil(nameParts.length/2)).join(' ')
        return <g key={person.id} data-person-id={person.id} data-seat-index={seatIndices?.[person.id]} data-table-id={assignments[person.id]||''} className={`debug-person ${selectedPerson===person.id||highlighted.has(person.id)?'is-selected':''}`} role="button" tabIndex={0} aria-label={`Inspect ${person.name}`} aria-pressed={selectedPerson===person.id} onClick={()=>onPerson(person.id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onPerson(person.id)}}}><title>{person.name}</title><rect x={point.x} y={point.y} width="160" height="44"/><text x={point.x+80} y={point.y+(last?18:27)} textAnchor="middle"><tspan x={point.x+80}>{first.length>23?first.slice(0,22)+'…':first}</tspan>{last&&<tspan x={point.x+80} dy="15">{last.length>23?last.slice(0,22)+'…':last}</tspan>}</text></g>
      })}
      {[...layout.hubs].map(([id,hub])=>{const rule=rules.find(rule=>rule.id===id);if(!rule||!visibleIds.has(id))return null;return <g key={id} className={`debug-hub rule-${rule.kind} ${selectedRule===id?'is-selected':''}`} style={{opacity:related(rule)?1:.2}} role="button" tabIndex={0} aria-label={`Inspect ${rule.label}`} onClick={()=>onRule(id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onRule(id)}}}><title>{rule.label}: {ruleResolution(rule,event,assignments,seatIndices).text}</title><rect x={hub.x} y={hub.y} width="160" height="36" rx="4"/><text x={hub.x+80} y={hub.y+23} textAnchor="middle">{hub.label.length>24?hub.label.slice(0,23)+'…':hub.label}</text></g>})}
    </g></svg>
    <div className="map-controls" onPointerDown={e=>e.stopPropagation()}><button onClick={()=>zoom(1/1.2)}>Zoom out</button><button onClick={()=>zoom(1.2)}>Zoom in</button><button onClick={fit}>Fit</button></div>
  </div>
}
