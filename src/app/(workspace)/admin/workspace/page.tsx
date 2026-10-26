import type {Metadata} from 'next';
import {ClientAdministrationScreen} from '@/features/platform/workspace-detail';
export const metadata:Metadata={title:'Administrar workspace'};
export default function WorkspaceAdministrationPage(){return<ClientAdministrationScreen/>;}
