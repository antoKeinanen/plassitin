import test from 'node:test'
import assert from 'node:assert/strict'
import { searchChips } from './chip-search'

const anna={id:'anna',name:'Anna Virtanen',aliases:[],groups:['Helsinki'],text:''}
const mike={id:'mike',name:'Michael Smith',aliases:['Mike'],groups:['London'],text:''}
const attendee={id:'other',name:'Julia Nieminen',aliases:[],groups:['Helsinki'],text:''}
const search=(query:string)=>searchChips({query,person:anna,attendees:[anna,mike,attendee],excludedPersonIds:[]})

test('search offers a shared tag once and excludes tags already owned',()=>{
  assert.deepEqual(search('London').options,[{kind:'code',value:'London',label:'#London'}])
  assert.deepEqual(search('#London').options,search('London').options)
  assert.deepEqual(search('Helsinki').options,[])
})
test('from syntax has no special search or constraint behavior',()=>{
  for(const query of ['from','fro','anyone','anyone from','from Helsinki'])assert.deepEqual(search(query).options,[])
})
test('aliases remain searchable and tags are not hidden behind matching names',()=>{
  assert.ok(search('Mike').options.some(option=>option.kind==='person'&&option.value==='mike'))
  const many=Array.from({length:12},(_,i)=>({...mike,id:`person${i}`,name:`London Guest ${i}`}))
  const result=searchChips({query:'London',person:anna,attendees:[anna,...many],excludedPersonIds:[]})
  assert.ok(result.options.some(option=>option.kind==='code'&&option.value==='London'))
})
