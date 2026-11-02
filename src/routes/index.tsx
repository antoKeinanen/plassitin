import { createFileRoute } from '@tanstack/react-router'
import { Workspace } from '../features/seating/workspace'

export const Route = createFileRoute('/')({ component: Workspace })
