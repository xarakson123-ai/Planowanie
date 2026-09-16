import express from "express";
import http from "http";
import { Server } from "socket.io";

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });
app.get("/", (_req,res)=>res.json({name:"Planowanie Online",status:"online"}));
app.get("/health", (_req,res)=>res.json({status:"ok"}));

const rooms=new Map();
const SUITS=["hearts","diamonds","clubs","spades"];
const RANKS=["2","3","4","5","6","7","8","9","10","J","Q","K","A"];
const VALUES=Object.fromEntries(RANKS.map((r,i)=>[r,i+2]));
const SYMBOLS={hearts:"♥",diamonds:"♦",clubs:"♣",spades:"♠"};
const deck=()=>SUITS.flatMap(s=>RANKS.map(r=>({id:`${r}${s[0].toUpperCase()}`,suit:s,rank:r,value:VALUES[r]})));
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
function code(){const c="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";let x;do{x=Array.from({length:5},()=>c[Math.floor(Math.random()*c.length)]).join("")}while(rooms.has(x));return x}
function roomOf(id){return [...rooms.values()].find(r=>r.players.some(p=>p.id===id))}
function player(r,id){return r?.players.find(p=>p.id===id)}
function state(r,id){const me=player(r,id);return {code:r.code,hostId:r.hostId,phase:r.phase,round:r.round,players:r.players.map(p=>({id:p.id,name:p.name,seat:p.seat,bid:p.bid,tricksWon:p.tricksWon,totalScore:p.totalScore})),myId:id,myHand:me?.hand||[],currentPlayerId:r.currentPlayerId,leaderPlayerId:r.leaderPlayerId,table:r.table,lastTrick:r.lastTrick,lastTrickWinnerId:r.lastTrickWinnerId,roundScores:r.roundScores,history:r.history,final:r.final}}
function emit(r){r.players.forEach(p=>io.to(p.id).emit("gameState",state(r,p.id)))}
function deal(r){const d=shuffle(deck());for(let i=0;i<r.round;i++)for(const p of r.players)p.hand.push(d.pop());r.players.forEach(p=>p.hand.sort((a,b)=>SUITS.indexOf(a.suit)-SUITS.indexOf(b.suit)||a.value-b.value));r.phase="BIDDING";r.currentPlayerId=r.leaderPlayerId;r.bidOrder=[]}
function reset(r){r.players.forEach(p=>{p.hand=[];p.bid=null;p.tricksWon=0});r.table=[];r.lastTrick=[];r.lastTrickWinnerId=null;r.roundScores=null;r.currentPlayerId=null;r.phase="DEALING";r.bidOrder=[]}
function validFinalTarget(total, remainingPlayers, round){const min=total,max=total+remainingPlayers*round;return [round-1,round+1].some(t=>t>=min&&t<=max)}
function roundEnd(r){r.roundScores=r.players.map(p=>{const ok=p.bid===p.tricksWon;const score=ok?10+p.tricksWon:0;p.totalScore+=score;return {playerId:p.id,name:p.name,bid:p.bid,tricksWon:p.tricksWon,score,totalScore:p.totalScore,failed:!ok}});r.history.push({round:r.round,scores:r.roundScores});if(r.round===1){} if(r.round===7){r.phase="GAME_RESULT";r.final=r.players.map(p=>({playerId:p.id,name:p.name,totalScore:p.totalScore}))}else{r.phase="ROUND_RESULT";r.currentPlayerId=null;setTimeout(()=>{if(!rooms.has(r.code)||r.phase!=="ROUND_RESULT")return;r.round--;r.leaderPlayerId=r.lastTrickWinnerId||r.leaderPlayerId;reset(r);deal(r);emit(r)},3500)} }
function trickEnd(r){const lead=r.table[0].card.suit;const w=r.table.filter(x=>x.card.suit===lead).reduce((a,b)=>b.card.value>a.card.value?b:a);player(r,w.playerId).tricksWon++;r.lastTrick=[...r.table];r.lastTrickWinnerId=w.playerId;r.leaderPlayerId=w.playerId;r.table=[];if(r.players.every(p=>p.hand.length===0))roundEnd(r);else{r.phase="PLAYING";r.currentPlayerId=w.playerId}}

io.on("connection",s=>{
 s.on("createRoom",({name},cb)=>{const r={code:code(),hostId:s.id,phase:"WAITING",round:7,players:[{id:s.id,name:String(name||"Gracz").trim().slice(0,20)||"Gracz",seat:1,hand:[],bid:null,tricksWon:0,totalScore:0}],leaderPlayerId:s.id,currentPlayerId:null,table:[],lastTrick:[],lastTrickWinnerId:null,roundScores:null,history:[],final:null,bidOrder:[]};rooms.set(r.code,r);s.join(r.code);cb?.({ok:true,code:r.code});emit(r)});
 s.on("joinRoom",({code:c,name},cb)=>{const r=rooms.get(String(c||"").trim().toUpperCase());if(!r)return cb?.({ok:false,error:"Pokój nie istnieje."});if(r.players.length>=4)return cb?.({ok:false,error:"Pokój jest pełny."});if(r.phase!=="WAITING")return cb?.({ok:false,error:"Gra już się rozpoczęła."});r.players.push({id:s.id,name:String(name||"Gracz").trim().slice(0,20)||"Gracz",seat:r.players.length+1,hand:[],bid:null,tricksWon:0,totalScore:0});s.join(r.code);cb?.({ok:true,code:r.code});emit(r)});
 s.on("startGame",cb=>{const r=roomOf(s.id);if(!r)return cb?.({ok:false,error:"Nie jesteś w pokoju."});if(r.hostId!==s.id)return cb?.({ok:false,error:"Tylko host może rozpocząć."});if(r.players.length<2)return cb?.({ok:false,error:"Potrzeba co najmniej 2 graczy."});r.round=7;r.leaderPlayerId=r.hostId;reset(r);deal(r);cb?.({ok:true});emit(r)});
 s.on("submitBid",({bid},cb)=>{const r=roomOf(s.id),p=player(r,s.id);if(!r||!p)return cb?.({ok:false,error:"Brak pokoju."});if(r.phase!=="BIDDING")return cb?.({ok:false,error:"Nie trwa licytacja."});if(p.bid!==null)return cb?.({ok:false,error:"Deklaracja została już zatwierdzona."});const n=Number(bid);if(!Number.isInteger(n)||n<0||n>r.round)return cb?.({ok:false,error:`Wybierz liczbę od 0 do ${r.round}.`});const sumBefore=r.players.reduce((a,x)=>a+(x.bid??0),0);const remaining=r.players.length-r.bidOrder.length-1;const sumAfter=sumBefore+n;if(!validFinalTarget(sumAfter,remaining,r.round))return cb?.({ok:false,error:"Ta deklaracja uniemożliwi zasadę: suma deklaracji musi być o 1 mniejsza albo o 1 większa od liczby lew."});p.bid=n;r.bidOrder.push(p.id);const next=r.players[(p.seat%r.players.length)];if(r.players.every(x=>x.bid!==null)){const total=r.players.reduce((a,x)=>a+x.bid,0);if(total!==r.round-1&&total!==r.round+1){p.bid=null;r.bidOrder.pop();return cb?.({ok:false,error:"Ostatnia deklaracja musi sprawić, że suma będzie o 1 mniejsza lub większa od liczby lew."})}r.phase="PLAYING";r.currentPlayerId=r.leaderPlayerId}else r.currentPlayerId=next.id;cb?.({ok:true});emit(r)});
 s.on("playCard",({cardId},cb)=>{const r=roomOf(s.id),p=player(r,s.id);if(!r||!p)return cb?.({ok:false,error:"Brak pokoju."});if(r.phase!=="PLAYING")return cb?.({ok:false,error:"Nie trwa rozgrywka."});if(r.currentPlayerId!==s.id)return cb?.({ok:false,error:"To nie jest Twoja kolej."});const i=p.hand.findIndex(c=>c.id===cardId);if(i<0)return cb?.({ok:false,error:"Tej karty nie ma w Twojej ręce."});const card=p.hand[i];if(r.table.length){const lead=r.table[0].card.suit;if(p.hand.some(c=>c.suit===lead)&&card.suit!==lead)return cb?.({ok:false,error:`Musisz dołożyć kolor ${SYMBOLS[lead]}.`})}p.hand.splice(i,1);r.table.push({playerId:s.id,card});if(r.table.length===r.players.length)trickEnd(r);else r.currentPlayerId=r.players[p.seat%r.players.length].id;cb?.({ok:true});emit(r)});
 s.on("nextRound",cb=>cb?.({ok:false,error:"Rundy zaczynają się automatycznie."}));
 s.on("disconnect",()=>{const r=roomOf(s.id);if(!r)return;r.players=r.players.filter(p=>p.id!==s.id);if(!r.players.length)return rooms.delete(r.code);r.players.forEach((p,i)=>p.seat=i+1);if(r.hostId===s.id)r.hostId=r.players[0].id;if(r.currentPlayerId===s.id)r.currentPlayerId=r.players[0].id;emit(r)})
});
const port=Number(process.env.PORT)||3000;httpServer.listen(port,"0.0.0.0",()=>console.log(`Planowanie Online server listening on port ${port}`));