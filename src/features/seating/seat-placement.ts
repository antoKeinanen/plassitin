import type { EditorDocument } from './editor'
import { tableLayout } from './editor'
import type { SeatingEvent } from './model'

export interface SeatAddress { tableId: string; index: number }

export function resolveSeatIndices(event: SeatingEvent, assignments: Record<string,string>, previous: Record<string,number> = {}): Record<string,number> {
  const indices: Record<string,number> = {}
  for (const table of event.tables) {
    const people = event.attendees.filter(person=>assignments[person.id]===table.id), occupied = new Set<number>()
    for (const person of people) {
      const index=previous[person.id]
      if (Number.isInteger(index)&&index>=0&&index<table.capacity&&!occupied.has(index)) { indices[person.id]=index;occupied.add(index) }
    }
    for (const person of people) if (indices[person.id]===undefined) {
      const free=Array.from({length:table.capacity},(_,i)=>i).find(index=>!occupied.has(index))
      if(free!==undefined){indices[person.id]=free;occupied.add(free)}
    }
  }
  return indices
}

export function moveGuest(document: EditorDocument, personId: string, target: SeatAddress): EditorDocument {
  const {event}=document,sourceTable=document.assignments[personId],table=event.tables.find(t=>t.id===target.tableId)
  if(!sourceTable||!event.attendees.some(p=>p.id===personId))throw new Error('This guest does not have a seat to move.')
  if(!table||!Number.isInteger(target.index)||target.index<0||target.index>=table.capacity)throw new Error('Choose a seat inside a table.')
  const indices=resolveSeatIndices(event,document.assignments,document.seatIndices),sourceIndex=indices[personId]
  if(sourceIndex===undefined)throw new Error('This guest does not have a seat to move.')
  if(sourceTable===target.tableId&&sourceIndex===target.index)return document
  const occupant=event.attendees.find(p=>document.assignments[p.id]===target.tableId&&indices[p.id]===target.index)
  const assignments={...document.assignments,[personId]:target.tableId},seatIndices={...indices,[personId]:target.index}
  if(occupant){assignments[occupant.id]=sourceTable;seatIndices[occupant.id]=sourceIndex}
  for(const id of [personId,...(occupant?[occupant.id]:[])])if(event.locks[id]&&event.locks[id]!==assignments[id])throw new Error(`Unlock ${event.attendees.find(p=>p.id===id)?.name}'s placement before moving them to another table.`)
  for(const [a,b] of event.separations)if(assignments[a]&&assignments[a]===assignments[b])throw new Error('This move would violate a mandatory separation.')
  for(const table of event.tables)if(Object.values(assignments).filter(id=>id===table.id).length>table.capacity)throw new Error('This move would exceed the table capacity.')
  return {...document,assignments,seatIndices}
}

export function nearestSeat(layout: ReturnType<typeof tableLayout>, point: {x:number;y:number}): SeatAddress|null {
  let nearest: SeatAddress|null=null,distance=Infinity
  for(const table of layout)for(const [index,seat] of table.seats.entries()){
    const candidate=Math.hypot(point.x-table.x-seat.x-seat.size/2,point.y-table.y-seat.y-seat.size/2)
    if(candidate<=seat.size*.75&&candidate<distance){nearest={tableId:table.id,index};distance=candidate}
  }
  return nearest
}

export function seatInDirection(table:ReturnType<typeof tableLayout>[number],index:number,key:string):number|null{
  const directions:Record<string,{x:number;y:number}>={ArrowUp:{x:0,y:-1},ArrowDown:{x:0,y:1},ArrowLeft:{x:-1,y:0},ArrowRight:{x:1,y:0}}
  const direction=directions[key],origin=table.seats[index];if(!direction||!origin)return null
  let target:number|null=null,distance=Infinity
  table.seats.forEach((seat,next)=>{
    const dx=seat.x-origin.x,dy=seat.y-origin.y,forward=dx*direction.x+dy*direction.y,sideways=Math.abs(dx*direction.y-dy*direction.x)
    if(forward>0&&sideways<1&&forward<distance){target=next;distance=forward}
  })
  return target
}
