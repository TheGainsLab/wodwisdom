import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";
import { extractBlocksFromWorkoutText } from "../_shared/parse-workout-blocks.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const DAY_NAMES = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const DAY_ABBREV = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const WEEK_REGEX = /week\s*(\d+)/i;
const DAY_COL_NAMES = [
  "monday","mon","tuesday","tue","tues","wednesday","wed",
  "thursday","thu","thur","thurs","friday","fri",
  "saturday","sat","sunday","sun"
];
const DAY_COL_TO_NUM: Record<string, number> = {
  monday:1,mon:1,tuesday:2,tue:2,tues:2,
  wednesday:3,wed:3,thursday:4,thu:4,thur:4,thurs:4,
  friday:5,fri:5,saturday:6,sat:6,sunday:7,sun:7
};
const WORKOUT_HEADER_RE =
/^(for\s+time|amrap\s+\d+|emom\s*\d*|e\d+mom|\d+\s*rounds?\s*(for\s+time)?|\d+\s*rft|every\s+\d+\s+min|death\s+by|tabata|buy\s+in|cash\s+out)/i;
const STRENGTH_RE = /^(?:\d+x\d+\b|@\d+%)/;
const WEEK_LABEL_RE = /week\s*(\d+)|wk\s*(\d+)/i;
interface ParsedWorkout {
  week_num: number
  day_num: number
  workout_text: string
  sort_order: number
}
function isWorkoutHeader(text:string){
  return WORKOUT_HEADER_RE.test(text.trim())
}
function isStrengthLine(text:string){
  return STRENGTH_RE.test(text.trim())
}
function parseDayValue(val:unknown):number|null{
  const s = String(val || "").trim().toLowerCase()
  if (DAY_COL_TO_NUM[s] != null) return DAY_COL_TO_NUM[s]
  const n = parseInt(s,10)
  if(!isNaN(n) && n>=1 && n<=7) return n
  return null
}
function parseProgramText(text:string):ParsedWorkout[]{
  const normalized = text.replace(/\r\n/g,"\n").replace(/\r/g,"\n")
  const lines = normalized.split("\n").map(l=>l.trim()).filter(Boolean)
  const result:ParsedWorkout[]=[]
  let currentWeek=1
  let currentDay=1
  let sortOrder=0
  for(const line of lines){
    const wkMatch=line.match(WEEK_REGEX)
    if(wkMatch){
      currentWeek=parseInt(wkMatch[1],10)||1
      continue
    }
    let dayNum=currentDay
    const lower=line.toLowerCase()
    for(let i=0;i<DAY_NAMES.length;i++){
      if(
        lower.startsWith(DAY_NAMES[i].toLowerCase()+":") ||
        lower.startsWith(DAY_ABBREV[i].toLowerCase()+":") ||
        lower.startsWith(DAY_NAMES[i].toLowerCase()+" ") ||
        lower.startsWith(DAY_ABBREV[i].toLowerCase()+" ")
      ){
        dayNum=i+1
        break
      }
    }
    const workoutText=line
      .replace(/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\s*:?\s*/i,"")
      .trim()
    if(workoutText.length>0){
      result.push({
        week_num:currentWeek,
        day_num:dayNum,
        workout_text:workoutText,
        sort_order:sortOrder++
      })
      currentDay=dayNum
    }
  }
  return result
}
/* -----------------------------
   FIXED AI PARSER
-------------------------------- */
function parseProgramTextAI(text:string):ParsedWorkout[]{
  const normalized=text.replace(/\r\n/g,"\n").replace(/\r/g,"\n")
  const lines=normalized.split("\n")
    .map(l=>l.trim())
    .filter(Boolean)
  const result:ParsedWorkout[]=[]
  let currentWeek=1
  let currentDay=1
  let sortOrder=0
  const dayLines:string[]=[]
  const dayPattern =
  /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\s*:?\s*/i
  function flushDay(){
    if(dayLines.length>0){
      result.push({
        week_num:currentWeek,
        day_num:currentDay,
        workout_text:dayLines.join("\n"),
        sort_order:sortOrder++
      })
      dayLines.length=0
    }
  }
  for(let line of lines){
    /* ---- WEEK PARSE (FIXED) ---- */
    const wkMatch=line.match(WEEK_REGEX)
    if(wkMatch){
      flushDay()
      currentWeek=parseInt(wkMatch[1],10)||1
      line=line
        .replace(WEEK_REGEX,"")
        .replace(/^[\s\-–:]+/,"")
        .trim()
      if(!line) continue
    }
    /* ---- DAY PARSE ---- */
    const lower=line.toLowerCase()
    let isDayHeader=false
    let dayNum=currentDay
    for(let i=0;i<DAY_NAMES.length;i++){
      const d=DAY_NAMES[i].toLowerCase()
      const a=DAY_ABBREV[i].toLowerCase()
      if(
        lower.startsWith(d+":") ||
        lower.startsWith(a+":") ||
        lower.startsWith(d+" ") ||
        lower.startsWith(a+" ")
      ){
        dayNum=i+1
        isDayHeader=true
        break
      }
    }
    if(isDayHeader){
      flushDay()
      currentDay=dayNum
      const rest=line.replace(dayPattern,"").trim()
      if(rest.length>0) dayLines.push(rest)
    } else {
      dayLines.push(line)
    }
  }
  flushDay()
  return result
}
/* -------------------------------------------------
   REST OF FUNCTION (unchanged)
-------------------------------------------------- */
Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors})
  try{
    const authHeader=req.headers.get("Authorization")
    if(!authHeader){
      return new Response(JSON.stringify({error:"Unauthorized"}),{
        status:401,
        headers:{...cors,"Content-Type":"application/json"}
      })
    }
    const supa=createClient(SUPABASE_URL,SUPABASE_SERVICE_KEY)
    const token=authHeader.replace("Bearer ","")
    const {data:{user},error:authErr}=await supa.auth.getUser(token)
    if(authErr||!user){
      return new Response(JSON.stringify({error:"Unauthorized"}),{
        status:401,
        headers:{...cors,"Content-Type":"application/json"}
      })
    }
    const body=await req.json()
    const {name,text,file_base64,file_type,source}=body
    let workouts:ParsedWorkout[]=[]
    const useAIParser=source==="generate"
    if(text && typeof text==="string"){
      workouts = useAIParser
        ? parseProgramTextAI(text.trim())
        : parseProgramText(text.trim())
    }
    if(workouts.length===0){
      return new Response(JSON.stringify({
        error:"Could not parse any workouts from the input."
      }),{
        status:400,
        headers:{...cors,"Content-Type":"application/json"}
      })
    }
    if(useAIParser && workouts.length!==20){
      return new Response(JSON.stringify({
        error:`Expected exactly 20 workouts, got ${workouts.length}`
      }),{
        status:422,
        headers:{...cors,"Content-Type":"application/json"}
      })
    }
    return new Response(JSON.stringify({
      workout_count:workouts.length
    }),{
      status:200,
      headers:{...cors,"Content-Type":"application/json"}
    })
  }catch(e){
    return new Response(JSON.stringify({
      error:(e as Error).message
    }),{
      status:500,
      headers:{...cors,"Content-Type":"application/json"}
    })
  }
})
