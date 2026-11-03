import { chromium } from '@playwright/test';
const BASE='https://foundry-studio-production-4a73.up.railway.app';
const OUT=process.argv[2] ?? 'office-before';
const b=await chromium.launch();
const p=await (await b.newContext({viewport:{width:1440,height:1000}})).newPage();
await p.goto(`${BASE}/login`,{waitUntil:'domcontentloaded'});
await p.getByTestId('password-email').fill('matthew@bruntsfield.capital');
await p.getByTestId('password-password').fill(process.env.FOUNDER_PW.trim());
await p.getByTestId('password-submit').click();
await p.waitForURL(u=>!u.pathname.startsWith('/login'),{timeout:30000});
await p.goto(`${BASE}/venture/arca`,{waitUntil:'networkidle'});
await new Promise(r=>setTimeout(r,9000));   // let the office socket connect and draw
const emb = p.getByTestId('office-embed');
console.log('  office-embed present:', await emb.count());
const fb = await p.getByTestId('office-embed-fallback').count();
console.log('  fallback shown:', fb);
const frames = p.frames().length;
console.log('  frames on page:', frames);
for (const f of p.frames()) {
  if (f.url().includes('office') || f.url().includes('4310')) {
    const n = await f.locator('[class*="agent"], [data-agent-id]').count().catch(()=>-1);
    console.log(`  in office frame (${f.url().slice(0,50)}): agent-ish elements = ${n}`);
  }
}
await p.screenshot({ path: `/tmp/claude-1000/-home-dev-projects-fountainbridge/44f7243d-d309-4a6c-ad2a-8409698761c7/scratchpad/${OUT}.png`, fullPage: false });
await b.close(); process.exit(0);
