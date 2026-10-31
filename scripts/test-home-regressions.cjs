/* eslint-disable @typescript-eslint/no-require-imports -- React/DOM regression harness. */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { JSDOM } = require(process.env.DISCORD2_JSDOM_MODULE || '/tmp/discord2-integration/node_modules/jsdom');
const makeLoader = require('./test-support/load-typescript.cjs');
const dom = new JSDOM('<div id="root"></div>', {url:'https://d2.test', pretendToBeVisual:true});
for (const key of ['window','document','HTMLElement','HTMLInputElement','Event']) global[key]=dom.window[key];
global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react');
const {act}=React;
const {createRoot}=require('react-dom/client');
let captcha, resets, routes;
const Turnstile=React.forwardRef(function TestVerification(props, ref) {
  captcha=props;
  React.useImperativeHandle(ref,()=>({reset(){resets++;}}));
  return React.createElement('div',{'data-testid':'security-widget'});
});
const load=makeLoader({
  'next/navigation':{useRouter:()=>({push:path=>routes.push(path)})},
  '@marsidev/react-turnstile':{Turnstile},
  './home.module.css':{__esModule:true,default:new Proxy({}, {get:(_,name)=>String(name)})},
});
const Entry=load('src/components/home/RoomEntry.tsx').default;
const room='a'.repeat(64);
async function mount(){
  resets=0;routes=[];
  const root=createRoot(document.getElementById('root'));
  await act(async()=>root.render(React.createElement(Entry)));
  return async()=>act(async()=>root.unmount());
}
function create(){return document.querySelector('section button');}
function submit(value){
  const input=document.querySelector('input');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);
  input.dispatchEvent(new Event('input',{bubbles:true}));
}

test('creation remains blocked until verification, expires and reports widget failures',async()=>{
  const cleanup=await mount();
  try{
    assert.ok(create().disabled);
    assert.match(create().textContent,/Aguardando verificação/);
    assert.ok(document.querySelector('[data-testid="security-widget"]'));
    await act(async()=>captcha.onSuccess('verified-fixture'));
    assert.equal(create().disabled,false);
    assert.equal(create().textContent,'Criar sala');
    for(const callback of ['onExpire','onError','onTimeout']){
      await act(async()=>captcha[callback]());
      assert.ok(create().disabled);
      await act(async()=>captcha.onSuccess('verified-fixture'));
    }
  }finally{await cleanup();}
});
test('creation sends the existing request once, shows loading and resets single-use token',async()=>{
  const cleanup=await mount();
  try{
    let resolve;const pending=new Promise(r=>{resolve=r;});const calls=[];
    global.fetch=(...args)=>{calls.push(args);return pending;};
    await act(async()=>captcha.onSuccess('verified-fixture'));
    await act(async()=>create().click());
    assert.ok(create().disabled);
    assert.match(create().textContent,/Criando sala/);
    await act(async()=>create().click());
    assert.equal(calls.length,1);
    assert.equal(calls[0][0],'/api/rooms/create');
    assert.equal(calls[0][1].method,'POST');
    assert.equal(calls[0][1].cache,'no-store');
    assert.deepEqual(JSON.parse(calls[0][1].body),{turnstileToken:'verified-fixture'});
    await act(async()=>resolve({ok:true,json:async()=>({roomId:room})}));
    assert.deepEqual(routes,[`/sala/${room}`]);
    assert.equal(resets,1);
    assert.ok(create().disabled);
  }finally{await cleanup();}
});
test('server rate-limit errors and malformed successful invites remain visible and fail closed',async()=>{
  for(const response of [
    {ok:false,json:async()=>({error:'Muitas tentativas. Tente novamente em instantes.'})},
    {ok:true,json:async()=>({roomId:'https://evil.test/'})},
  ]){
    const cleanup=await mount();
    try{
      global.fetch=async()=>response;
      await act(async()=>captcha.onSuccess('verified-fixture'));
      await act(async()=>create().click());
      assert.ok(document.querySelector('[role="alert"]'));
      assert.deepEqual(routes,[]);
      assert.equal(resets,1);
      assert.ok(create().disabled);
    }finally{await cleanup();}
  }
});
test('invite validation rejects external links and accepts IDs and same-origin links',async()=>{
  for(const [value, valid] of [[`https://evil.test/sala/${room}`,false],['invalid',false],
    [room,true],[`https://d2.test/sala/${room}`,true]]){
    const cleanup=await mount();
    try{
      await act(async()=>submit(value));
      await act(async()=>document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
      if(valid){assert.deepEqual(routes,[`/sala/${room}`]);assert.ok(document.querySelector('input').disabled);}
      else{assert.deepEqual(routes,[]);assert.equal(document.querySelector('input').getAttribute('aria-invalid'),'true');}
    }finally{await cleanup();}
  }
});
