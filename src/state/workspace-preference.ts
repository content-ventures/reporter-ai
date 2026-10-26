'use client';
import {parseWorkspacePreference,workspacePreferenceKey,type WorkspacePreference} from '../domain/workspace-preference.ts';
export function lastWorkspace(accountId:string):WorkspacePreference|undefined{
  try{return parseWorkspacePreference(window.localStorage.getItem(workspacePreferenceKey(accountId)));}catch{return undefined;}
}
export function rememberWorkspace(accountId:string,value:WorkspacePreference){
  try{window.localStorage.setItem(workspacePreferenceKey(accountId),JSON.stringify(value));}catch{/* Navigation remains available without storage. */}
}
