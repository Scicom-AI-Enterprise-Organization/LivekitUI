import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseOpenApi, toToolName } from "../src/lib/openapi.ts";
const ok = (label, cond, extra = "") => test(label, () => assert.ok(cond, extra));

describe("openapi import", () => {

// name normalisation
ok("camelCase operationId → snake", toToolName("getPetById","get","/pets/{id}")==="get_pet_by_id", toToolName("getPetById","get","/pets/{id}"));
ok("no operationId → method_path", toToolName("","get","/pets/{petId}/toys")==="get_pets_pet_id_toys", toToolName("","get","/pets/{petId}/toys"));
ok("leading digit gets a prefix", /^[a-z_]/.test(toToolName("2fa","post","/x")), toToolName("2fa","post","/x"));

// OpenAPI 3 with $ref, path+query params, request body, shared params, deprecated
const spec3 = {
  openapi: "3.0.0",
  info: { title: "Pet API", version: "1.2.0" },
  servers: [{ url: "https://{env}.example.com/v1", variables: { env: { default: "api" } } }],
  components: {
    parameters: { PetId: { name: "petId", in: "path", required: true, schema: { type: "integer" }, description: "Pet id" } },
    schemas: { NewPet: { type: "object", required: ["name"], properties: { name: { type: "string", description: "Pet name" }, age: { type: "number" } } } },
  },
  paths: {
    "/pets/{petId}": {
      parameters: [{ $ref: "#/components/parameters/PetId" }],
      get: { operationId: "getPet", summary: "Fetch one pet",
             parameters: [{ name: "verbose", in: "query", schema: { type: "boolean" } },
                          { name: "X-Api-Key", in: "header", schema: { type: "string" } }] },
      delete: { operationId: "deletePet", deprecated: true },
    },
    "/pets": {
      post: { operationId: "createPet", summary: "Create a pet",
              requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/NewPet" } } } } },
    },
  },
};
const r = parseOpenApi(spec3);
ok("title + version", r.title==="Pet API" && r.version==="1.2.0");
ok("server template resolved", r.baseUrl==="https://api.example.com/v1", r.baseUrl);
ok("deprecated op skipped", r.skipped.some(s=>s.reason==="deprecated") && !r.tools.some(t=>t.name==="delete_pet"));
ok("operation count", r.tools.length===2, String(r.tools.length));

const get = r.tools.find(t=>t.name==="get_pet");
ok("full url built", get.url==="https://api.example.com/v1/pets/{petId}", get.url);
ok("$ref path param resolved", get.params.some(p=>p.name==="petId"&&p.required&&p.type==="integer"));
ok("query param picked up", get.params.some(p=>p.name==="verbose"&&p.type==="boolean"));
ok("header became a header, not a param", get.headers.some(h=>h.name==="X-Api-Key") && !get.params.some(p=>p.name==="X-Api-Key"));
ok("summary as description", get.description==="Fetch one pet");

const post = r.tools.find(t=>t.name==="create_pet");
ok("body flattened into params", post.params.some(p=>p.name==="name"&&p.required) && post.params.some(p=>p.name==="age"&&!p.required));

// Swagger 2.0
const spec2 = { swagger:"2.0", info:{title:"Old API",version:"1"}, host:"legacy.example.com", basePath:"/api", schemes:["https"],
  paths:{ "/things":{ post:{ operationId:"addThing", parameters:[
    { name:"q", in:"query", type:"string" },
    { name:"body", in:"body", schema:{ type:"object", required:["title"], properties:{ title:{type:"string"} } } }]}}}};
const r2 = parseOpenApi(spec2);
ok("swagger 2 base url", r2.baseUrl==="https://legacy.example.com/api", r2.baseUrl);
ok("swagger 2 body param flattened", r2.tools[0].params.some(p=>p.name==="title"&&p.required));

// duplicate operationIds must not collide
const dup = parseOpenApi({ openapi:"3.0.0", info:{}, paths:{
  "/a":{ get:{ operationId:"same" } }, "/b":{ get:{ operationId:"same" } } } });
ok("duplicate names disambiguated", new Set(dup.tools.map(t=>t.name)).size===2, dup.tools.map(t=>t.name).join(","));

// failure modes
for (const [label, doc] of [["not an object","hello"],["missing openapi field",{paths:{}}],["no paths",{openapi:"3.0.0"}]]) {
  let threw=false; try { parseOpenApi(doc); } catch { threw=true; }
  ok("rejects: "+label, threw);
}
});
