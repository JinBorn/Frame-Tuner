const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright-core');
const { createWorkbenchService } = require('./workbench_service');
const { createSamplePackage } = require('./cocos/sample_package');
const { startExportServer, findBrowser } = require('./frame_tuner');

async function test() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'frame-tuner-transform-'));
  let server,browser;
  try {
    const service=createWorkbenchService({root});
    service.createProject({id:'hero',label:'Hero'});
    const sample=createSamplePackage();
    service.importAnimation({projectId:'hero',profileId:'hero',animationId:'idle',fps:12,files:[0,1].map(i=>({name:`${i}.png`,data:'data:image/png;base64,'+sample.files.get(`frames/demo_${i}.png`).toString('base64')}))});
    const data=service.projectData('hero');
    data.tuning.frame_visual_overrides={'hero/idle:0':{visual_size:1,offset:{x:0,y:0}},'hero/idle:1':{visual_size:2,offset:{x:30,y:10}}};
    service.store.writeJson(data.paths.tuning,data.tuning);
    server=await startExportServer(root);
    browser=await chromium.launch({executablePath:findBrowser(),headless:true});
    const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:2});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`${server.url}/?project=hero&export=1`);await page.evaluate(()=>window.FrameTunerWorkbench.ready);
    await page.locator('label:has(> #adjustFrame)').click();
    const input=page.locator('#baseX');
    await input.focus();await input.press('ControlOrMeta+A');await input.pressSequentially('-12.75');
    assert.equal(await input.inputValue(),'-12.75');
    await input.press('Enter');assert.equal(await input.inputValue(),'-12.75');
    await page.locator('#undoTop').click();assert.equal(await input.inputValue(),'0');
    await input.fill('');await input.press('Tab');assert.equal(await input.inputValue(),'0');
    await input.fill('123');await input.press('Escape');assert.equal(await input.inputValue(),'0');
    const scale=page.locator('#baseScale');
    await scale.focus();await scale.press('ControlOrMeta+A');await scale.pressSequentially('0.125');
    await scale.press('Enter');assert.equal(await scale.inputValue(),'0.125');
    assert.equal(await page.locator('#baseScaleX').inputValue(),'0.125');
    await page.locator('#undoTop').click();
    await input.fill('17.5');await input.press('ControlOrMeta+s');
    await page.waitForFunction(()=>!window.FrameTunerWorkbench.current().saving && !window.FrameTunerWorkbench.current().dirty);
    assert.equal(service.projectData('hero').tuning.frame_visual_overrides['hero/idle:0'].offset.x,17.5);
    await page.locator('#filmstrip .thumb[data-frame-index="1"] .frameSelect').click({modifiers:['Shift']});
    const saved=async()=>{await page.evaluate(()=>window.FrameTunerWorkbench.save());return service.projectData('hero').tuning.frame_visual_overrides;};
    const before=await saved();
    const canvas=await page.locator('#stage').boundingBox();
    const drag=async(tool,dx,dy=0,button='left')=>{
      await page.locator(`[data-canvas-tool="${tool}"]`).click();
      assert.equal(await page.locator(`[data-canvas-tool="${tool}"]`).getAttribute('aria-pressed'),'true');
      await page.mouse.move(canvas.x+canvas.width/2,canvas.y+canvas.height/2);
      await page.mouse.down({button});await page.mouse.move(canvas.x+canvas.width/2+dx,canvas.y+canvas.height/2+dy,{steps:4});await page.mouse.up({button});
    };
    await drag('move',40,20);const moved=await saved();
    const first='hero/idle:0',second='hero/idle:1';
    const delta=moved[first].offset.x-before[first].offset.x;
    assert.ok(delta>0);
    assert.ok(Math.abs((moved[second].offset.x-before[second].offset.x)-delta)<1e-6,'Multi-frame drag preserves relative positions');
    assert.equal(moved[first].visual_size,before[first].visual_size);
    await page.locator('#undoTop').click();const undone=await saved();
    assert.equal(undone[first].offset.x,before[first].offset.x);
    await drag('scale',60);const scaled=await saved();
    assert.ok(scaled[first].visual_size>before[first].visual_size);
    assert.ok(Math.abs(scaled[second].visual_size/scaled[first].visual_size-before[second].visual_size/before[first].visual_size)<1e-6);
    await page.locator('#undoTop').click();
    await drag('rotate',25);const rotated=await saved();
    assert.equal(rotated[first].rotation,25);assert.equal(rotated[second].rotation,25);
    await drag('move',15,15,'middle');const panned=await saved();
    assert.deepEqual(panned,rotated,'Middle drag only pans the view');
    for (const mode of ['Group','Character']) {
      await page.locator(`label:has(> #adjust${mode})`).click();
      await input.fill('-3.5');await input.press('Enter');
      assert.equal(await input.inputValue(),'-3.5');
      const origin=await page.evaluate(()=>({x:currentFrameRect().originX,y:currentFrameRect().originY}));
      await drag('move',30,12);
      const movedOrigin=await page.evaluate(()=>({x:currentFrameRect().originX,y:currentFrameRect().originY}));
      assert.ok(Math.abs(movedOrigin.x-origin.x-60)<0.01,`${mode}: horizontal drag follows pointer at DPR 2`);
      assert.ok(Math.abs(movedOrigin.y-origin.y-24)<0.01,`${mode}: vertical drag follows pointer at DPR 2`);
      await page.locator('#undoTop').click();
      assert.equal(await input.inputValue(),'-3.5');
    }
    const final=await saved();
    await page.reload();await page.evaluate(()=>window.FrameTunerWorkbench.ready);
    assert.deepEqual(service.projectData('hero').tuning.frame_visual_overrides,final);
    assert.deepEqual(errors,[]);
    console.log('Transform interaction passed: numeric typing/decimal/negative, Enter/Esc/invalid/undo/Ctrl+S; canvas move/scale/rotate, multi-frame relative values, middle pan, save/reload at DPR 2.');
  } finally {
    await browser?.close();
    if(server?.child&&server.child.exitCode===null)await new Promise(r=>{server.child.once('exit',r);server.child.kill();});
    assert.equal(path.dirname(root),os.tmpdir());assert.ok(path.basename(root).startsWith('frame-tuner-transform-'));
    fs.rmSync(root,{recursive:true,force:true});
  }
}
test().catch(e=>{console.error(e);process.exitCode=1;});
