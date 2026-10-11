import type { Dispatch, SetStateAction } from 'react';
export type Lang = 'en' | 'hi' | 'hn';
export interface Citation { id: number; documentId: string; name: string; sourceType: string; locationType: 'page' | 'slide' | 'time'; locationNumber: number }
export interface Msg { u?: string; answer?: string; sources?: Citation[]; load?: boolean }
export interface Chat { t: string; g: string; msgs: Msg[] }
export interface Ctx {
  chats: Chat[]; setChats: Dispatch<SetStateAction<Chat[]>>; cur: number | null; setCur: (i: number | null) => void;
  lang: Lang; toast: (t: string) => void;
  dark: boolean; setDark: (b: boolean) => void;
}
