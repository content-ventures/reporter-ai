import type {Metadata} from 'next';
import {WorkspacesScreen} from '@/features/platform/workspaces-screen';
export const metadata:Metadata={title:'Workspaces'};
export default function WorkspacesPage(){return<WorkspacesScreen/>;}
