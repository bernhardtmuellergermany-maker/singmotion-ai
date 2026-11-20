import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {normalizeSunoSongLink} from "../lib/suno-song-link.ts";

const wizard=readFileSync(new URL("../components/studio-wizard.tsx",import.meta.url),"utf8");
const ui=readFileSync(new URL("../components/suno-song-import.tsx",import.meta.url),"utf8");

test("Suno official share links are recognized and canonicalized without network fetching",()=>{
 assert.equal(normalizeSunoSongLink("https://suno.com/s/9NgKJGqKoraKou62"),"https://suno.com/s/9NgKJGqKoraKou62");
 assert.equal(normalizeSunoSongLink("  https://www.suno.com/s/9NgKJGqKoraKou62/?utm_source=test#track  "),"https://suno.com/s/9NgKJGqKoraKou62");
 assert.equal(normalizeSunoSongLink("https://suno.com/song/abcdef01-2345-6789-abcd-001122334455"),"https://suno.com/song/abcdef01-2345-6789-abcd-001122334455");
});

test("Suno link validation rejects off-domain destinations and anything other than share pages",()=>{
 for(const url of [
   "", "https://suno.com.evil.test/s/9NgKJGqKoraKou62",
   "http://suno.com/s/9NgKJGqKoraKou62",
   "https://evil.test/s/9NgKJGqKoraKou62",
   "https://suno.com@evil.test/s/9NgKJGqKoraKou62",
   "https://suno.com/s/%2F%2Fevil.test",
   "https://suno.com/api/clip/9NgKJGqKoraKou62",
   "https://cdn1.suno.ai/9NgKJGqKoraKou62.mp3",
   "javascript:alert(1)",
   "https://suno.com/s/bad",
   "https://suno.com/song/bad",
   "https://suno.com/s/9NgKJGqKoraKou62/path",
   "https://suno.com:9999/s/9NgKJGqKoraKou62",
 ])assert.equal(normalizeSunoSongLink(url),null,url);
});

test("Studio uses the existing protected upload pipeline with an official Suno download handoff",()=>{
 assert.match(wizard,/import \{SunoSongImport\} from "\.\/suno-song-import";/);
 assert.match(wizard,/!draft\.song&&<SunoSongImport disabled=\{!ready\|\|busy\} onChooseFile=\{\(\)=>audioFileInput\.current\?\.click\(\)\}\/>/);
 assert.match(wizard,/uploadWithProgress\(file, kind,/);
 assert.match(ui,/Suno’s official Download option/);
 assert.match(ui,/target="_blank" rel="noopener noreferrer"/);
 assert.match(ui,/250-second clip limit/);
 assert.doesNotMatch(ui,/\bfetch\(|\bXMLHttpRequest\b|cdn1\.suno\.ai|stream-rip/i);
});
