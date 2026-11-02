import { useEffect, useRef, useState } from 'react'
import { createDemo } from './demo'
import { eventSchema } from './model'
import type { Attendee, Clause } from './model'
import { optimizeSeating } from './actions'
import { createEmptyDocument, editorSchema, fillAssignments, inferMessageNames, isChipClause, isInferredNameClause, rebuildEvent, referenceKey, resizeTables, rotateTable, updatePerson } from './editor'
import type { Decision, EditorDocument } from './editor'
import { ImportDialog } from './import-dialog'
import { ClearDialog } from './clear-dialog'
import { TableMap } from './table-map'
import { AttendeeRow } from './attendee-row'
import { AnchoredPopover } from './anchored-popover'
import { moveGuest } from './seat-placement'
import type { SeatAddress } from './seat-placement'
import { decodeDocumentFragment, encodeDocumentFragment } from './url-state'
import { DEBUG_RUN_STORAGE, rememberSolverRun } from './solver-debug'

const STORAGE='plassitin.editor.v2', LEGACY='plassitin.workspace.v1'
const errorMessage=(error:unknown)=>error instanceof Error?error.message:'The change could not be saved.'
function initialDocument():EditorDocument{
  const event={...createDemo(),tables:createEmptyDocument().event.tables}
  const document={version:2,event,links:{},decisions:{},assignments:fillAssignments(event)} satisfies EditorDocument
  const migrated=editorSchema.parse(document)
  return{...migrated,event:rebuildEvent(migrated)}
}

export function Workspace(){
  const [document,setDocument]=useState<EditorDocument>(initialDocument),[ready,setReady]=useState(false)
  const [selectedPerson,setSelectedPerson]=useState<string|null>(null),[selectedTable,setSelectedTable]=useState('t1')
  const [tablePopup,setTablePopup]=useState<{id:string;anchor:HTMLButtonElement}|null>(null)
  const [newPerson,setNewPerson]=useState<string|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  const [importOpen,setImportOpen]=useState(false)
  const [clearOpen,setClearOpen]=useState(false),[mapVersion,setMapVersion]=useState(0)
  const [hoveredPeople,setHoveredPeople]=useState<string[]>([])
  const current=useRef(document),rows=useRef<HTMLDivElement>(null)
  const solverRequest=useRef(0)
  const urlTimer=useRef<ReturnType<typeof setTimeout>|null>(null),pausedURL=useRef<EditorDocument|null>(null)
  const change=(next:EditorDocument)=>{current.current=next;setDocument(next);setError('')}
  useEffect(()=>{
    let linked:EditorDocument|null=null,linkError=''
    try{linked=decodeDocumentFragment(location.hash)}catch(error){linkError=errorMessage(error)}
    try{
      if(linked){change(linked);setSelectedTable(linked.event.tables[0].id)}
      else{
      const raw=localStorage.getItem(STORAGE),legacy=localStorage.getItem(LEGACY)
      if(raw){const stored=editorSchema.parse(JSON.parse(raw));const next={...stored,event:rebuildEvent(stored),assignments:fillAssignments(stored.event,stored.assignments)};change(next);setSelectedTable(next.event.tables[0].id)}
      else if(legacy){
        const stored:unknown=JSON.parse(legacy)
        if(typeof stored==='object'&&stored&&'event'in stored){
          let event=eventSchema.parse(stored.event)
          if(event.tables.map(t=>t.name).join(',')==='Birch,Oak,Willow,Maple')event={...event,tables:[1,2,3].map(i=>({id:`t${i}`,name:`Table ${i}`,capacity:16})),locks:{}}
          const migrated={version:2,event,links:{},decisions:{},assignments:fillAssignments(event)} satisfies EditorDocument
          change({...migrated,event:rebuildEvent(migrated)});setSelectedTable(event.tables[0].id)
        }
      }
      }
    }catch{setError('The saved data could not be loaded. Open a saved seating link to recover it.')}
    if(linkError){pausedURL.current=current.current;setError(linkError)}
    setReady(true)
    const loadHash=()=>{
      if(urlTimer.current)clearTimeout(urlTimer.current)
      try{
        const next=decodeDocumentFragment(location.hash)
        if(next){change(next);setSelectedTable(next.event.tables[0].id);setSelectedPerson(null);setTablePopup(null);setImportOpen(false)}
      }catch(error){pausedURL.current=current.current;setError(errorMessage(error))}
    }
    window.addEventListener('hashchange',loadHash)
    return()=>window.removeEventListener('hashchange',loadHash)
  },[])
  useEffect(()=>{if(!ready)return;try{localStorage.setItem(STORAGE,JSON.stringify(editorSchema.parse(document)))}catch{setError('The change could not be saved in this browser. Copy the seating link to keep it.')}},[document,ready])
  useEffect(()=>{
    if(!ready||pausedURL.current===document)return
    const hash=location.hash
    urlTimer.current=setTimeout(()=>{
      if(current.current!==document||location.hash!==hash)return
      try{writeLink(document)}catch(error){setError(errorMessage(error))}
    },200)
    return()=>{if(urlTimer.current)clearTimeout(urlTimer.current)}
  },[document,ready])
  function writeLink(snapshot:EditorDocument){
    const url=new URL(location.href);url.hash=encodeDocumentFragment(snapshot)
    history.replaceState(history.state,'',url.href)
    return url.href
  }
  async function copyLink(){
    try{
      const url=writeLink(current.current)
      setError('')
      try{await navigator.clipboard.writeText(url)}catch{setError('Copy the complete seating link from your address bar.')}
    }catch(error){setError(errorMessage(error))}
  }
  const event=document.event,table=event.tables.find(t=>t.id===selectedTable)||event.tables[0]
  const totalSeats=event.tables.reduce((sum,t)=>sum+t.capacity,0), missingSeats=Math.max(0,event.attendees.length-totalSeats)
  const popupTable=tablePopup?event.tables.find(t=>t.id===tablePopup.id):undefined
  function selectPerson(id:string){setSelectedPerson(id);const row=rows.current?.querySelector(`[data-person-id="${CSS.escape(id)}"]`);row?.scrollIntoView({block:'nearest',behavior:'smooth'})}
  function editPerson(person:Attendee){change(updatePerson(current.current,person))}
  function setDecision(clause:Clause,decision:Decision){
    const next={...current.current,decisions:{...current.current.decisions,[referenceKey(clause)]:decision}};change({...next,event:rebuildEvent(next)})}
  function addLink(owner:string,target:string){const state=current.current,links={...state.links,[owner]:[...new Set([...(state.links[owner]||[]),target])]};change({...state,links,event:rebuildEvent({...state,links})})}
  function removeLink(owner:string,target:string){
    const state=current.current,links={...state.links,[owner]:(state.links[owner]||[]).filter(id=>id!==target)},decisions={...state.decisions}
    for(const clause of state.event.clauses)if(!isChipClause(clause)&&clause.personId===owner&&clause.kind==='prefer'&&clause.state==='resolved'&&clause.targets.length===1&&clause.targets[0]===target)decisions[referenceKey(clause)]={kind:'ignore'}
    const next={...state,links,decisions};change({...next,event:rebuildEvent(next)})
  }
  function addPerson(){
    if(event.attendees.length>=300){setError('This event supports up to 300 attendees.');return}
    const person:Attendee={id:crypto.randomUUID(),name:'New attendee',text:'',groups:[],aliases:[]}
    const next={...current.current,event:{...current.current.event,attendees:[...current.current.event.attendees,person]}}
    const updated=rebuildEvent(next);change({...next,event:updated,assignments:fillAssignments(updated,next.assignments)});setSelectedPerson(person.id);setNewPerson(person.id)
  }
  function removePerson(id:string){
    const state=current.current,locks={...state.event.locks};delete locks[id]
    const links=Object.fromEntries(Object.entries(state.links).filter(([owner])=>owner!==id).map(([owner,targets])=>[owner,targets.filter(target=>target!==id)]))
    const next={...state,links,event:{...state.event,attendees:state.event.attendees.filter(p=>p.id!==id),clauses:state.event.clauses.filter(c=>c.personId!==id),locks,separations:state.event.separations.filter(pair=>!pair.includes(id))}}
    const updated=rebuildEvent(next);change({...next,event:updated,assignments:fillAssignments(updated,next.assignments)});if(selectedPerson===id)setSelectedPerson(null)
  }
  function updateTables(count:number){if(!Number.isInteger(count)||count<1||count>60)return;const next=resizeTables(current.current,count);change(next);if(!next.event.tables.some(t=>t.id===selectedTable))setSelectedTable(next.event.tables[0].id)}
  function updateCapacity(tableId:string,capacity:number){
    if(!Number.isInteger(capacity)||capacity<1||capacity>100)return
    const state=current.current,event={...state.event,tables:state.event.tables.map(t=>t.id===tableId?{...t,capacity}:t)}
    change({...state,event,assignments:fillAssignments(event,state.assignments)})
  }
  function moveSeat(person:string,target:SeatAddress){
    try{const next=moveGuest(current.current,person,target);change(next);setSelectedPerson(person);setTablePopup(null)}catch(error){setError(errorMessage(error))}
  }
  function toggleLock(person:string,table:string){const state=current.current,locks={...state.event.locks};if(locks[person])delete locks[person];else locks[person]=table;change({...state,event:{...state.event,locks}})}
  function clearAll(){
    const next=createEmptyDocument()
    solverRequest.current++
    if(urlTimer.current)clearTimeout(urlTimer.current)
    pausedURL.current=null
    change(next);setSelectedPerson(null);setSelectedTable(next.event.tables[0].id);setTablePopup(null);setNewPerson(null);setHoveredPeople([]);setImportOpen(false);setClearOpen(false);setBusy(false);setMapVersion(version=>version+1)
    if(rows.current)rows.current.scrollTop=0
    try{localStorage.removeItem(LEGACY);localStorage.setItem(STORAGE,JSON.stringify(next));sessionStorage.removeItem(DEBUG_RUN_STORAGE);writeLink(next)}catch(error){setError(errorMessage(error))}
  }
  async function arrange(){
    const request=++solverRequest.current
    const snapshot=current.current;setBusy(true);setError('')
    try{
      const compiled=eventSchema.parse(rebuildEvent(snapshot)),unresolved=compiled.clauses.find(c=>c.state==='unresolved')
      const next={...snapshot,event:compiled};change(next)
      if(unresolved){selectPerson(unresolved.personId);setError('Map or ignore the outlined references in the input table before arranging.');return}
      const run=await optimizeSeating({data:compiled})
      if(current.current!==next)return
      rememberSolverRun(run)
      const result=run.result
      if(result.kind==='plan')change({...next,assignments:result.assignments,seatIndices:result.seatIndices});else setError(result.message)
    }catch(error){if(solverRequest.current===request)setError(errorMessage(error))}finally{if(solverRequest.current===request)setBusy(false)}
  }
  function inferNames(){
    try{const next=inferMessageNames(current.current);change(next);const ambiguous=next.event.clauses.find(c=>isInferredNameClause(c)&&c.state==='unresolved');if(ambiguous)selectPerson(ambiguous.personId)}catch(error){setError(errorMessage(error))}
  }
  function importRoster(attendees:Attendee[]){
    const event=eventSchema.parse({...current.current.event,attendees,clauses:[],locks:{},separations:[]})
    const next={version:2,event,links:{},decisions:{},assignments:fillAssignments(event)} satisfies EditorDocument
    change({...next,event:rebuildEvent(next)});setSelectedPerson(null);setNewPerson(null);setTablePopup(null);setImportOpen(false)
  }

  return <main className="split-editor">
    <section className="map-pane" aria-label="Table layout">
      {ready&&missingSeats>0&&<div className="capacity-alert" role="alert">{totalSeats} seats for {event.attendees.length} attendees. Add {missingSeats} more {missingSeats===1?'seat':'seats'}.</div>}
      <div className="map-surface">
        <label className="table-count-control">Tables<input type="number" aria-label="Number of tables" min={1} max={60} value={event.tables.length} onChange={e=>updateTables(Number(e.target.value))}/></label>
      <TableMap key={mapVersion} highlightedPeople={hoveredPeople} event={event} assignments={document.assignments} seatIndices={document.seatIndices} selectedPerson={selectedPerson} selectedTable={table.id} onPerson={selectPerson} onTable={(id,anchor)=>{setSelectedTable(id);setTablePopup({id,anchor})}} onLock={toggleLock} onMove={moveSeat}/>
      </div>
    </section>
    <section className="input-pane" aria-label="Attendee input">
      <div className="input-toolbar"><button type="button" onClick={()=>setImportOpen(true)}>Import</button><button type="button" onClick={inferNames} disabled={busy||!ready||!event.attendees.some(person=>person.text.trim())}>Infer names</button><details className="options-menu"><summary>Options</summary><div className="options-popover"><button onClick={()=>void copyLink()}>Copy link</button><button onClick={()=>{const url=new URL(writeLink(current.current));url.pathname='/debug';location.assign(url.href)}}>Solver debug</button><label>Optimize for<select value={event.objective} onChange={e=>{const value=e.target.value;if(value==='balanced'||value==='preferences'||value==='fairness')change({...document,event:{...event,objective:value}})}}><option value="balanced">Balanced</option><option value="preferences">Most preferences</option><option value="fairness">Fairness</option></select></label>{Object.keys(event.locks).length>0&&<button onClick={()=>change({...document,event:{...event,locks:{}}})}>Release locked placements</button>}{event.separations.length>0&&<button onClick={()=>change({...document,event:{...event,separations:[]}})}>Clear mandatory separations</button>}<button onClick={()=>{const next={...document,decisions:{}};change({...next,event:rebuildEvent(next)})}}>Reset text mappings</button><button type="button" className="clear-state-button" onClick={e=>{e.currentTarget.closest('details')?.removeAttribute('open');setClearOpen(true)}}>Clear all</button></div></details><button type="button" className="arrange-button" onClick={arrange} disabled={busy||!ready||!event.attendees.length||missingSeats>0}>{busy?'Arranging…':'Arrange'}</button></div>
      <div className="attendee-scroll" ref={rows}><table className="attendee-grid"><colgroup><col className="name-column"/><col className="message-column"/><col className="connections-column"/></colgroup><thead><tr><th scope="col">Name</th><th scope="col">Preference message</th><th scope="col">Names / codes</th></tr></thead><tbody>{event.attendees.map(person=><AttendeeRow key={person.id} person={person} document={document} selected={selectedPerson===person.id} onHover={setHoveredPeople} onSelect={()=>setSelectedPerson(person.id)} onUpdate={editPerson} onRemove={()=>removePerson(person.id)} onLink={target=>addLink(person.id,target)} onRemoveLink={target=>removeLink(person.id,target)} onDecision={setDecision} autoFocus={newPerson===person.id}/>)}</tbody></table><button className="add-bottom-row" onClick={addPerson} disabled={event.attendees.length>=300}>Add row</button></div>
    </section>
    {clearOpen&&<ClearDialog onClear={clearAll} onClose={()=>setClearOpen(false)}/>}
    {importOpen&&<ImportDialog onImport={importRoster} onClose={()=>setImportOpen(false)}/>}
    {tablePopup&&popupTable&&<AnchoredPopover anchor={tablePopup.anchor} placement="beside" label={`Seats for ${popupTable.name}`} onClose={()=>setTablePopup(null)}><SeatCountEditor key={popupTable.id} capacity={popupTable.capacity} onRotate={()=>change(rotateTable(current.current,popupTable.id))} onApply={capacity=>{updateCapacity(popupTable.id,capacity);setTablePopup(null)}} onClose={()=>setTablePopup(null)}/></AnchoredPopover>}
    {error&&<div className="error-dialog" role="alert"><p>{error}</p><button onClick={()=>setError('')}>Close</button></div>}
  </main>
}

function SeatCountEditor({capacity,onRotate,onApply,onClose}:{capacity:number;onRotate:()=>void;onApply:(capacity:number)=>void;onClose:()=>void}){
  const [value,setValue]=useState(String(capacity))
  return <form className="seat-count-editor" onSubmit={e=>{e.preventDefault();const count=Number(value);if(Number.isInteger(count)&&count>=1&&count<=100)onApply(count)}}><label>Seats<input type="number" aria-label="Seats in selected table" value={value} onChange={e=>setValue(e.target.value)} min={1} max={100} required/></label><button type="button" className="rotate-table-button" onClick={onRotate}>Rotate 90°</button><div className="popover-actions"><button type="submit">Apply</button><button type="button" onClick={onClose}>Close</button></div></form>
}
