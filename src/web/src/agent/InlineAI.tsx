import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { INLINE_AI_ACTIONS, type Block, type InlineAiRequest } from '@fortnight/shared';
import { agentApi } from '../api/agent';
import { plainText, withRich } from '../editor/adapter';
import type { PageSession } from '../editor/session';
export function InlineAI({block,session,close}:{block:Block;session:PageSession;close:()=>void}){
  const [action,setAction]=useState<InlineAiRequest['action']>(plainText(block)?'rewrite':'write'),[instruction,setInstruction]=useState(''),[text,setText]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[complete,setComplete]=useState(false);
  const abort=useRef<AbortController|null>(null),source=useRef('');
  useEffect(()=>()=>abort.current?.abort(),[]);
  async function generate(){
    setBusy(true);setError('');setText('');setComplete(false);
    try{
      await session.flush();
      const current=session.getSnapshot().blocks.find((b)=>b.id===block.id)??block;source.current=plainText(current);
      abort.current=new AbortController();
      await agentApi.inline({action,pageId:block.pageId,blockIds:[block.id],text:source.current,...(instruction?{instruction}:{})},(event)=>{
        if(event.event==='text.delta')setText((old)=>old+event.data.text);
        else if(event.event==='error')setError(event.data.message);
        else if(event.event==='done')setComplete(true);
      },abort.current.signal);
    }catch(e){if(!(e instanceof DOMException&&e.name==='AbortError'))setError(e instanceof Error?e.message:'Could not generate a draft.');}
    finally{setBusy(false);}
  }
  async function accept(){
    try{
      await session.flush();
      const current=session.getSnapshot().blocks.find((b)=>b.id===block.id);if(!current)throw new Error('This block was removed. Add a new block and try again.');
      const replaces=['rewrite','shorter','longer','fix_grammar'].includes(action);
      if(replaces&&plainText(current)!==source.current)throw new Error('This block changed. Generate again to keep your latest edits.');
      session.setSaveLabel('AI: '+action);
      if(replaces)session.setBlock(withRich(current,[{text}]));
      else session.add(current.id,'paragraph',undefined,[{text}]);
      await session.flush();close();
    }catch(e){setError(e instanceof Error?e.message:'Your draft is kept. Retry saving before leaving.');}
  }
  return <section className="inline-ai" aria-label="Inline AI"><header><strong>Ask AI</strong><button className="icon-button" aria-label="Close inline AI" onClick={close}><X size={14}/></button></header><select aria-label="AI action" value={action} disabled={busy} onChange={(e)=>{setAction(e.target.value as InlineAiRequest['action']);setComplete(false);}}>{INLINE_AI_ACTIONS.map((value)=><option value={value} key={value}>{value==='custom'?'Ask AI…':value.replaceAll('_',' ')}</option>)}</select>{(action==='write'||action==='custom')&&<input aria-label="AI instruction" placeholder="What would you like to write?" value={instruction} onChange={(e)=>setInstruction(e.target.value)} maxLength={4000}/>}<button className="db-ai-button" disabled={busy||((action==='write'||action==='custom')&&!instruction.trim())} onClick={()=>void generate()}>{busy?'Writing…':'Generate'}</button>{text&&<div className="inline-ai-preview">{text}</div>}{error&&<p className="error" role="alert">{error}</p>}<div className="inline-ai-actions">{complete&&!error&&<button className="db-ai-button" disabled={busy||!text} onClick={()=>void accept()}>Accept</button>}<button className="db-ai-button" onClick={()=>{abort.current?.abort();close();}}>Discard</button></div></section>;
}
