export const $ = <T extends HTMLElement>(q: string) => document.querySelector(q) as T;

export function logTo(el: HTMLTextAreaElement, msg: string){
  const t = new Date().toISOString().replace("T"," ").replace("Z","");
  el.value += `[${t}] ${msg}\n`; el.scrollTop = el.scrollHeight;
}

export function setStatus(el: HTMLElement, text: string){ el.textContent = text; }
