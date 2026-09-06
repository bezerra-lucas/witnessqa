import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderScenarios, blockedDependency } from '../worker/src/dependencies.mjs';

test('dependent journeys run after preflight and remain unobserved when it fails', () => {
  const login = {name:'login', steps:[]};
  const units = {name:'units', dependsOn:['login'], steps:[]};
  assert.deepEqual(orderScenarios([units,login]), [login,units]);
  assert.equal(blockedDependency(units,new Map([['login',{verdict:'pass'}]])), null);
  for(const verdict of ['fail','blocked','warn']) {
    const result = blockedDependency(units,new Map([['login',{verdict}]]));
    assert.equal(result.verdict,'blocked');
    assert.equal(result.failure.dependency,'login');
    assert.deepEqual(result.steps,[]);
    assert.deepEqual(result.screenshots,[]);
  }
  assert.throws(()=>orderScenarios([units]),/dependency/);
  assert.throws(()=>orderScenarios([units,{...login,dependsOn:['units']}]),/cycle/);
});
