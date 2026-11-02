import {test} from "node:test";
import assert from "node:assert/strict";
import {CommerceStore} from "../lib/commerce/store.ts";
import {prepareCustomerStudioOrder} from "../lib/commerce/prepare-studio-order.ts";

test("customer Studio order preparation fails closed without launch flag", async()=>{
 const store=new CommerceStore(":memory:");
 try {
   await assert.rejects(prepareCustomerStudioOrder(store, {
     accountId:"11111111-1111-4111-8111-111111111111",
     email:"buyer@example.test",mediaOwner:"studio-owner",
     projectId:"studio-project",requestKey:"request_12345678",draft:{},
   },{CUSTOMER_ACCOUNTS_ENABLED:"true",CUSTOMER_CENTS_PER_TEN_SECONDS:"900"}),/not enabled/);
   assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM customer_orders").get()?.n,0);
 } finally {store.close();}
});

test("customer Studio order preparation refuses media belonging to another customer before any checkout", async()=>{
 const store=new CommerceStore(":memory:");
 try {
   const accountId="11111111-1111-4111-8111-111111111111";
   await assert.rejects(prepareCustomerStudioOrder(store,{
     accountId,email:"buyer@example.test",mediaOwner:"studio-owner",
     projectId:"studio-project",requestKey:"request_12345678",draft:{}
   },{CUSTOMER_ACCOUNTS_ENABLED:"true",CUSTOMER_ORDER_PREPARATION_ENABLED:"true"}),/media owner mismatch/);
   assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM customer_orders").get()?.n,0);
 } finally {store.close()}
});
