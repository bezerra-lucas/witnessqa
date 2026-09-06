import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runScenario } from '../worker/src/executor.mjs';

test('real worker blocks dependent browser navigation after failed login even with parallel jobs', async () => {
  let protectedHits = 0;
  const server = createServer((req,res) => {
    if (req.url === '/protected') protectedHits++;
    res.setHeader('Content-Type','text/html'); res.end('<h1>Login</h1>');
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const dir = mkdtempSync(join(tmpdir(),'witness-worker-dependency-'));
  try {
    const app = `http://127.0.0.1:${server.address().port}`;
    const dependent = join(dir,'a-dependent.json');
    const login = join(dir,'z-login.json');
    writeFileSync(dependent,JSON.stringify({name:'units',app,dependsOn:['login'],steps:[{goto:'/protected'},{expectText:'Login'}]}));
    writeFileSync(login,JSON.stringify({name:'login',app,steps:[{goto:'/login'},{expectText:'Authenticated'}]}));
    const output = join(dir,'output');
    const child = spawn(process.execPath,[new URL('../worker/src/worker.mjs',import.meta.url).pathname,dependent,login,'--out',output,'--jobs','4'],{stdio:['ignore','pipe','pipe']});
    let log=''; child.stdout.on('data',chunk=>log+=chunk); child.stderr.on('data',chunk=>log+=chunk);
    const code = await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
    assert.notEqual(code,0,log);
    const result = JSON.parse(readFileSync(join(output,'a-dependent/result.json'),'utf8'));
    assert.equal(result.verdict,'blocked');
    assert.deepEqual(result.steps,[]); assert.deepEqual(result.screenshots,[]);
    assert.equal(result.failure.dependency,'login');
    assert.equal(protectedHits,0);
    assert.match(readFileSync(join(output,'REPORT.html'),'utf8'),/Jornada não comprovada/);
  } finally {
    server.closeAllConnections(); await new Promise(resolve=>server.close(resolve));
    rmSync(dir,{recursive:true,force:true});
  }
});

test('login observation distinguishes submitted credentials from an authenticated journey', async () => {
  const server = createServer((req, res) => {
    if (req.url === '/auth') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ok:true}));
      return;
    }
    res.setHeader('Content-Type', 'text/html');
    res.end('<form onsubmit="event.preventDefault();fetch(\'/auth\',{method:\'POST\'});"><input type="email"><input type="password"><button type="submit">Entrar</button></form>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const evidenceDir = mkdtempSync(join(tmpdir(), 'witness-auth-observation-'));
  try {
    const result = await runScenario({name:'login', app:`http://127.0.0.1:${server.address().port}`,
      steps:[{goto:'/login'}, {fill:{selector:'input[type=email]',value:'fixture@example.test'}},
        {fill:{selector:'input[type=password]',value:'private-fixture-password'}},
        {click:'button[type=submit]'}, {wait:100}, {expectText:{selector:'body',text:'Projects'}}]}, {evidenceDir});
    assert.equal(result.verdict, 'fail', JSON.stringify(result.failure));
    assert.equal(result.finalUrl.endsWith('/login'), true);
    assert.ok(result.requests.some(r => r.method === 'POST' && r.path === '/auth' && r.status === 200));
    assert.equal(result.browserState.storageCount, 0);
    assert.doesNotMatch(JSON.stringify(result), /private-fixture-password|fixture@example\.test/);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    rmSync(evidenceDir, {recursive:true,force:true});
  }
});
