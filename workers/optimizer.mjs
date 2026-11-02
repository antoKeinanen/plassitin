import { parentPort, workerData } from 'node:worker_threads'
import loadHighs from 'highs'

const stages=[]
try {
  const highs=await loadHighs()
  const {model,seconds}=workerData
  const deadline=performance.now()+seconds*1000
  const frozen=[]
  let incumbent=null,proven=true
  for(const [stage,objective] of model.objectives.entries()){
    const remaining=(deadline-performance.now())/1000
    if(remaining<=0){stages.push({objective:objective.name,status:'Time limit before stage',value:null,frozen:false,values:null});proven=false;break}
    const problem=`Maximize\n obj: ${objective.expression}\nSubject To\n${[...model.constraints,...frozen].join('\n')}\nBounds\n${model.bounds.join('\n')}\nBinary\n${model.binaries.join('\n')}\nEnd`
    const result=highs.solve(problem,{time_limit:remaining,output_flag:false,mip_rel_gap:0,mip_abs_gap:0,random_seed:42})
    if(result.Status==='Infeasible'){
      stages.push({objective:objective.name,status:result.Status,value:null,frozen:false,values:null})
      if(incumbent)throw new Error('A proven optimization stage became infeasible.')
      parentPort.postMessage({kind:'infeasible',message:'The locks, capacities, and mandatory separations cannot all be satisfied. Review the hard rules.',stages});process.exit(0)
    }
    const candidate={}
    let valid=true
    for(const {variable} of model.assignmentVariables){const value=result.Columns[variable]?.Primal;if(!Number.isFinite(value)||Math.abs(value-Math.round(value))>1e-5){valid=false;break}candidate[variable]=Math.round(value)}
    const counts=new Map()
    for(const {personId,variable} of model.assignmentVariables)counts.set(personId,(counts.get(personId)||0)+(candidate[variable]||0))
    valid=valid&&[...counts.values()].every(count=>count===1)
    stages.push({objective:objective.name,status:result.Status,value:valid&&Number.isFinite(result.ObjectiveValue)?result.ObjectiveValue:null,frozen:result.Status==='Optimal'&&valid,values:valid?candidate:null})
    if(valid)incumbent=candidate
    if(result.Status!=='Optimal'){proven=false;break}
    if(!valid)throw new Error('The solver did not return integral assignments.')
    frozen.push(`priority${stage}: ${objective.expression} = ${Math.round(result.ObjectiveValue)}`)
  }
  parentPort.postMessage(incumbent?{kind:'solution',status:proven?'optimal':'feasible',values:incumbent,stages}:{kind:'timeout',message:'No seating plan was found within the time limit. Reduce hard rules or try again.',stages})
}catch(error){parentPort.postMessage({kind:'error',message:error instanceof Error?error.message:'Optimization failed.',stages})}
