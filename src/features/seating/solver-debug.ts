import { z } from 'zod'
import { eventSchema, resultSchema } from './model'

export const objectiveNameSchema=z.enum(['Use fewer tables','Fill tables','Avoid unwanted pairings','Prioritize named companions','Keep mutual groups together','Protect least satisfied guests','Give guests a companion','Improve companion matches','Weighted requests','Place nearby companions'])
export type ObjectiveName=z.infer<typeof objectiveNameSchema>
export const SOLVER_VERSION=8
export const solverStageSchema=z.object({
  objective:objectiveNameSchema,status:z.string(),value:z.number().nullable(),frozen:z.boolean(),
  assignments:z.record(z.string(),z.string()).nullable(),
  seatIndices:z.record(z.string(),z.number().int().min(0).max(99)).optional(),
  centralityCost:z.number().nonnegative().optional(),
  coveredGuests:z.number().int().nonnegative().optional(),
  blockCost:z.number().nonnegative().optional(),
  cliqueSearch:z.object({cliques:z.array(z.array(z.string())),truncated:z.boolean()}).optional(),
})
export const solverRunSchema=z.object({
  engineVersion:z.literal(SOLVER_VERSION),
  event:eventSchema,
  result:z.union([resultSchema,z.object({kind:z.literal('error'),message:z.string()})]),
  stages:z.array(solverStageSchema),
})
export type SolverStage=z.infer<typeof solverStageSchema>
export type SolverRun=z.infer<typeof solverRunSchema>
export const DEBUG_RUN_STORAGE='plassitin.debug.run.v1'

export function rememberSolverRun(run:SolverRun){
  try{sessionStorage.setItem(DEBUG_RUN_STORAGE,JSON.stringify(run))}catch{/* Diagnostics must not interrupt seating. */}
}
