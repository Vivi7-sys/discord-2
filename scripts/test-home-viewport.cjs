/* eslint-disable @typescript-eslint/no-require-imports -- Home-only real browser regression checks. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.D2_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.D2_HOME_BASE_URL || 'http://127.0.0.1:3224';
const output = path.resolve(process.env.D2_HOME_EVIDENCE || 'evidence/d2-home-fixed');
const viewports = [
  ['desktop',1440,900], ['desktop-small',1280,720], ['tablet',768,1024],
  ['mobile',390,844], ['mobile-small',360,640], ['mobile-se',320,568],
  ['landscape',844,390], ['landscape-se',568,320],
];
async function geometry(page, label) {
  const size = page.viewportSize();
  const result = await page.evaluate(() => {
    const elements = [...document.querySelectorAll('header a, main section, main form, main h1, main h2, main button, main input, main [role="alert"], main [role="status"]')]
      .filter(el=>el.getBoundingClientRect().height>0 && el.textContent !== '' || el.tagName==='INPUT');
    const verification = document.querySelector('section[aria-labelledby="create-title"] > div');
    if (verification) elements.push(verification);
    return {
      htmlHeight:document.documentElement.clientHeight,bodyHeight:document.body.clientHeight,
      scrollHeight:document.documentElement.scrollHeight,scrollWidth:document.documentElement.scrollWidth,
      scrollY:window.scrollY,htmlOverflow:getComputedStyle(document.documentElement).overflowY,
      bodyOverflow:getComputedStyle(document.body).overflowY,
      elements:elements.map(el=>{const r=el.getBoundingClientRect();return {element:el.tagName,text:el.textContent.slice(0,35),top:r.top,bottom:r.bottom,left:r.left,right:r.right};}),
    };
  });
  assert.equal(result.htmlHeight,size.height,label+' html viewport height');
  assert.equal(result.bodyHeight,size.height,label+' body viewport height');
  assert.ok(result.scrollHeight<=size.height,label+' vertical document overflow');
  assert.ok(result.scrollWidth<=size.width,label+' horizontal document overflow');
  assert.equal(result.htmlOverflow,'hidden');
  assert.equal(result.bodyOverflow,'hidden');
  for (const element of result.elements) {
    assert.ok(element.top>=-1 && element.bottom<=size.height+1,JSON.stringify({label,viewport:size,clipped:element}));
    assert.ok(element.left>=-1 && element.right<=size.width+1,JSON.stringify({label,viewport:size,clipped:element}));
  }
  await page.evaluate(()=>window.scrollTo(0,10000));
  assert.equal(await page.evaluate(()=>scrollY),0,label+' remains fixed');
  return {label,...size,allControlsAndVerificationVisible:true,noScroll:true};
}
(async()=>{
  fs.mkdirSync(output,{recursive:true});
  const browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:900},locale:'pt-BR'});
  const page=await context.newPage();
  let livekitRequests=0;
  await context.route('**/api/livekit/**',route=>{livekitRequests++;return route.abort();});
  const report={realBrowser:true,viewports:[],turnstile:'Unchanged compact widget, official visible test sitekey in local build only'};
  try {
    await page.goto(base,{waitUntil:'domcontentloaded'});
    const create=page.getByRole('button',{name:'Criar sala',exact:true});
    const join=page.getByRole('button',{name:'Entrar na sala',exact:true});
    await create.waitFor({timeout:45000});
    for (const [label,width,height] of viewports) {
      await page.setViewportSize({width,height});
      report.viewports.push(await geometry(page,label));
      if (['desktop','mobile','mobile-se','landscape-se'].includes(label)) {
        await page.screenshot({path:path.join(output,`home-${label}.png`),fullPage:false});
      }
    }
    await page.setViewportSize({width:1440,height:900});
    const createColor=await create.evaluate(el=>getComputedStyle(el).backgroundColor);
    assert.equal(await join.evaluate(el=>getComputedStyle(el).backgroundColor),createColor);
    await join.hover();
    await page.waitForTimeout(180);
    report.joinHoverColor=await join.evaluate(el=>getComputedStyle(el).backgroundColor);
    assert.notEqual(report.joinHoverColor,createColor);
    const input=page.getByLabel('Código ou link da sala');
    await input.focus();
    report.inputFocusBorder=await input.evaluate(el=>getComputedStyle(el).borderColor);
    await input.press('Tab');
    assert.equal(await join.evaluate(el=>document.activeElement===el),true);
    assert.notEqual(await join.evaluate(el=>getComputedStyle(el).outlineStyle),'none');
    report.keyboardFocusVisible=true;
    await page.setViewportSize({width:320,height:568});
    await input.fill('invalid');
    await input.press('Enter');
    await page.locator('#room-input-error').waitFor();
    report.viewports.push(await geometry(page,'mobile-se-invite-error'));
    await page.route('**/api/rooms/create',route=>route.fulfill({status:429,contentType:'application/json',body:JSON.stringify({error:'Muitas tentativas. Tente novamente em instantes.'})}));
    await create.click();
    await page.getByText('Muitas tentativas. Tente novamente em instantes.',{exact:true}).waitFor();
    report.viewports.push(await geometry(page,'mobile-se-both-errors'));
    if(process.env.D2_AXE_MODULE){
      await page.addScriptTag({path:require.resolve(process.env.D2_AXE_MODULE+'/axe.min.js')});
      const audit=await page.evaluate(async()=>window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}));
      report.accessibilityViolations=audit.violations.map(({id,impact})=>({id,impact}));
      assert.deepEqual(report.accessibilityViolations,[]);
    }
    await input.fill(`${base}/sala/${'a'.repeat(64)}`);
    await input.press('Enter');
    await page.waitForURL('**/sala/**');
    await page.getByRole('button',{name:/Entrar na sala/}).waitFor();
    report.roomHtmlOverflow=await page.evaluate(()=>getComputedStyle(document.documentElement).overflowY);
    report.roomBodyOverflow=await page.evaluate(()=>getComputedStyle(document.body).overflowY);
    assert.notEqual(report.roomHtmlOverflow,'hidden','home viewport lock must not leak into room');
    assert.notEqual(report.roomBodyOverflow,'hidden','home viewport lock must not leak into room');
    report.homeLockRemovedOnNavigation=true;
    await page.goBack();
    await page.getByRole('heading',{name:'D2',exact:true}).waitFor();
    report.viewports.push(await geometry(page,'mobile-se-browser-back'));
    report.homeLockRestoredOnBrowserBack=true;
    report.livekitRequests=livekitRequests;
    assert.equal(livekitRequests,0);
    report.passed=true;
    fs.writeFileSync(path.join(output,'viewport-validation.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report));
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
