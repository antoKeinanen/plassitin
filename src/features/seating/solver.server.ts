import { Worker } from 'node:worker_threads'
import { resolve } from 'node:path'
import { z } from 'zod'
import { buildOptimizationModel } from './optimizer'
import { evaluatePlan } from './model'
import type { SeatingEvent, SolveResult } from './model'
import { objectiveNameSchema, SOLVER_VERSION } from './solver-debug'
import type { SolverRun } from './solver-debug'
import { placeSeats } from './seat-optimizer'

const traceSchema=z.array(z.object({objective:objectiveNameSchema,status:z.string(),value:z.number().nullable(),frozen:z.boolean(),values:z.record(z.string(),z.number()).nullable()}))

const responseSchema=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('solution'),status:z.enum(['optimal','feasible']),values:z.record(z.string(),z.number()),stages:traceSchema}),
  z.object({kind:z.enum(['infeasible','timeout']),message:z.string(),stages:traceSchema}),
  z.object({kind:z.literal('error'),message:z.string(),stages:traceSchema}),
])

export async function solve(event: SeatingEvent, seconds=8):Promise<SolveResult>{
  const run=await solveWithTrace(event,seconds)
  if(run.result.kind==='error')throw new Error(run.result.message)
  return run.result
}

export async function solveWithTrace(event:SeatingEvent,seconds=8):Promise<SolverRun>{
  try{return await execute(event,seconds)}catch(error){return{engineVersion:SOLVER_VERSION,event,result:{kind:'error',message:error instanceof Error?error.message:'Optimization failed.'},stages:[]}}
}

async function execute(event:SeatingEvent,seconds:number):Promise<SolverRun>{
  if(event.clauses.some(c=>c.state==='unresolved'))throw new Error('Resolve or ignore every unclear request before generating a plan.')
  if(event.tables.reduce((sum,t)=>sum+t.capacity,0)<event.attendees.length)return{engineVersion:SOLVER_VERSION,event,result:{kind:'infeasible',message:'There are fewer seats than attendees. Increase table capacities.'},stages:[]}
  const model=buildOptimizationModel(event),started=performance.now()
  const tableSeconds=seconds*.75
  const raw=await new Promise<unknown>((accept,reject)=>{
    const worker=new Worker(resolve('workers/optimizer.mjs'),{workerData:{model,seconds:tableSeconds}})
    const timeout=setTimeout(()=>{void worker.terminate();reject(new Error('Optimization exceeded its time limit. Try fewer broad group requests.'))},(tableSeconds+5)*1000)
    worker.once('message',message=>{clearTimeout(timeout);void worker.terminate();accept(message)})
    worker.once('error',error=>{clearTimeout(timeout);reject(error)})
    worker.once('exit',code=>{clearTimeout(timeout);if(code!==0)reject(new Error('The optimization worker stopped unexpectedly.'))})
  })
  const result=responseSchema.parse(raw)
  const decode=(values:Record<string,number>)=>{
    const assignments:Record<string,string>={}
    for(const {variable,personId,tableId} of model.assignmentVariables)if(values[variable]===1){
      if(assignments[personId])throw new Error('The solver assigned more than one table to a guest.')
      assignments[personId]=tableId
    }
    const report=evaluatePlan(event,assignments)
    if(report.violations.length)throw new Error(`Solver returned an invalid plan: ${report.violations.join(' ')}`)
    return assignments
  }
  const stages=result.stages.map(stage=>({objective:stage.objective,status:stage.status,value:stage.value,frozen:stage.frozen,assignments:stage.values?decode(stage.values):null,...(stage.objective==='Keep mutual groups together'?{cliqueSearch:model.cliqueSearch}:{})}))
  if(result.kind!=='solution')return{engineVersion:SOLVER_VERSION,event,result:{kind:result.kind,message:result.message},stages}
  const assignments=decode(result.values),placement=placeSeats(event,assignments,started+seconds*1000)
  const report=evaluatePlan(event,assignments,placement.seatIndices)
  if(report.violations.length)throw new Error(`Seat placement returned an invalid plan: ${report.violations.join(' ')}`)
  return{engineVersion:SOLVER_VERSION,event,result:{kind:'plan',status:result.status,assignments,seatIndices:placement.seatIndices,seconds:(performance.now()-started)/1000},stages:[...stages,{
    objective:'Place nearby companions',status:placement.optimalWithinTables?'Optimal within assigned tables':'Bounded improvement within assigned tables',value:placement.score,centralityCost:placement.centralityCost,blockCost:placement.blockCost,coveredGuests:placement.coveredGuests,frozen:false,assignments,seatIndices:placement.seatIndices,
  }]}
}
