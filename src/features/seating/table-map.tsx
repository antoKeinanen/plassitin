import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { SeatingEvent } from './model'
import { isTagPreference } from './model'
import { fitCamera, tableLayout, zoomCamera } from './editor'
import type { Camera } from './editor'
import { nearestSeat, resolveSeatIndices, seatInDirection } from './seat-placement'
import type { SeatAddress } from './seat-placement'
import type { PointerEvent as ReactPointerEvent } from 'react'

type Point = { x: number; y: number }
type SeatDrag = {pointerId:number;personId:string;start:Point;last:Point;origin:Point;active:boolean;target:SeatAddress|null}
type DragPreview = {personId:string;x:number;y:number;target:SeatAddress|null}
export function TableMap({ event, assignments, seatIndices, selectedPerson, selectedTable, highlightedPeople, onPerson, onTable, onLock, onMove }: {
  highlightedPeople: string[]; event: SeatingEvent; assignments: Record<string,string>; seatIndices?:Record<string,number>; selectedPerson: string | null; selectedTable: string
  onPerson: (id: string) => void; onTable: (id: string, anchor: HTMLButtonElement) => void; onLock: (id: string, table: string) => void; onMove:(id:string,target:SeatAddress)=>void
}) {
  const viewport = useRef<HTMLDivElement>(null), scene = useRef<HTMLDivElement>(null)
  const [camera,setCamera] = useState<Camera>({ x: 0, y: 0, scale: 1 })
  const [hoveredPerson,setHoveredPerson]=useState<string|null>(null)
  const seatDrag=useRef<SeatDrag|null>(null),[preview,setPreview]=useState<DragPreview|null>(null)
  const preferences=event.clauses.filter(clause=>clause.personId===hoveredPerson&&clause.state==='resolved')
  const highlighted=new Set(hoveredPerson?preferences.flatMap(clause=>clause.state==='resolved'&&clause.kind==='prefer'?clause.targets:[]):highlightedPeople)
  const avoided=new Set(preferences.flatMap(clause=>clause.state==='resolved'&&clause.kind==='avoid'?clause.targets:[]))
  const requestedBy=new Set(event.clauses.flatMap(clause=>clause.state==='resolved'&&clause.kind==='prefer'&&!isTagPreference(clause)&&hoveredPerson&&clause.targets.includes(hoveredPerson)?[clause.personId]:[]))
  const indices=resolveSeatIndices(event,assignments,seatIndices)
  const moved = useRef(false)
  const cameraRef = useRef(camera), pointers = useRef(new Map<number,Point>()), gesture = useRef<{ points: Point[]; camera: Camera }>({ points: [], camera })
  const [dragging,setDragging] = useState(false)
  const layout = tableLayout(event.tables)
  const sceneSize = { width: Math.max(280, ...layout.map(t => t.x + t.width + 48)), height: Math.max(200, ...layout.map(t => t.y + t.height + 56)) }
  const dimensions = `${sceneSize.width}:${sceneSize.height}`
  const update = (next: Camera) => { cameraRef.current = next; setCamera(next) }
  const fit = () => { const box = viewport.current?.getBoundingClientRect(); if (box) update(fitCamera(box,sceneSize)) }
  const latestFit = useRef(fit); latestFit.current = fit
  useLayoutEffect(() => { latestFit.current() },[dimensions])
  useEffect(() => {
    const element = viewport.current
    if (!element) return
    const observer = new ResizeObserver(() => latestFit.current()); observer.observe(element)
    const wheel = (e: WheelEvent) => {
      e.preventDefault(); if(seatDrag.current)return; const box = element.getBoundingClientRect()
      update(zoomCamera(cameraRef.current, Math.exp(-e.deltaY * .002), { x: e.clientX - box.left, y: e.clientY - box.top }))
    }
    element.addEventListener('wheel',wheel,{ passive: false })
    return () => { observer.disconnect(); element.removeEventListener('wheel',wheel) }
  },[])
  const startGesture = () => { gesture.current = { points: [...pointers.current.values()], camera: cameraRef.current } }
  const zoom = (factor: number) => { const box=viewport.current?.getBoundingClientRect();if(box)update(zoomCamera(cameraRef.current,factor,{x:box.width/2,y:box.height/2})) }

  const cancelSeatDrag=()=>{seatDrag.current=null;setPreview(null)}
  const beginSeatDrag=(e:ReactPointerEvent<HTMLButtonElement>,personId:string,origin:Point)=>{
    if(e.button!==0||seatDrag.current||pointers.current.size)return
    e.stopPropagation();e.currentTarget.setPointerCapture(e.pointerId);moved.current=false
    seatDrag.current={pointerId:e.pointerId,personId,start:{x:e.clientX,y:e.clientY},last:{x:e.clientX,y:e.clientY},origin,active:false,target:null}
  }
  const updateSeatDrag=(e:ReactPointerEvent<HTMLDivElement>)=>{
    const drag=seatDrag.current
    if(!drag||drag.pointerId!==e.pointerId)return false
    drag.last={x:e.clientX,y:e.clientY}
    const dx=e.clientX-drag.start.x,dy=e.clientY-drag.start.y
    if(!drag.active&&Math.hypot(dx,dy)<5)return true
    drag.active=true;moved.current=true
    const x=drag.origin.x+dx/cameraRef.current.scale,y=drag.origin.y+dy/cameraRef.current.scale
    drag.target=nearestSeat(layout,{x:x+36,y:y+36})
    const targetTable=layout.find(table=>table.id===drag.target?.tableId),targetSeat=drag.target?targetTable?.seats[drag.target.index]:undefined
    setPreview({personId:drag.personId,x:targetTable&&targetSeat?targetTable.x+targetSeat.x:x,y:targetTable&&targetSeat?targetTable.y+targetSeat.y:y,target:drag.target})
    return true
  }

  return <div className={`map-viewport ${dragging?'is-panning':''} ${preview?'is-seat-dragging':''}`} ref={viewport} tabIndex={0} role="region" aria-label="Seating map. Drag to pan. Scroll or pinch to zoom. Arrow keys pan." onMouseLeave={()=>setHoveredPerson(null)}
    onPointerDown={e => {
      if(e.button!==0 || e.target instanceof Element && e.target.closest('.map-controls'))return
      if(seatDrag.current){
        const previous=seatDrag.current;pointers.current.set(previous.pointerId,previous.last);cancelSeatDrag()
      }
      if(!pointers.current.size)moved.current=false
      if(!(e.target instanceof Element && e.target.closest('button')))e.currentTarget.setPointerCapture(e.pointerId)
      pointers.current.set(e.pointerId,{x:e.clientX,y:e.clientY});startGesture()
    }}
    onPointerMove={e => {
      if(updateSeatDrag(e))return
      if(!pointers.current.has(e.pointerId))return
      pointers.current.set(e.pointerId,{x:e.clientX,y:e.clientY})
      const before=gesture.current,now=[...pointers.current.values()]
      if(now.length>1 || before.points[0] && Math.hypot(now[0].x-before.points[0].x,now[0].y-before.points[0].y)>4){moved.current=true;setDragging(true);if(!e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.setPointerCapture(e.pointerId)}
      if(!moved.current)return
      if(now.length===1&&before.points.length===1)update({...before.camera,x:before.camera.x+now[0].x-before.points[0].x,y:before.camera.y+now[0].y-before.points[0].y})
      else if(now.length===2&&before.points.length===2){
        const box=e.currentTarget.getBoundingClientRect(),oldMid={x:(before.points[0].x+before.points[1].x)/2-box.left,y:(before.points[0].y+before.points[1].y)/2-box.top},mid={x:(now[0].x+now[1].x)/2-box.left,y:(now[0].y+now[1].y)/2-box.top}
        const oldDistance=Math.hypot(before.points[0].x-before.points[1].x,before.points[0].y-before.points[1].y),distance=Math.hypot(now[0].x-now[1].x,now[0].y-now[1].y)
        if(oldDistance>0){const next=zoomCamera(before.camera,distance/oldDistance,oldMid);update({...next,x:next.x+mid.x-oldMid.x,y:next.y+mid.y-oldMid.y})}
      }
    }}
    onClickCapture={e=>{if(moved.current&&!(e.target instanceof Element&&e.target.closest('.map-controls'))){e.preventDefault();e.stopPropagation()}}}
    onPointerUp={e=>{const drag=seatDrag.current;if(drag&&drag.pointerId===e.pointerId){cancelSeatDrag();if(drag.active&&drag.target)onMove(drag.personId,drag.target);return}pointers.current.delete(e.pointerId);startGesture();setDragging(pointers.current.size>0)}}
    onPointerCancel={e=>{if(seatDrag.current?.pointerId===e.pointerId)cancelSeatDrag();pointers.current.delete(e.pointerId);startGesture();setDragging(pointers.current.size>0)}}
    onLostPointerCapture={e=>{if(seatDrag.current?.pointerId===e.pointerId)cancelSeatDrag()}}
    onKeyDown={e=>{if(e.key==='Escape'&&seatDrag.current){e.preventDefault();moved.current=true;cancelSeatDrag();return}if(e.target!==e.currentTarget)return;const directions:Record<string,Point>={ArrowLeft:{x:45,y:0},ArrowRight:{x:-45,y:0},ArrowUp:{x:0,y:45},ArrowDown:{x:0,y:-45}};const delta=directions[e.key];if(delta){e.preventDefault();update({...cameraRef.current,x:cameraRef.current.x+delta.x,y:cameraRef.current.y+delta.y})}else if(e.key==='+'||e.key==='='){e.preventDefault();zoom(1.2)}else if(e.key==='-'){e.preventDefault();zoom(1/1.2)}else if(e.key==='0'){e.preventDefault();fit()}}}>
    <div className="map-scene" ref={scene} style={{width:sceneSize.width,height:sceneSize.height,transform:`translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`}}>
      {layout.map(table=>{
        const people=new Map(event.attendees.filter(p=>assignments[p.id]===table.id).map(p=>[indices[p.id],p]))
        return <div className="map-table-group" data-table-id={table.id} key={table.id} style={{left:table.x,top:table.y,width:table.width,height:table.height}}>
          <button className={`long-table ${selectedTable===table.id?'selected-table':''}`} style={{left:0,top:0,width:table.width,height:table.height}} onClick={e=>onTable(table.id,e.currentTarget)} aria-label={`Configure ${table.name}`}><span>{table.name}</span></button>
          {table.seats.map((seat,index)=>{
            const person=people.get(index),target=preview?.target?.tableId===table.id&&preview.target.index===index,style={left:seat.x,top:seat.y,width:seat.size,height:seat.size}
            return person?<button data-person-id={person.id} data-seat-index={index} key={index} className={`map-seat ${highlighted.has(person.id)?'highlighted-seat':''} ${avoided.has(person.id)?'avoided-seat':''} ${requestedBy.has(person.id)?'requested-by-seat':''} ${hoveredPerson===person.id?'preference-source-seat':''} ${target?'seat-drop-target':''} ${preview?.personId===person.id?'seat-drag-source':''} ${selectedPerson===person.id?'selected-seat':''} ${event.locks[person.id]?'locked-seat':''}`} style={style} onMouseEnter={()=>setHoveredPerson(person.id)} onMouseLeave={()=>setHoveredPerson(null)} onPointerDown={e=>beginSeatDrag(e,person.id,{x:table.x+seat.x,y:table.y+seat.y})} onKeyDown={e=>{if(!e.altKey)return;const next=seatInDirection(table,index,e.key);if(next!==null){e.preventDefault();onMove(person.id,{tableId:table.id,index:next})}}} onClick={()=>onPerson(person.id)} onDoubleClick={()=>onLock(person.id,table.id)} title={`${person.name}. Drag to move; Alt+arrow keys move within the table. Double click to ${event.locks[person.id]?'unlock':'lock'} this placement.`}>{person.name}</button>:<span data-seat-index={index} key={index} className={`map-seat empty-seat ${target?'seat-drop-target':''}`} style={style}/>
          })}
        </div>
      })}
      {preview&&<span className="map-seat seat-drag-ghost" aria-hidden="true" style={{left:preview.x,top:preview.y,width:72,height:72}}>{event.attendees.find(p=>p.id===preview.personId)?.name}</span>}
    </div>
    <div className="map-controls" onPointerDown={e=>e.stopPropagation()}><button type="button" onClick={()=>zoom(1/1.2)}>Zoom out</button><button type="button" onClick={()=>zoom(1.2)}>Zoom in</button><button type="button" onClick={fit}>Fit</button></div>
  </div>
}
