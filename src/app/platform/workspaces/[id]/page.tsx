import type {Metadata} from 'next';
import {WorkspaceDetailScreen} from '@/features/platform/workspace-detail';
export const metadata:Metadata={title:'Administrar workspace'};
export default async function WorkspacePage({params}:PageProps<'/platform/workspaces/[id]'>){const {id}=await params;return<WorkspaceDetailScreen workspaceId={id}/>;}
