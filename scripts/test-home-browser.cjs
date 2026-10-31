/* eslint-disable @typescript-eslint/no-require-imports -- Optional browser tooling, never shipped to production. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.D2_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.D2_HOME_BASE_URL || 'http://127.0.0.1:3221';
const output = path.resolve(process.env.D2_HOME_EVIDENCE || 'evidence/d2-home');
const room = 'a'.repeat(64);
(async()=>{
  fs.mkdirSync(output,{recursive:true});
  const browser = await chromium.launch({headless:true});
  const context = await browser.newContext({viewport:{width:1440,height:1000},locale:'pt-BR'});
  const page = await context.newPage();
  const report={realBrowser:true, livekitRequests:0, screenshots:[], turnstile:'official visible test sitekey; no production settings changed'};
  await context.route('**/api/livekit/**', route=>{report.livekitRequests++;return route.abort();});
  try{
    await page.goto(base,{waitUntil:'networkidle'});
    await page.getByRole('heading',{name:'D2',exact:true}).waitFor();
    assert.equal(await page.title(),'D2 · Salas privadas para assistir juntos');
    assert.doesNotMatch(await page.locator('body').innerText(),/discord/i);
    assert.equal(await page.locator('main img, main video, main canvas').count(),0);
    const create = page.getByRole('button',{name:'Criar sala',exact:true});
    await create.waitFor({timeout:45000});
    assert.equal(await create.isEnabled(),true);
    report.realTurnstileTestWidgetPassed=true;
    for(const [label,width,height] of [['desktop',1440,1000],['mobile',390,844],['small-mobile',320,740]]){
      await page.setViewportSize({width,height});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
      const left=await page.getByRole('heading',{name:'Criar sala',exact:true}).boundingBox();
      const right=await page.getByRole('heading',{name:'Entrar com convite',exact:true}).boundingBox();
      if(width>640){assert.ok(right.x>left.x);assert.ok(Math.abs(right.y-left.y)<2);}
      else{assert.ok(right.y>left.y);}
      const screenshot=`home-${label}.png`;
      await page.screenshot({path:path.join(output,screenshot),fullPage:true});
      report.screenshots.push({file:screenshot,width,height,horizontalOverflow:false});
    }
    if(process.env.D2_AXE_MODULE){
      await page.addScriptTag({path:require.resolve(process.env.D2_AXE_MODULE+'/axe.min.js')});
      const audit=await page.evaluate(async()=>window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}));
      report.accessibilityViolations=audit.violations.map(({id,impact,nodes})=>({id,impact,count:nodes.length}));
      assert.deepEqual(report.accessibilityViolations,[]);
    }
    await page.setViewportSize({width:1440,height:1000});
    const input=page.getByLabel('Código ou link da sala');
    await input.fill('https://external.invalid/sala/'+room);
    await input.press('Tab');
    assert.equal(await page.getByRole('button',{name:'Entrar na sala',exact:true}).evaluate(el=>el===document.activeElement),true);
    assert.notEqual(await page.getByRole('button',{name:'Entrar na sala',exact:true}).evaluate(el=>getComputedStyle(el).outlineStyle),'none');
    await input.press('Enter');
    await page.locator('#room-input-error').waitFor();
    assert.equal(await input.getAttribute('aria-invalid'),'true');
    assert.equal(new URL(page.url()).pathname,'/');
    let post, finish;
    const pending=new Promise(resolve=>{finish=resolve;});
    await page.route('**/api/rooms/create',async route=>{
      post=route.request().postDataJSON();
      await pending;
      await route.fulfill({status:429,contentType:'application/json',body:JSON.stringify({error:'Muitas tentativas. Tente novamente em instantes.'})});
    });
    await create.click();
    await page.getByRole('button',{name:'Criando sala…',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Criando sala…',exact:true}).isDisabled(),true);
    assert.equal(typeof post.turnstileToken,'string');
    finish();
    await page.getByText('Muitas tentativas. Tente novamente em instantes.',{exact:true}).waitFor();
    report.loadingAndRateLimitErrorVerified=true;
    await input.fill(`${base}/sala/${room}`);
    await input.press('Enter');
    await page.waitForURL(`**/sala/${room}`);
    report.sameOriginInviteNavigationVerified=true;
    assert.equal(report.livekitRequests,0);
    report.passed=true;
    fs.writeFileSync(path.join(output,'browser-validation.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
