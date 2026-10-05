import type {Dispatch,SetStateAction} from 'react';
export type Lang='en'|'hi'|'hn';
export interface Topic{n:string;m:number;pre:string[];src:string}
export interface Answer{en:string;hi:string;hn:string;f:string;p:string;q:string;v?:number}
export interface Msg{u?:string;k?:string|null;answer?:string;load?:boolean;done?:boolean|number;w?:number}
export interface Chat{t:string;g:string;msgs:Msg[]}
export interface Question{t:string;d:string;q:string;o:string[];a:number;mis?:string[]}
export interface Mock{user:string;topics:Topic[];materials:[string,string,string][];ans:Record<string,Answer>;chats:Chat[];quiz:Question[];plan:[string,string,string][]}
export interface Ctx{
  db:Mock;topics:Topic[];setTopics:(t:Topic[])=>void;
  chats:Chat[];setChats:Dispatch<SetStateAction<Chat[]>>;cur:number|null;setCur:(i:number|null)=>void;
  lang:Lang;setView:(k:string|null)=>void;toast:(t:string)=>void;
  dark:boolean;setDark:(b:boolean)=>void;
}
