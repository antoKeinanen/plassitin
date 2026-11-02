import { useEffect, useMemo, useRef, useState } from 'react'
import { createEmptyDocument, editorSchema, rebuildEvent } from './editor'
import type { EditorDocument } from './editor'
import { decodeDocumentFragment, encodeDocumentFragment } from './url-state'
import { optimizeSeating } from './actions'
import { DEBUG_RUN_STORAGE, rememberSolverRun, solverRunSchema } from './solver-debug'
import type { SolverRun } from './solver-debug'
import { constraintNetwork, rulePeople, ruleResolution } from './debug-network'
import type { NetworkRule } from './debug-network'
import { DebugGraph } from './debug-graph'
import { eventSchema } from './model'
import { resolveSeatIndices } from './seat-placement'

const kindLabels:Record<NetworkRule['kind'],string>={tag:'Shared tag',clique:'Mutual group',prefer:'Companion',avoid:'Avoidance',separation:'Mandatory separation',lock:'Locked table',capacity:'Capacity',assignment:'Seat assignment',unresolved:'Unmapped',ignored:'Ignored'}
function replayStage(run:SolverRun){let index=run.stages.length-1;while(index>0&&!run.stages[index].assignments)index--;return index}
export function DebugWorkspace(){
  const [document,setDocument]=useState<EditorDocument|null>(null),[run,setRun]=useState<SolverRun|null>(null)
  const [stageIndex,setStageIndex]=useState(-1),[pane,setPane]=useState<'constraints'|'steps'>('constraints')
  const [selectedRule,setSelectedRule]=useState<string|null>(null),[selectedPerson,setSelectedPerson]=useState<string|null>(null)
  const [query,setQuery]=useState(''),[filter,setFilter]=useState('all'),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const current=useRef<EditorDocument|null>(null)
  useEffect(()=>{
    const load=()=>{
      try{
        let next=decodeDocumentFragment(location.hash)
        if(!next){const raw=localStorage.getItem('plassitin.editor.v2');if(raw)next=editorSchema.parse(JSON.parse(raw))}
        if(!next)next=createEmptyDocument()
        next={...next,event:eventSchema.parse(rebuildEvent(next))}
        current.current=next;setDocument(next);setRun(null);setStageIndex(-1);setSelectedRule(null);setSelectedPerson(null);setError('')
        try{
          const saved=sessionStorage.getItem(DEBUG_RUN_STORAGE)
          if(saved){const parsed=solverRunSchema.parse(JSON.parse(saved));if(JSON.stringify(parsed.event)===JSON.stringify(next.event)){setRun(parsed);setStageIndex(replayStage(parsed))}}
        }catch{/* A stale trace does not invalidate the seating document. */}
      }catch(error){setError(error instanceof Error?error.message:'The seating document could not be loaded.')}
    }
    load();window.addEventListener('hashchange',load)
    return()=>window.removeEventListener('hashchange',load)
  },[])
  const event=run?.event||document?.event
  const rules=useMemo(()=>event?constraintNetwork(event):[],[event])
  const stage=stageIndex>=0?run?.stages[stageIndex]:undefined
  const assignments=stageIndex>=0?(stage?.assignments||{}):(document?.assignments||{})
  const seatIndices=stageIndex>=0?stage?.seatIndices:event?resolveSeatIndices(event,assignments,document?.seatIndices):undefined
  const visibleRules=event?rules.filter(rule=>{
    const people=rulePeople(rule,event,assignments)
    const search=[rule.label,...people.map(id=>event.attendees.find(p=>p.id===id)?.name||'')].join(' ').toLocaleLowerCase()
    return (!query||search.includes(query.toLocaleLowerCase()))&&(!selectedPerson||people.includes(selectedPerson))&&(filter==='all'||filter==='unmet'&&ruleResolution(rule,event,assignments,seatIndices).satisfied===false||rule.kind===filter)
  }):[]
  async function runSolver(){
    const snapshot=current.current;if(!snapshot)return
    setBusy(true);setError('')
    try{
      const next=solverRunSchema.parse(await optimizeSeating({data:snapshot.event}))
      if(current.current!==snapshot)return
      setRun(next);setStageIndex(replayStage(next));rememberSolverRun(next)
      if(next.result.kind!=='plan')setError(next.result.message)
    }catch(error){setError(error instanceof Error?error.message:'The solver could not run.')}finally{setBusy(false)}
  }
  const selectRule=(id:string)=>{setSelectedRule(selectedRule===id?null:id);setSelectedPerson(null);setPane('constraints')}
  const selectPerson=(id:string)=>{setSelectedPerson(selectedPerson===id?null:id);setSelectedRule(null);setPane('constraints')}
  const editorHref=useMemo(()=>{try{return document?'/'+encodeDocumentFragment(document):'/'}catch{return '/'}},[document])
  return <main className="split-editor debug-workspace">
    <section className="map-pane" aria-label="Constraint network">
      <div className="map-surface">
        {event&&<DebugGraph event={event} assignments={assignments} seatIndices={seatIndices} rules={rules} visibleRules={visibleRules} selectedRule={selectedRule} selectedPerson={selectedPerson} onRule={selectRule} onPerson={selectPerson}/>}
        <label className="debug-stage-control">Show<select aria-label="Solver stage" value={stageIndex} onChange={e=>setStageIndex(Number(e.target.value))}><option value={-1}>Current seating</option>{run?.stages.map((step,index)=><option key={index} value={index}>{step.objective}</option>)}</select></label>
        {(selectedRule||selectedPerson)&&<button className="debug-clear" onClick={()=>{setSelectedRule(null);setSelectedPerson(null)}}>Clear selection</button>}
      </div>
    </section>
    <section className="input-pane" aria-label="Solver inspection">
      <div className="input-toolbar"><a className="debug-editor-link" href={editorHref}>Seating editor</a><button className="arrange-button" disabled={busy||!document} onClick={()=>void runSolver()}>{busy?'Running…':'Run solver'}</button></div>
      <div className="debug-tabs"><button aria-pressed={pane==='constraints'} onClick={()=>setPane('constraints')}>Constraints</button><button aria-pressed={pane==='steps'} onClick={()=>setPane('steps')}>Solver steps</button></div>
      {pane==='constraints'?<>
        <div className="debug-filters"><input aria-label="Find a name or tag" placeholder="Find a name or tag" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="Constraint type" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All constraints</option><option value="unmet">Unmet constraints</option>{Object.entries(kindLabels).map(([kind,label])=><option value={kind} key={kind}>{label}</option>)}</select></div>
        <div className="debug-table-scroll"><table className="debug-rules"><thead><tr><th scope="col">Rule</th><th scope="col">Constraint</th><th scope="col">Resolution</th></tr></thead><tbody>
          {event&&visibleRules.map(rule=>{const resolution=ruleResolution(rule,event,assignments,seatIndices);return <RuleRow key={rule.id} rule={rule} resolution={resolution} selected={selectedRule===rule.id} onSelect={()=>selectRule(rule.id)} members={rulePeople(rule,event,assignments).map(id=>({id,name:event.attendees.find(p=>p.id===id)?.name||id,table:event.tables.find(t=>t.id===assignments[id])?.name||'Unassigned'}))} onPerson={selectPerson}/>})}
          {!visibleRules.length&&<tr><td colSpan={3}><button className="debug-empty-action" onClick={()=>{setQuery('');setFilter('all');setSelectedPerson(null);setSelectedRule(null)}}>Show all constraints</button></td></tr>}
        </tbody></table></div>
      </>:<div className="debug-table-scroll"><table className="debug-steps"><thead><tr><th scope="col">Objective</th><th scope="col">Solver outcome</th><th scope="col">Following steps</th></tr></thead><tbody>
        {run?.stages.map((step,index)=><tr className={stageIndex===index?'selected-row':''} key={index}><td><button onClick={()=>setStageIndex(index)} aria-pressed={stageIndex===index}>{step.objective}</button></td><td>{step.status}<details><summary>Inspect objective</summary><pre>{JSON.stringify({value:step.value,centralityCost:step.centralityCost,coveredGuests:step.coveredGuests,blockCost:step.blockCost,cliqueSearch:step.cliqueSearch,proven:step.frozen},null,2)}</pre></details></td><td>{step.frozen?'Optimum fixed before continuing':'No priority fixed'}</td></tr>)}
        {!run?.stages.length&&<tr><td colSpan={3}><button className="debug-empty-action" disabled={busy||!document} onClick={()=>void runSolver()}>Run solver to inspect its steps</button></td></tr>}
      </tbody></table></div>}
    </section>
    {error&&<div className="error-dialog" role="alert"><p>{error}</p><button onClick={()=>setError('')}>Close</button></div>}
  </main>
}
function RuleRow({rule,resolution,selected,onSelect,members,onPerson}:{rule:NetworkRule;resolution:{text:string;satisfied:boolean|null};selected:boolean;onSelect:()=>void;members:{id:string;name:string;table:string}[];onPerson:(id:string)=>void}){
  return <><tr className={`${selected?'selected-row':''} ${resolution.satisfied===false?'debug-unmet':''}`}><td>{kindLabels[rule.kind]}</td><td><button className="debug-rule-button" onClick={onSelect} aria-expanded={selected}>{rule.label}</button></td><td>{resolution.text}</td></tr>{selected&&<tr className="debug-member-row"><td colSpan={3}><div className="debug-members">{members.map(person=><button key={person.id} onClick={()=>onPerson(person.id)}><span>{person.name}</span><span>{person.table}</span></button>)}</div></td></tr>}</>
}
