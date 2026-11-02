import { isTagPreference, weightedClauses } from './model'
import type { SeatingEvent } from './model'
import { seatBlockCost, seatPreferenceBlocks } from './seat-blocks'

export function seatProximity(a:number,b:number):0|1|2|4{
  if(a===b)return 0
  const row=Math.abs(Math.floor(a/2)-Math.floor(b/2)),sameSide=a%2===b%2
  return row===0&&!sameSide?4:row===1?(sameSide?2:1):0
}
export function seatRelation(a:number,b:number){
  switch(seatProximity(a,b)){case 4:return 'Opposite seats';case 2:return 'Adjacent on the same side';case 1:return 'Diagonal seats';default:return 'Same table, farther apart'}
}

type Alternative={owner:number;targets:number[];weight:number}
type SeatQuality={covered:number;blockCost:number;score:number;centralityCost:number}
function compareQuality(a:SeatQuality,b:SeatQuality,protectCoverage:boolean){
  if(protectCoverage&&a.covered!==b.covered)return a.covered-b.covered
  if(a.blockCost!==b.blockCost)return b.blockCost-a.blockCost
  if(a.score!==b.score)return a.score-b.score
  return b.centralityCost-a.centralityCost
}
function centralRequests(requests:ReturnType<typeof weightedClauses>,assignments:Record<string,string>){
  const named=requests.filter(({clause})=>clause.kind==='prefer'&&!isTagPreference(clause)&&clause.targets.length===1&&assignments[clause.personId]===assignments[clause.targets[0]])
  const requesters=new Map<string,Set<string>>()
  for(const {clause} of named){const target=clause.targets[0],owners=requesters.get(target)??new Set<string>();owners.add(clause.personId);requesters.set(target,owners)}
  return requests.filter(({clause})=>clause.kind==='prefer'&&clause.targets.length===1&&assignments[clause.personId]===assignments[clause.targets[0]]&&(isTagPreference(clause)||(requesters.get(clause.targets[0])?.size??0)>1))
}
const rowDistance=(a:number,b:number)=>(Math.floor(a/2)-Math.floor(b/2))**2

function tableModel(event:SeatingEvent,tableId:string,assignments:Record<string,string>,requests:ReturnType<typeof weightedClauses>){
  const members=event.attendees.filter(p=>assignments[p.id]===tableId).map(p=>p.id),index=new Map(members.map((id,i)=>[id,i]))
  const pairs=members.map(()=>members.map(()=>0)),alternatives:Alternative[]=[],companions=members.map(()=>new Set<number>())
  for(const {clause,weight} of requests){
    const owner=index.get(clause.personId);if(owner===undefined)continue
    const targets=clause.targets.flatMap(id=>{const target=index.get(id);return target===undefined?[]:[target]})
    if(clause.kind==='prefer')for(const target of targets)companions[owner].add(target)
    const value=weight*(clause.kind==='prefer'?1:-1)
    if(targets.length===1){pairs[owner][targets[0]]+=value;pairs[targets[0]][owner]+=value}
    else if(targets.length>1)alternatives.push({owner,targets,weight:value})
  }
  const centers=members.map(()=>members.map(()=>0))
  for(const {clause,weight} of centralRequests(requests,assignments)){
    const owner=index.get(clause.personId),target=index.get(clause.targets[0]);if(owner===undefined||target===undefined)continue
    centers[owner][target]+=weight;centers[target][owner]+=weight
  }
  return{members,pairs,alternatives,centers,companions:companions.map(targets=>[...targets])}
}
export function scoreSeatCoverage(event:SeatingEvent,assignments:Record<string,string>,indices:Record<string,number>){
  return new Set(event.clauses.flatMap(clause=>clause.state==='resolved'&&clause.kind==='prefer'&&clause.targets.some(id=>assignments[id]===assignments[clause.personId]&&seatProximity(indices[clause.personId],indices[id])>0)?[clause.personId]:[])).size
}
export function scoreSeatCentrality(event:SeatingEvent,assignments:Record<string,string>,indices:Record<string,number>){
  return centralRequests(weightedClauses(event),assignments).reduce((sum,{clause,weight})=>sum+weight*rowDistance(indices[clause.personId],indices[clause.targets[0]]),0)
}
export function scoreSeatPlan(event:SeatingEvent,assignments:Record<string,string>,indices:Record<string,number>){
  return weightedClauses(event).reduce((sum,{clause,weight})=>{
    const owner=indices[clause.personId]
    const quality=Math.max(0,...clause.targets.map(id=>assignments[id]===assignments[clause.personId]?seatProximity(owner,indices[id]):0))
    return sum+weight*quality*(clause.kind==='prefer'?1:-1)
  },0)
}

export function placeSeats(event:SeatingEvent,assignments:Record<string,string>,deadline:number){
  const requests=weightedClauses(event),preferenceBlocks=seatPreferenceBlocks(event),seatIndices:Record<string,number>={}
  const tables=event.tables.filter(t=>event.attendees.some(p=>assignments[p.id]===t.id))
  let score=0,centralityCost=0,blockCost=0,coveredGuests=0,optimalWithinTables=true
  const protectCoverage=event.objective!=='preferences'
  for(const [tableIndex,table] of tables.entries()){
    const {members,pairs,alternatives,centers,companions}=tableModel(event,table.id,assignments,requests)
    const memberIndex=new Map(members.map((id,index)=>[id,index]))
    const blocks=preferenceBlocks.map(group=>({weight:group.weight,members:group.members.flatMap(id=>{const index=memberIndex.get(id);return index===undefined?[]:[index]})})).filter(group=>group.members.length>=3)
    const blockPositions=(positions:number[])=>blocks.reduce((sum,group)=>sum+seatBlockCost(group,person=>positions[person]),0)
    const hasCentering=centers.some(row=>row.some(weight=>weight>0))
    const proximity=members.map((_,a)=>members.map((_,b)=>seatProximity(a,b)))
    const tableDeadline=performance.now()+Math.max(0,deadline-performance.now())/(tables.length-tableIndex)
    const initial=members.map((_,i)=>i)
    const altValue=(alt:Alternative,positions:number[])=>alt.weight*Math.max(0,...alt.targets.map(target=>proximity[positions[alt.owner]][positions[target]]))
    const scorePositions=(positions:number[])=>{
      let value=0
      for(let a=0;a<members.length;a++)for(let b=a+1;b<members.length;b++)value+=pairs[a][b]*proximity[positions[a]][positions[b]]
      return value+alternatives.reduce((sum,alt)=>sum+altValue(alt,positions),0)
    }
    const centerCost=(positions:number[])=>{
      let value=0
      for(let a=0;a<members.length;a++)for(let b=a+1;b<members.length;b++)value+=centers[a][b]*rowDistance(positions[a],positions[b])
      return value
    }
    const covered=(person:number,position:(id:number)=>number)=>companions[person].some(target=>proximity[position(person)][position(target)]>0)
    const coverage=(positions:number[])=>companions.reduce((sum,_,person)=>sum+Number(covered(person,id=>positions[id])),0)
    const coverageBound=companions.filter(targets=>targets.length>0).length
    const quality=(positions:number[]):SeatQuality=>({covered:coverage(positions),blockCost:blockPositions(positions),score:scorePositions(positions),centralityCost:centerCost(positions)})
    let best=initial,bestQuality=quality(initial)
    const retain=(positions:number[],candidate:SeatQuality)=>{if(compareQuality(candidate,bestQuality,protectCoverage)>0){best=[...positions];bestQuality=candidate}}
    let upperBound=alternatives.reduce((sum,alt)=>sum+Math.max(0,alt.weight)*4,0)
    for(let a=0;a<members.length;a++)for(let b=a+1;b<members.length;b++)upperBound+=Math.max(0,pairs[a][b])*4
    const atBound=()=>bestQuality.score===upperBound&&bestQuality.centralityCost===0&&bestQuality.blockCost===0&&(!protectCoverage||bestQuality.covered===coverageBound)
    let proven=atBound()
    if(!proven&&members.length<=8){
      const positions=members.map(()=>-1)
      let ticks=0,complete=true
      const visit=(seat:number,remaining:number[])=>{
        if(!complete||atBound())return
        if((ticks++%256)===0&&performance.now()>=tableDeadline){complete=false;return}
        if(seat===members.length){retain(positions,quality(positions));return}
        for(const member of remaining){positions[member]=seat;visit(seat+1,remaining.filter(id=>id!==member));positions[member]=-1}
      }
      visit(0,members.map((_,i)=>i))
      proven=complete||atBound()
    }else if(!proven){
      const affected=members.map((_,person)=>alternatives.flatMap((alt,index)=>alt.owner===person||alt.targets.includes(person)?[index]:[]))
      const coverageAffected=members.map((_,person)=>companions.flatMap((targets,owner)=>owner===person||targets.includes(person)?[owner]:[]))
      const blockAffected=members.map((_,person)=>blocks.flatMap((group,index)=>group.members.includes(person)?[index]:[]))
      const affinity=pairs.map(row=>row.map(weight=>Math.max(0,weight)))
      for(const alt of alternatives)if(alt.weight>0)for(const target of alt.targets){affinity[alt.owner][target]+=alt.weight/alt.targets.length;affinity[target][alt.owner]+=alt.weight/alt.targets.length}
      const grouped:number[]=[],remaining=new Set(members.map((_,i)=>i))
      while(remaining.size){
        let chosen=-1,connection=-1,degree=-1
        for(const person of remaining){
          const value=grouped.slice(-6).reduce((sum,other,index)=>sum+affinity[person][other]*(index+1),0)
          const potential=[...remaining].reduce((sum,other)=>sum+affinity[person][other],0)
          if(value>connection||value===connection&&potential>degree){chosen=person;connection=value;degree=potential}
        }
        grouped.push(chosen);remaining.delete(chosen)
      }
      let seed=0x9e3779b9^members.length
      const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/4294967296}
      for(let restart=0;restart<5&&performance.now()<tableDeadline;restart++){
        const slots=restart===0?[...grouped]:members.map((_,i)=>i)
        if(restart>1)for(let i=slots.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[slots[i],slots[j]]=[slots[j],slots[i]]}
        const positions=members.map(()=>0);slots.forEach((person,seat)=>{positions[person]=seat})
        const altValues=alternatives.map(alt=>altValue(alt,positions))
        const blockValues=blocks.map(group=>seatBlockCost(group,person=>positions[person]))
        const coveredPeople=members.map((_,person)=>covered(person,id=>positions[id]))
        let value=scorePositions(positions),cost=centerCost(positions),blocksCost=blockValues.reduce((sum,value)=>sum+value,0),count=coveredPeople.filter(Boolean).length
        retain(positions,{covered:count,blockCost:blocksCost,score:value,centralityCost:cost})
        for(let iteration=0;iteration<80&&performance.now()<tableDeadline;iteration++){
          let gain:SeatQuality={covered:0,blockCost:0,score:0,centralityCost:0},chosenA=-1,chosenB=-1
          for(let a=0;a<slots.length&&performance.now()<tableDeadline;a++)for(let b=a+1;b<slots.length&&performance.now()<tableDeadline;b++){
            const personA=slots[a],personB=slots[b]
            let delta=0,centerDelta=0
            for(let other=0;other<members.length;other++)if(other!==personA&&other!==personB){
              const seat=positions[other]
              delta+=pairs[personA][other]*(proximity[b][seat]-proximity[a][seat])
              delta+=pairs[personB][other]*(proximity[a][seat]-proximity[b][seat])
              if(hasCentering){
                centerDelta+=centers[personA][other]*(rowDistance(a,seat)-rowDistance(b,seat))
                centerDelta+=centers[personB][other]*(rowDistance(b,seat)-rowDistance(a,seat))
              }
            }
            const impacted=new Set([...affected[personA],...affected[personB]])
            const after=(person:number)=>person===personA?b:person===personB?a:positions[person]
            const coverageDelta=protectCoverage?[...new Set([...coverageAffected[personA],...coverageAffected[personB]])].reduce((sum,person)=>sum+Number(covered(person,after))-Number(coveredPeople[person]),0):0
            const blockDelta=[...new Set([...blockAffected[personA],...blockAffected[personB]])].reduce((sum,index)=>sum+seatBlockCost(blocks[index],after)-blockValues[index],0)
            for(const index of impacted){const alt=alternatives[index];delta+=alt.weight*Math.max(0,...alt.targets.map(target=>proximity[after(alt.owner)][after(target)]))-altValues[index]}
            const candidate={covered:coverageDelta,blockCost:blockDelta,score:delta,centralityCost:-centerDelta}
            if(compareQuality(candidate,gain,protectCoverage)>0){gain=candidate;chosenA=a;chosenB=b}
          }
          if(chosenA<0)break
          const personA=slots[chosenA],personB=slots[chosenB]
          slots[chosenA]=personB;slots[chosenB]=personA
          positions[personA]=chosenB
          positions[personB]=chosenA
          for(const index of new Set([...affected[personA],...affected[personB]]))altValues[index]=altValue(alternatives[index],positions)
          for(const person of new Set([...coverageAffected[personA],...coverageAffected[personB]]))coveredPeople[person]=covered(person,id=>positions[id])
          for(const index of new Set([...blockAffected[personA],...blockAffected[personB]]))blockValues[index]=seatBlockCost(blocks[index],person=>positions[person])
          value+=gain.score;cost+=gain.centralityCost;blocksCost+=gain.blockCost;count=coveredPeople.filter(Boolean).length
          retain(positions,{covered:count,blockCost:blocksCost,score:value,centralityCost:cost})
          if(atBound())break
        }
        if(atBound()){proven=true;break}
      }
    }
    members.forEach((id,index)=>{seatIndices[id]=best[index]})
    score+=bestQuality.score;centralityCost+=bestQuality.centralityCost;blockCost+=bestQuality.blockCost;coveredGuests+=bestQuality.covered;optimalWithinTables=optimalWithinTables&&proven
  }
  return{seatIndices,score,centralityCost,blockCost,coveredGuests,optimalWithinTables}
}
