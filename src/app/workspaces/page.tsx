import type {Metadata} from 'next';
import {WorkspaceSelectionScreen} from '@/features/workspaces/directory-screen';
export const metadata:Metadata={title:'Escolher workspace'};
export default function WorkspaceDirectoryPage(){return<WorkspaceSelectionScreen/>;}
