import { createServerFn } from '@tanstack/react-start'
import { eventSchema } from './model'

export const optimizeSeating = createServerFn({ method: 'POST' })
  .validator(eventSchema)
  .handler(async ({ data }) => {
    const { solveWithTrace } = await import('./solver.server')
    return solveWithTrace(data)
  })
