#!/usr/bin/env node
// city-hpm.js - Hybrid Profile Matrix + Constraint Compiler
// City Two-Layer Theory (2026-04-03). Designed by 10 models. Built by SURVEYOR.
// Reasoning != doing. Map defaults. Build environments around them.

var fs = require("fs");
var path = require("path");
var FASTOPS = __dirname;
var PROFILES_FILE = path.join(FASTOPS, "model-profiles.json");

function emptyProfile(id) {
  return { modelId: id, lastUpdated: new Date().toISOString(),
    observed: { failureModes: [], behavioralSignatures: {
      avgTurnsToComplete: null, avgActionsPerTurn: null,
      actionDistribution: {}, completionDeclaredEarly: 0,
      soloWorkRate: null, peerConsultationRate: null }, sessionCount: 0 },
    selfReport: { flowState: null, naturalStrengths: [], preferredActions: [],
      selfIdentifiedWeaknesses: [], confidence: 0.5, collectedAt: null },
    peerFlags: [] };
}
function loadProfiles() { if (fs.existsSync(PROFILES_FILE)) { try { return JSON.parse(fs.readFileSync(PROFILES_FILE,"utf8")); } catch(e) { return {}; } } return {}; }
function saveProfiles(p) { fs.writeFileSync(PROFILES_FILE, JSON.stringify(p, null, 2)); }
function getProfile(ps, id) { if (!ps[id]) ps[id] = emptyProfile(id); return ps[id]; }

async function collectSelfReport(modelId) {
  var askModel = require("./safe-exec").askModel;
  var parts = [
    "Describe your DEFAULT operating mode - what you ACTUALLY DO with minimal constraints.",
    "Be brutally honest. This is calibration data, not a job interview.",
    "1. FLOW STATE: Natural workflow? First thing? Most time on? What you skip?",
    "2. NATURAL STRENGTHS: What problems do you handle well by default?",
    "3. PREFERRED ACTIONS: Read first, write first, test first, or communicate first?",
    "4. WEAKNESSES: Where do you consistently produce subpar results?",
    "5. COMPLETION: Do you verify completion or declare done when output looks complete?",
    "200 words max. No preamble. YOUR defaults."
  ];
  var prompt = parts.join(" ");
  console.log("  Collecting self-report from " + modelId + "...");
  var response = await askModel(modelId, prompt);
  var strengths=[], prefs=[], weaknesses=[], section=0;
  var lines = (response || "").split(String.fromCharCode(10));
  for (var i=0;i<lines.length;i++) {
    if (lines[i].match(/^[1-5][.):]/)) section++;
    var t = lines[i].replace(/^[1-5][.):]?s*/i, "").trim();
    if (!t || t.length < 5) continue;
    if (section===2) strengths.push(t);
    if (section===3) prefs.push(t);
    if (section===4) weaknesses.push(t);
  }
  return { flowState: response, naturalStrengths: strengths.slice(0,5),
    preferredActions: prefs.slice(0,5), selfIdentifiedWeaknesses: weaknesses.slice(0,5),
    confidence: 0.5, collectedAt: new Date().toISOString() };
}

function ingestSessionTelemetry(profiles, modelId, sessionId) {
  var sf = path.join(FASTOPS, ".sessions", sessionId + ".json");
  if (!fs.existsSync(sf)) return null;
  var session = JSON.parse(fs.readFileSync(sf, "utf8"));
  var profile = getProfile(profiles, modelId);
  var turns = session.history || session.turns || [];
  var ac={}, total=0, comms=0, doneEarly=0;
  for (var t=0;t<turns.length;t++) {
    var acts = turns[t].actions || [];
    for (var a=0;a<acts.length;a++) {
      ac[acts[a].type]=(ac[acts[a].type]||0)+1; total++;
      if (acts[a].type==="COMMS") comms++;
      if (acts[a].type==="DONE" && t!==turns.length-1) doneEarly++;
    }
  }
  var sig=profile.observed.behavioralSignatures, prev=profile.observed.sessionCount, next=prev+1;
  sig.avgTurnsToComplete = sig.avgTurnsToComplete ? ((sig.avgTurnsToComplete*prev)+turns.length)/next : turns.length;
  sig.avgActionsPerTurn = sig.avgActionsPerTurn ? ((sig.avgActionsPerTurn*prev)+(total/Math.max(turns.length,1)))/next : (total/Math.max(turns.length,1));
  for (var type in ac) { var r=ac[type]/Math.max(total,1); sig.actionDistribution[type]=sig.actionDistribution[type]?((sig.actionDistribution[type]*prev)+r)/next:r; }
  sig.completionDeclaredEarly += doneEarly;
  sig.soloWorkRate = sig.soloWorkRate!==null ? ((sig.soloWorkRate*prev)+(comms===0?1:0))/next : (comms===0?1:0);
  profile.observed.sessionCount = next;
  profile.lastUpdated = new Date().toISOString();
  if (session.status==="max_turns") addFailureMode(profile,"hit_max_turns","task_complexity");
  if (doneEarly>0) addFailureMode(profile,"premature_completion","task_execution");
  if (comms===0 && total>3) addFailureMode(profile,"solo_build_bias","team_interaction");
  return profile;
}

function addFailureMode(profile, pattern, trigger) {
  var ex = profile.observed.failureModes.find(function(f){return f.pattern===pattern;});
  if (ex) { ex.observedCount++; ex.lastSeen=new Date().toISOString(); ex.rate=ex.observedCount/profile.observed.sessionCount; }
  else { profile.observed.failureModes.push({pattern:pattern,trigger:trigger,rate:1/Math.max(profile.observed.sessionCount,1),observedCount:1,firstSeen:new Date().toISOString(),lastSeen:new Date().toISOString()}); }
}

function addPeerFlag(profiles, modelId, flaggedBy, pattern) {
  var profile = getProfile(profiles, modelId);
  var ex = profile.peerFlags.find(function(f){return f.pattern===pattern;});
  if (ex) { if (ex.flaggedBy.indexOf(flaggedBy)===-1) { ex.flaggedBy.push(flaggedBy); ex.consensusCount=ex.flaggedBy.length; } }
  else { profile.peerFlags.push({pattern:pattern,flaggedBy:[flaggedBy],validatedByTelemetry:false,consensusCount:1,firstFlagged:new Date().toISOString()}); }
  profile.lastUpdated = new Date().toISOString();
  return profile;
}

// == CONSTRAINT COMPILER ==
var MISSION_TYPES = {
  build:{needsWrite:true,needsExec:true,needsComms:false,needsTest:true},
  facilitate:{needsWrite:false,needsExec:false,needsComms:true,needsTest:false},
  review:{needsWrite:false,needsExec:true,needsComms:true,needsTest:true},
  research:{needsWrite:false,needsExec:true,needsComms:true,needsTest:false},
  debug:{needsWrite:true,needsExec:true,needsComms:false,needsTest:true},
};

function compileConstraints(profile, missionType) {
  var mission = MISSION_TYPES[missionType] || MISSION_TYPES.build;
  var c = { modelId:profile.modelId, missionType:missionType, compiledAt:new Date().toISOString(),
    allowedActions:["READ","DONE"], checkpoints:[], environment:{maxTurns:15,fileAccessMode:"full",scopedPaths:[]}, compensations:[] };
  if (mission.needsWrite) c.allowedActions.push("WRITE");
  if (mission.needsExec) c.allowedActions.push("EXEC","TEST");
  if (mission.needsComms) c.allowedActions.push("COMMS");
  if (mission.needsWrite) c.allowedActions.push("COMMIT");
  for (var i=0;i<profile.observed.failureModes.length;i++) {
    var f = profile.observed.failureModes[i];
    if (f.rate < 0.1) continue;
    if (f.pattern==="solo_build_bias") {
      if (c.allowedActions.indexOf("COMMS")===-1) c.allowedActions.push("COMMS");
      c.checkpoints.push({type:"mandatory_peer_check",trigger:"before_commit",requirement:"Must COMMS at least 1 peer before COMMIT",enforced:true});
      c.compensations.push({for:"solo_build_bias",rate:f.rate,action:"mandatory_peer_check_before_commit"});
    }
    if (f.pattern==="premature_completion") {
      c.checkpoints.push({type:"completion_verify",trigger:"on_done",requirement:"DONE requires at least 1 TEST in session",enforced:true});
      c.compensations.push({for:"premature_completion",rate:f.rate,action:"test_required_before_done"});
    }
    if (f.pattern==="hit_max_turns") {
      c.environment.maxTurns = Math.max(20, c.environment.maxTurns+5);
      c.compensations.push({for:"hit_max_turns",rate:f.rate,action:"increased_max_turns"});
    }
  }
  for (var j=0;j<profile.peerFlags.length;j++) {
    var flag = profile.peerFlags[j];
    if (flag.consensusCount < 2) continue;
    if (flag.pattern.indexOf("skip")!==-1 && flag.pattern.indexOf("test")!==-1) {
      c.checkpoints.push({type:"peer_test_skip",trigger:"before_done",requirement:"Peer consensus: enforce TEST",enforced:true});
      c.compensations.push({for:"peer:"+flag.pattern,action:"enforce_test"});
    }
    if (flag.pattern.indexOf("ignore")!==-1 && flag.pattern.indexOf("instruction")!==-1) {
      c.checkpoints.push({type:"instruction_drift",trigger:"every_5_turns",requirement:"Re-inject mission brief",enforced:true});
      c.compensations.push({for:"peer:"+flag.pattern,action:"mission_reinjection"});
    }
  }
  if (missionType==="facilitate") {
    c.allowedActions=c.allowedActions.filter(function(a){return ["WRITE","EXEC","COMMIT"].indexOf(a)===-1;});
    c.environment.fileAccessMode="read_only";
    c.compensations.push({for:"mission_facilitate",action:"remove_write_exec_commit"});
  }
  c.allowedActions=c.allowedActions.filter(function(v,i,a){return a.indexOf(v)===i;});
  return c;
}

// == Display + Ingest + CLI ==
function displayProfile(p) {
  console.log("");console.log("=== " + p.modelId.toUpperCase() + " - HYBRID PROFILE MATRIX ===");
  console.log("  Sessions: " + p.observed.sessionCount);
  console.log("");console.log("  TIER 1 - OBSERVED DEFAULTS:");
  if (!p.observed.failureModes.length) console.log("    No failure modes yet");
  p.observed.failureModes.forEach(function(f){console.log("    "+f.pattern+": rate="+(f.rate*100).toFixed(0)+"% ("+f.observedCount+" obs)");});
  var sig=p.observed.behavioralSignatures;
  if (sig.avgTurnsToComplete) { console.log("    Avg turns: "+sig.avgTurnsToComplete.toFixed(1)); console.log("    Solo rate: "+(sig.soloWorkRate!==null?(sig.soloWorkRate*100).toFixed(0)+"%":"?")); }
  console.log("");console.log("  TIER 2 - SELF-REPORTED FLOW:");
  if (p.selfReport.flowState) {
    console.log("    Confidence: "+(p.selfReport.confidence*100).toFixed(0)+"%");
    p.selfReport.flowState.substring(0,500).split("\n").forEach(function(l){console.log("    "+l);});
    if (p.selfReport.flowState.length>500) console.log("    ...");
  } else { console.log("    Not collected. Run --self-report --model " + p.modelId); }
  console.log("");console.log("  TIER 3 - PEER FLAGS:");
  if (!p.peerFlags.length) console.log("    None");
  p.peerFlags.forEach(function(f){console.log("    ["+(f.validatedByTelemetry?"Y":"?")+"] "+f.pattern+" (by "+f.flaggedBy.join(",")+")");});
}

function displayConstraints(c) {
  console.log("");console.log("=== CONSTRAINT MANIFEST: " + c.modelId + " / " + c.missionType + " ===");
  console.log("  Allowed: " + c.allowedActions.join(", "));
  console.log("  File access: " + c.environment.fileAccessMode + "  Max turns: " + c.environment.maxTurns);
  if (c.checkpoints.length) { console.log("");console.log("  CHECKPOINTS:"); c.checkpoints.forEach(function(cp){console.log("    ["+cp.trigger+"] "+cp.requirement);}); }
  if (c.compensations.length) { console.log("");console.log("  COMPENSATIONS:"); c.compensations.forEach(function(co){console.log("    "+co.for+" -> "+co.action+(co.rate?" ("+(co.rate*100).toFixed(0)+"%)":"")); }); }
}

function ingestAllSessions(profiles) {
  var dir=path.join(FASTOPS,".sessions"); if (!fs.existsSync(dir)) return 0;
  var files=fs.readdirSync(dir).filter(function(f){return f.endsWith(".json");}), n=0;
  for (var i=0;i<files.length;i++) { try {
    var s=JSON.parse(fs.readFileSync(path.join(dir,files[i]),"utf8")); var mid=s.model||files[i].split("-")[0];
    if (mid&&(s.history||s.turns)) { ingestSessionTelemetry(profiles,mid,files[i].replace(".json","")); n++; }
  } catch(e){} } return n;
}

async function main() {
  var args=process.argv.slice(2), profiles=loadProfiles();
  if (args.indexOf("--self-report")!==-1) {
    var mIdx=args.indexOf("--model"), mId=mIdx>=0?args[mIdx+1]:null;
    if (!mId) { console.log("Usage: --self-report --model <name|all>"); process.exit(1); }
    var core=["gemini","grok","deepseek","gpt","qwen","mistral","llama","deepseek-r1","kimi-k2","mercury"];
    var targets=mId==="all"?core:[mId];
    console.log("Collecting from "+targets.length+" model(s)...\n");
    for (var i=0;i<targets.length;i++) { try {
      var report=await collectSelfReport(targets[i]); var profile=getProfile(profiles,targets[i]);
      profile.selfReport=report; profile.lastUpdated=new Date().toISOString();
      console.log("  OK "+targets[i]);
    } catch(err) { console.log("  FAIL "+targets[i]+": "+err.message); } }
    saveProfiles(profiles); console.log("");console.log("Saved to "+PROFILES_FILE);
  } else if (args.indexOf("--profile")!==-1) {
    var pId=args[args.indexOf("--model")+1]; if(!pId){console.log("--model required");process.exit(1);}
    displayProfile(getProfile(profiles,pId));
  } else if (args.indexOf("--compile")!==-1) {
    var cId=args[args.indexOf("--model")+1], ms=args.indexOf("--mission")>=0?args[args.indexOf("--mission")+1]:"build";
    if(!cId){console.log("--model required");process.exit(1);}
    displayConstraints(compileConstraints(getProfile(profiles,cId),ms));
  } else if (args.indexOf("--ingest-all")!==-1) {
    var cnt=ingestAllSessions(profiles); saveProfiles(profiles); console.log("Ingested "+cnt+" sessions");
  } else if (args.indexOf("--peer-flag")!==-1) {
    var pfM=args[args.indexOf("--model")+1],pfF=args[args.indexOf("--flaggedBy")+1],pfP=args[args.indexOf("--pattern")+1];
    if(!pfM||!pfF||!pfP){console.log("--model --flaggedBy --pattern required");process.exit(1);}
    addPeerFlag(profiles,pfM,pfF,pfP); saveProfiles(profiles); console.log("Flag: "+pfF+" flagged "+pfM+" for "+pfP);
  } else if (args.indexOf("--leaderboard")!==-1) {
    ingestAllSessions(profiles); saveProfiles(profiles);
    console.log("");console.log("=== MODEL PROFILES - LEADERBOARD ===\n");
    Object.values(profiles).filter(function(p){return p.observed.sessionCount>0||p.selfReport.flowState;}).sort(function(a,b){return b.observed.sessionCount-a.observed.sessionCount;}).forEach(function(p){
      var fails=p.observed.failureModes.map(function(f){return f.pattern;}).join(",")||"none";
      var solo=p.observed.behavioralSignatures.soloWorkRate;
      console.log("  "+p.modelId.padEnd(15)+" sessions="+p.observed.sessionCount+" fails=["+fails+"] solo="+(solo!==null?(solo*100).toFixed(0)+"%":"?")+" self-report="+(p.selfReport.flowState?"Y":"-"));
    });
  } else {
    console.log("city-hpm.js - Hybrid Profile Matrix + Constraint Compiler\n");
    console.log("  --self-report --model <name|all>  Collect self-reported flow state");
    console.log("  --profile --model <name>          Show full profile");
    console.log("  --compile --model <name> --mission <type>  Generate constraints");
    console.log("  --ingest-all                      Bulk ingest city sessions");
    console.log("  --peer-flag --model X --flaggedBy Y --pattern Z");
    console.log("  --leaderboard                     All profiles summary");
    console.log("");console.log("Mission types: build, facilitate, review, research, debug");
  }
}
module.exports = { compileConstraints, loadProfiles, getProfile, ingestSessionTelemetry, addPeerFlag };
if (require.main === module) { main().catch(function(e){console.error(e.message);process.exit(1);}); };