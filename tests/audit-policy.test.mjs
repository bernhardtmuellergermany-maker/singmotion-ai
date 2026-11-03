import {test} from "node:test";
import assert from "node:assert/strict";
import {assessProductionDependencyAudit} from "../scripts/audit-policy.mjs";

function report(counts={},issues={}){
 return {metadata:{vulnerabilities:{critical:0,high:0,moderate:0,low:0,total:0,...counts}},
  vulnerabilities:issues};
}

test("npm audit policy allows only complete low/moderate reports",()=>{
 const moderate=assessProductionDependencyAudit(report({moderate:1,total:1},{
  "example-transitive-lib":{severity:"moderate",isDirect:false,fixAvailable:true}
 }));
 assert.equal(moderate.blocked,false);
 assert.equal(moderate.summary.moderate,1);
 assert.deepEqual(moderate.summary.top,[{
  name:"example-transitive-lib",severity:"moderate",direct:false,fixAvailable:"patch"
 }]);
});
test("npm audit policy blocks critical and high vulnerabilities",()=>{
 assert.equal(assessProductionDependencyAudit(report({high:1,total:1},{
  "unsafe-sharp":{severity:"high",isDirect:true,fixAvailable:false}
 })).blocked,true);
 assert.equal(assessProductionDependencyAudit(report({critical:1,total:1},{
  "unsafe-parser":{severity:"critical",isDirect:false}
 })).blocked,true);
});
test("npm audit policy rejects invalid or dishonest JSON reports",()=>{
 for(const invalid of [
  null,{}, {error:{code:"ENOAUDIT"}},
  {metadata:{vulnerabilities:{critical:0,high:0,moderate:0,low:0,total:0}}},
  report({critical:-1}), report({high:NaN}),report({moderate:1,total:0}),
  report({critical:0,high:0,total:0},{"unsafe":{severity:"high"}}),
  report({critical:0,high:0,total:0},{"unknown":{severity:"urgent"}}),
 ])assert.throws(()=>assessProductionDependencyAudit(invalid),undefined,JSON.stringify(invalid));
});
