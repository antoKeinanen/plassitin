import { createFileRoute } from '@tanstack/react-router'
import { DebugWorkspace } from '../features/seating/debug-workspace'

export const Route=createFileRoute('/debug')({component:DebugWorkspace})
