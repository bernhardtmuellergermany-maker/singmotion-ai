import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import {CreditWallet} from "../lib/commerce/credit-wallet.ts";
import {NotificationInbox,creditedVideoProject} from "../lib/commerce/notifications.ts";

const videoId="31da5034-8686-4f24-9236-638994bef222";
const customer="d7531cc6-179e-4088-b342-1f675c4a934a";
const subject="customer:"+customer;
const owner="customer-"+customer;

function setup(){
 const commerce=new DatabaseSync(":memory:"),live=new DatabaseSync(":memory:");
 new CreditWallet(commerce);
 live.exec(`CREATE TABLE live_studio_projects(
  attempt_id TEXT PRIMARY KEY,owner TEXT NOT NULL,display_name TEXT,
  project_name TEXT,artist_name TEXT,deleted_at INTEGER);
  CREATE TABLE live_attempts(id TEXT PRIMARY KEY,data TEXT NOT NULL);`);
 const now=Date.now();
 commerce.prepare("INSERT INTO credit_video_reservations VALUES(?,?,?,'settled',?,?)")
  .run(videoId,subject,275,now,now);
 commerce.prepare("INSERT INTO credit_wallet_ledger VALUES(?,?,?,?,?,?)")
  .run("video-charge:"+videoId,subject,-275,"video","video-charge:"+videoId,now);
 live.prepare("INSERT INTO live_studio_projects VALUES(?,?,?,?,?,NULL)")
  .run(videoId,owner,"Minecraft","Minecraft","Artist");
 live.prepare("INSERT INTO live_attempts VALUES(?,?)")
  .run(videoId,JSON.stringify({state:"completed",media:{owner},outputPath:"/private/mp4.mp4"}));
 return {commerce,live};
}
test("spent Credits notification identifies the verified private video and links its project",()=>{
 const {commerce,live}=setup();
 try{
  const notice=new NotificationInbox(commerce,live).list(subject).notifications[0];
  assert.equal(notice.title,"Video credits used");
  assert.equal(notice.message,"275 credits used for “Minecraft”.");
  assert.equal(notice.href,"/projects/live_"+videoId);
  live.prepare("UPDATE live_studio_projects SET display_name=? WHERE attempt_id=?")
   .run("My new title",videoId);
  assert.match(new NotificationInbox(commerce,live).list(subject).notifications[0].message,/My new title/);
  assert.equal(new NotificationInbox(commerce,live).list("customer:aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa").notifications.length,0);
  assert.equal(new NotificationInbox(commerce).list(subject).notifications[0].href,"/credits#usage");
 }finally{commerce.close();live.close()}
});
test("do not expose unowned, deleted, refunded, uncompleted or missing video via ledger notifications",()=>{
 const {commerce,live}=setup();
 try{
  const current=()=>new NotificationInbox(commerce,live).list(subject).notifications[0];
  live.prepare("UPDATE live_studio_projects SET owner=? WHERE attempt_id=?").run("customer-other",videoId);
  assert.equal(current().href,"/credits#usage");
  live.prepare("UPDATE live_studio_projects SET owner=? WHERE attempt_id=?").run(owner,videoId);
  live.prepare("UPDATE live_studio_projects SET deleted_at=? WHERE attempt_id=?").run(Date.now(),videoId);
  assert.equal(current().href,"/credits#usage");
  live.prepare("UPDATE live_studio_projects SET deleted_at=NULL WHERE attempt_id=?").run(videoId);
  live.prepare("UPDATE live_attempts SET data=? WHERE id=?").run(JSON.stringify({state:"processing",media:{owner},outputPath:null}),videoId);
  assert.equal(current().href,"/credits#usage");
  live.prepare("UPDATE live_attempts SET data=? WHERE id=?").run(JSON.stringify({state:"completed",media:{owner:"customer-other"},outputPath:"/private/mp4.mp4"}),videoId);
  assert.equal(current().href,"/credits#usage");
  live.prepare("UPDATE live_attempts SET data=? WHERE id=?").run(JSON.stringify({state:"completed",media:{owner},outputPath:"/private/mp4.mp4"}),videoId);
  commerce.prepare("UPDATE credit_video_reservations SET state='released' WHERE project_id=?").run(videoId);
  assert.equal(current().href,"/credits#usage");
  assert.equal(creditedVideoProject(commerce,live,subject,"video-charge:../escape"),null);
 }finally{commerce.close();live.close()}
});
test("the same verified link works for a staff-owned paid video, without exposing staff projects to customers",()=>{
 const {commerce,live}=setup();
 try{
  const staffSubject="super-admin:42",staffOwner="cms-staff-42";
  commerce.prepare("UPDATE credit_wallet_ledger SET subject=? WHERE reference=?").run(staffSubject,"video-charge:"+videoId);
  commerce.prepare("UPDATE credit_video_reservations SET subject=? WHERE project_id=?").run(staffSubject,videoId);
  live.prepare("UPDATE live_studio_projects SET owner=? WHERE attempt_id=?").run(staffOwner,videoId);
  live.prepare("UPDATE live_attempts SET data=? WHERE id=?").run(JSON.stringify({state:"completed",media:{owner:staffOwner},outputPath:"/private/video.mp4"}),videoId);
  const staff=new NotificationInbox(commerce,live).list(staffSubject).notifications[0];
  assert.equal(staff.href,"/projects/live_"+videoId);
  assert.equal(new NotificationInbox(commerce,live).list(subject).notifications.length,0);
 }finally{commerce.close();live.close()}
});
test("notification UI only renders internal verified video links and uses a named video action",()=>{
 const ui=readFileSync(new URL("../components/notification-center.tsx",import.meta.url),"utf8");
 const api=readFileSync(new URL("../app/(site)/api/notifications/route.ts",import.meta.url),"utf8");
 assert.match(ui,/item.kind==="video"&&/);
 assert.match(ui,/sm-notice-video-link/);
 assert.match(ui,/View video/);
 assert.match(ui,/PlayCircle/);
 assert.match(api,/new DatabaseSync\(projectFile,\{readOnly:true\}\)/);
 assert.match(api,/new NotificationInbox\(store.db,live\)/);
});
