const SUBJECTS=["Mathematics","English Language","Physics","Chemistry","Biology","Economics","Civic Education","Computer Studies"];
const CLASSES=["JSS 1","JSS 2","JSS 3","SS 1","SS 2","SS 3"];
const TERMS=["First Term","Second Term","Third Term"];
const DEMO={session:"2026/2027",term:"First Term",status:{},students:[],scores:{},portalUsers:[]};
const LABEL={draft:"Draft – teachers editing",submitted:"Submitted – awaiting principal",published:"Published to students"};
let auth=null,profileDb=null;
let sr=null;
const statusOf=(t,s,c)=>(D.status||{})[`${t}|${s}|${c}`]||"draft";
const canEdit=st=>sr==="principal"?st!=="published":st==="draft";
let D=JSON.parse(JSON.stringify(DEMO)),role=null,me=null,tab="results",note=null,remoteState=null,filt={cls:"SS 2"},userActivationType="student";
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>\"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const grade=t=>t>=70?["A","Excellent"]:t>=60?["B","Very Good"]:t>=50?["C","Good"]:t>=45?["D","Fair"]:t>=40?["E","Pass"]:["F","Fail"];
const key=id=>`${D.term}|${D.session}|${id}`;
function setUserActivationType(v){userActivationType=v;render();}

// ---------- Firestore data access ----------
const docId=value=>encodeURIComponent(value);
const scoreId=(term,session,id)=>docId(`${term}|${session}|${id}`);
const classId=(term,session,cls)=>docId(`${term}|${session}|${cls}`);
const classKey=(term,session,cls)=>`${term}|${session}|${cls}`;
async function ensureFirebase(){
  if(window.portalServices){auth=window.portalServices.auth;profileDb=window.portalServices.profileDb;return;}
  await new Promise(resolve=>window.addEventListener("firebase-ready",resolve,{once:true}));
  auth=window.portalServices.auth;profileDb=window.portalServices.profileDb;
}
async function loadPortalData(user,accountRole){
  await ensureFirebase();
  D=JSON.parse(JSON.stringify(DEMO));
  remoteState={students:{},scores:{},status:{},settings:{session:D.session,term:D.term}};
  const settings=await profileDb.collection("settings").doc("portal").get();
  if(settings.exists){D.session=settings.data().session||D.session;D.term=settings.data().term||D.term;}
  remoteState.settings={session:D.session,term:D.term};
  if(accountRole==="student"){
    me=null;
    const studentQuery=await profileDb.collection("students").where("uid","==",user.uid).limit(1).get();
    if(studentQuery.empty)return;
    const data=studentQuery.docs[0].data();
    const student={id:data.studentId,name:data.name,cls:data.cls,uid:data.uid};
    D.students=[student];me=student;
    remoteState.students[student.id]=student;
    const results=await profileDb.collection("results").where("uid","==",user.uid).where("status","==","published").get();
    results.forEach(snapshot=>{
      const result=snapshot.data(),key=keyFor(result.term,result.session,result.studentId);
      D.scores[key]=result.scores||{};
      D.status[classKey(result.term,result.session,result.cls)]="published";
      remoteState.scores[key]=result;
    });
  }else{
    const [students,results,statuses,users]=await Promise.all([
      profileDb.collection("students").get(),profileDb.collection("results").get(),profileDb.collection("classStatuses").get(),profileDb.collection("users").get()
    ]);
    students.forEach(snapshot=>{const data=snapshot.data(),student={id:data.studentId,name:data.name,cls:data.cls,uid:data.uid};D.students.push(student);remoteState.students[student.id]=student;});
    results.forEach(snapshot=>{const result=snapshot.data(),key=keyFor(result.term,result.session,result.studentId);D.scores[key]=result.scores||{};remoteState.scores[key]=result;});
    statuses.forEach(snapshot=>{const status=snapshot.data(),key=classKey(status.term,status.session,status.cls);D.status[key]=status.status;remoteState.status[key]=status;});
    users.forEach(snapshot=>{const data=snapshot.data(); if(data.role==="teacher"||data.role==="principal")D.portalUsers.push({uid:snapshot.id,email:data.email||"",role:data.role,studentId:data.studentId||""});});
  }
  $("#sync").textContent="Firebase connected";
}
async function save(){
  await ensureFirebase();
  if(!auth.currentUser||!remoteState)throw new Error("Sign in before saving data.");
  const batchWrites=[];
  const add= (ref,data,remove=false)=>batchWrites.push({ref,data,remove});
  for(const student of D.students){
    const prior=remoteState.students[student.id];
    if(JSON.stringify(prior)!==JSON.stringify(student))add(profileDb.collection("students").doc(student.uid),{studentId:student.id,uid:student.uid,name:student.name,cls:student.cls});
  }
  for(const [id,student] of Object.entries(remoteState.students))if(!D.students.some(item=>item.id===id))add(profileDb.collection("students").doc(student.uid),null,true);
  const scoreKeys=new Set([...Object.keys(remoteState.scores),...Object.keys(D.scores)]);
  for(const key of scoreKeys){
    const [term,session,studentId]=key.split("|");
    const student=D.students.find(item=>item.id===studentId);
    const scores=D.scores[key];
    const prior=remoteState.scores[key];
    if(!scores||!Object.keys(scores).length){if(prior)add(profileDb.collection("results").doc(scoreId(term,session,studentId)),null,true);continue;}
    const status=D.status[classKey(term,session,student?.cls||prior?.cls)]||"draft";
    const cls=student?.cls||prior?.cls;
    const result={term,session,studentId,uid:student?.uid||prior?.uid,cls,classStatusId:classId(term,session,cls),scores,status:status==="published"?"published":"draft"};
    if(JSON.stringify(prior)!==JSON.stringify(result))add(profileDb.collection("results").doc(scoreId(term,session,studentId)),result);
  }
  const statusKeys=new Set([...Object.keys(remoteState.status),...Object.keys(D.status)]);
  for(const key of statusKeys){
    const [term,session,cls]=key.split("|");
    const status=D.status[key];
    const prior=remoteState.status[key];
    if(!status){if(prior)add(profileDb.collection("classStatuses").doc(classId(term,session,cls)),null,true);continue;}
    const value={term,session,cls,status};
    if(JSON.stringify(prior)!==JSON.stringify(value))add(profileDb.collection("classStatuses").doc(classId(term,session,cls)),value);
  }
  if(remoteState.settings.session!==D.session||remoteState.settings.term!==D.term)
    add(profileDb.collection("settings").doc("portal"),{session:D.session,term:D.term});
  for(let offset=0;offset<batchWrites.length;offset+=450){
    const batch=profileDb.batch();
    batchWrites.slice(offset,offset+450).forEach(write=>write.remove?batch.delete(write.ref):batch.set(write.ref,write.data));
    await batch.commit();
  }
  await loadPortalData(auth.currentUser,sr||"student");
}

// ---------- auth ----------
function logout(){auth.signOut().catch(()=>{});role=null;me=null;sv=null;sr=null;remoteState=null;note=null;render();}
async function login(){
  const email=$("#email").value.trim(),password=$("#password").value;
  if(!email||!password){note={t:"Enter your email and password.",e:1};render();return;}
  let stage="connecting to Firebase";
  try{
    await ensureFirebase();
    stage="checking your email and password";
    const result=await auth.signInWithEmailAndPassword(email,password);
    if(!result.user.emailVerified){
      stage="sending the email verification message";
      await auth.sendEmailVerification(result.user);
      await auth.signOut();
      throw new Error("Password accepted, but this email is not verified yet. Open Firebase's verification email (check spam too), verify the address, then sign in again.");
    }
    stage="loading your Firebase role profile";
    const snapshot=await profileDb.collection("users").doc(result.user.uid).get();
    const profile=snapshot.exists?snapshot.data():null;
    const expected=lt==="student"?"student":["teacher","principal"];
    if(!profile||!(Array.isArray(expected)?expected.includes(profile.role):profile.role===expected)){
      await auth.signOut();throw new Error("This account is not set up for the selected portal.");
    }
    stage="loading portal records from Firestore";
    await loadPortalData(result.user,profile.role);
    if(profile.role==="student"){
      if(!me){await auth.signOut();throw new Error("Your student profile is not linked yet. Contact the school office.");}
      if(profile.studentId!==me.id){await auth.signOut();throw new Error("Your student account link does not match the school record. Contact the school office.");}
      role="student";sr=null;
    }else{role="staff";sr=profile.role;tab="results";}
    note=null;render();
  }catch(e){
    const known=[
      "This account is not set up for the selected portal.",
      "Your student account link does not match the school record. Contact the school office."
    ];
    let message=known.includes(e.message)||e.message.startsWith("Password accepted,")||e.message.startsWith("Your student profile")?e.message:"";
    if(!message&&e.code==="auth/invalid-credential")message="Firebase did not accept that email/password. If you just reset it, open the newest reset email and finish the reset before trying again.";
    if(!message&&e.code==="auth/unauthorized-domain")message="This page's website address is not authorized in Firebase. Open the portal at http://localhost:8000, not from a file:// tab.";
    if(!message&&e.code==="auth/too-many-requests")message="Too many sign-in attempts. Wait a few minutes, then try again or request a password reset.";
    if(!message&&e.code==="auth/network-request-failed")message="Could not reach Firebase. Check your internet connection and retry.";
    if(!message&&e.code==="permission-denied")message="Your password was accepted, but Firestore denied this account. Check that its users/{UID} role document is correct and that the published rules match firestore.rules.";
    if(!message&&e.code==="failed-precondition")message="Firestore needs an index or database setup change. Check the browser console for the Firebase error details.";
    if(!message){
      const detail=e.code||e.message||"unknown error";
      message=`Sign-in stopped while ${stage} (${detail}). Check this step and retry.`;
      console.error("Portal sign-in failed",{stage,code:e.code,message:e.message});
    }
    note={t:message,e:1};render();}
}
function loginStudent(){login();}
function loginStaff(){login();}
async function resetPassword(){
  const email=$("#email").value.trim();
  if(!email){note={t:"Enter your account email first, then choose Forgot password.",e:1};render();return;}
  try{
    await ensureFirebase();
    await auth.sendPasswordResetEmail(email);
    note={t:"If an account exists for that email, a password reset link has been sent."};
  }catch(e){
    const message=e.code==="auth/configuration-not-found"||e.code==="auth/operation-not-allowed"
      ?"Firebase Authentication is not enabled yet. In Firebase Console, enable Email/Password under Authentication > Sign-in method."
      :e.code==="auth/unauthorized-domain"
        ?"This website domain is not authorized in Firebase. Add localhost under Authentication > Settings > Authorized domains."
        :"Password reset could not be sent. Check the email address and Firebase setup, then try again.";
    note={t:message,e:1};
  }
  render();}
let lt="student";
function setLt(t){lt=t;note=null;render();}

// ---------- views ----------
function render(){
  $("#out").style.display=role?"":"none";
  const a=$("#app");
  if(!role) a.innerHTML=loginView();
  else if(role==="student") a.innerHTML=studentView();
  else a.innerHTML=staffView();
}
const noteH=()=>note?`<div class="msg ${note.e?"err":""}">${esc(note.t)}</div>`:"";
function loginView(){
  return `<div class="login card"><h2>Secure school portal</h2><p class="hint">Access academic records and student performance information with secure sign-in.</p>
  ${location.protocol==="file:"?`<div class="msg err">Firebase sign-in will not work from a file tab. Open <a href="http://localhost:8000">http://localhost:8000</a> instead.</div>`:""}
  <div class="tabs"><button class="${lt=="student"?"on":""}" onclick="setLt('student')">Student</button><button class="${lt=="staff"?"on":""}" onclick="setLt('staff')">Staff</button></div>
  <label for="email">Account email</label><input id="email" type="email" autocomplete="username" required>
  <label for="password">Password</label><input id="password" type="password" autocomplete="current-password" onkeydown="if(event.key=='Enter')login()" required>
  <br><br><button style="width:100%" onclick="login()">${lt==="student"?"View my results":"Staff sign in"}</button>
  <p><button class="ghost" type="button" onclick="resetPassword()">Forgot password?</button></p>
  <p class="hint">Password recovery links are sent to the verified email on the account.</p>
  ${noteH()}</div>`;
}
let sv=null;
const keyFor=(t,s,id)=>`${t}|${s}|${id}`;
function periodsOf(id){
  const set=new Set([D.term+"|"+D.session]);
  if(D.scores[keyFor(D.term,D.session,id)])set.add(D.term+"|"+D.session);
  for(const k of Object.keys(D.scores)){const p=k.split("|");if(p[2]===id&&Object.keys(D.scores[k]).length&&statusOf(p[0],p[1],me.cls)==="published")set.add(p[0]+"|"+p[1]);}
  return [...set].sort((x,y)=>{const[a,b]=x.split("|"),[c,d]=y.split("|");return d.localeCompare(b)||TERMS.indexOf(c)-TERMS.indexOf(a);});
}
function setSv(v){sv=v;render();}
function studentView(){
  const per=periodsOf(me.id);if(!sv||!per.includes(sv))sv=per[0];
  const [t,s]=sv.split("|");
  const sc=statusOf(t,s,me.cls)==="published"?D.scores[keyFor(t,s,me.id)]:null;
  let rows="",sum=0,n=0;
  if(sc){for(const sub of SUBJECTS){const v=sc[sub];if(!v)continue;const tt=(+v[0]||0)+(+v[1]||0);const g=grade(tt);sum+=tt;n++;
    rows+=`<tr><td>${sub}</td><td>${v[0]}</td><td>${v[1]}</td><td><b>${tt}</b></td><td><span class="pill">${g[0]}</span></td><td>${g[1]}</td></tr>`;}}
  const avg=n?(sum/n).toFixed(1):0;
  return `<div class="card noprint"><label style="margin-top:0">View results for</label>
  <select onchange="setSv(this.value)">${per.map(p=>{const[a,b]=p.split("|");return `<option value="${p}" ${p===sv?"selected":""}>${a} · ${b}</option>`}).join("")}</select></div>
  <div class="card"><div class="slip-head"><div><h2>${esc(me.name)}</h2><span class="hint">${esc(me.id)} · ${esc(me.cls)}</span></div>
  <div style="text-align:right"><b>${esc(t)}</b><br><span class="hint">${esc(s)} Session</span></div></div>
  ${n?`<div class="scroll"><table><tr><th>Subject</th><th>CA (40)</th><th>Exam (60)</th><th>Total</th><th>Grade</th><th>Remark</th></tr>${rows}</table></div>
  <div class="stats"><div><b>${sum}</b>Total score</div><div><b>${avg}%</b>Average</div><div><b>${grade(+avg)[0]}</b>Overall</div></div>
  <p><button class="noprint" onclick="window.print()">Print / save PDF</button></p>`
  :`<p class="hint">No results have been published for this term yet. Please check back later.</p>`}</div>
  ${noteH()}`;
}
function staffView(){
  const T=[["results","Enter results"]];
  if(sr==="principal")T.push(["approvals","Approvals"],["activate","Activate users"]);
  T.push(["students","Students"],["upload","CSV upload"]);
  if(sr==="principal")T.push(["settings","Term settings"]);
  if(!T.some(t=>t[0]===tab))tab="results";
  return `<div class="card" style="padding:10px 16px"><span class="hint">Signed in as <b>${sr==="principal"?"Principal":"Teacher"}</b></span></div>
  <div class="tabs">${T.map(t=>`<button class="${tab==t[0]?"on":""}" onclick="tab='${t[0]}';note=null;render()">${t[1]}</button>`).join("")}</div>${noteH()}`+
  ({results:resultsView,approvals:approvalsView,activate:activateUsersView,students:studentsView,upload:uploadView,settings:settingsView}[tab])();
}
async function activatePortalUser(){
  if(sr!=="principal"){note={t:"Only the principal can activate new accounts.",e:1};render();return;}
  const type=userActivationType;
  const email=$("#new-user-email").value.trim();
  const password=$("#new-user-password").value;
  const name=$("#new-user-name").value.trim();
  const studentId=$("#new-user-student-id").value.trim().toUpperCase();
  const cls=$("#new-user-class").value;
  if(!email||!password){note={t:"Enter an email and password for the new account.",e:1};render();return;}
  if(password.length<6){note={t:"Use a password with at least 6 characters.",e:1};render();return;}
  if(type==="student"&&(!name||!studentId||!cls)){note={t:"Enter the student's full name, student ID, and class before activating the account.",e:1};render();return;}
  try{
    await ensureFirebase();
    let result;
    if(window.portalServices && window.portalServices.callFunction){
      try{
        const response = await window.portalServices.callFunction("activatePortalUser", {
          role:type,
          email,
          password,
          name,
          studentId,
          cls
        });
        result = response.data;
      }catch(callError){
        if(callError.code === "functions/failed-precondition" || callError.code === "functions/not-found" || callError.code === "functions/permission-denied"){
          const user = await auth.createUserWithEmailAndPassword(email,password);
          const userDoc={role:type,email};
          if(type==="student")userDoc.studentId=studentId;
          await profileDb.collection("users").doc(user.user.uid).set(userDoc);
          if(type==="student")await profileDb.collection("students").doc(user.user.uid).set({studentId,uid:user.user.uid,name,cls});
          await auth.sendEmailVerification(user.user);
          result={uid:user.user.uid,email:user.user.email,role:type};
        }else{
          throw callError;
        }
      }
    }else{
      const user = await auth.createUserWithEmailAndPassword(email,password);
      const userDoc={role:type,email};
      if(type==="student")userDoc.studentId=studentId;
      await profileDb.collection("users").doc(user.user.uid).set(userDoc);
      if(type==="student")await profileDb.collection("students").doc(user.user.uid).set({studentId,uid:user.user.uid,name,cls});
      await auth.sendEmailVerification(user.user);
      result={uid:user.user.uid,email:user.user.email,role:type};
    }
    note={t:type==="student"?`${name} has been activated as a student.`:`${email} has been activated as a teacher.`};
    $("#new-user-email").value="";$("#new-user-password").value="";$("#new-user-name").value="";$("#new-user-student-id").value="";userActivationType="student";tab="activate";render();
  }catch(e){
    const message=e.code==="auth/email-already-in-use"?"That email is already registered in Firebase. Use a different email or recover the account first."
      :e.code==="auth/weak-password"?"Choose a stronger password with at least 6 characters."
      :e.code==="auth/invalid-email"?"Use a valid email address for the new user."
      :e.message||"The new account could not be activated. Check the Firebase setup and try again.";
    note={t:message,e:1};render();
  }
}
async function deletePortalUser(uid,name){
  if(sr!=="principal"){note={t:"Only the principal can delete users.",e:1};render();return;}
  if(!uid||!confirm(`Delete ${name || 'this user'} and their portal records? This cannot be undone.`))return;
  try{
    await ensureFirebase();
    if(window.portalServices && window.portalServices.callFunction){
      await window.portalServices.callFunction("deletePortalUser", {uid});
    }else{
      const userDoc=await profileDb.collection("users").doc(uid).get();
      const role=userDoc.exists ? userDoc.data().role : null;
      if(role!=="student"&&role!=="teacher") throw new Error("Not a portal user.");
      await profileDb.collection("users").doc(uid).delete();
      if(role==="student")await profileDb.collection("students").doc(uid).delete();
      const results=await profileDb.collection("results").where("uid","==",uid).get();
      const batch=profileDb.batch();
      results.forEach(doc=>batch.delete(doc.ref));
      await batch.commit();
      try{await auth.deleteUser(uid);}catch(e){if(e.code!=='auth/user-not-found')throw e;}
    }
    note={t:`${name || 'User'} was removed from the portal.`};
    render();
  }catch(e){
    note={t:(e&&e.message)||"The account could not be deleted. The user may still exist in Firebase Authentication.",e:1};render();
  }
}
function activateUsersView(){
  return `<div class="card"><h2>Activate new accounts</h2><p class="hint">Create student and teacher accounts from the portal and send an email verification automatically.</p>
  <div class="row"><div><label>Account type</label><select onchange="setUserActivationType(this.value)">${["student","teacher"].map(v=>`<option value="${v}" ${userActivationType===v?"selected":""}>${v=="student"?"Student":"Teacher"}</option>`).join("")}</select></div></div>
  ${userActivationType==="student"?`<div class="row" style="margin-top:12px"><div><label>Full name</label><input id="new-user-name"></div><div><label>Student ID</label><input id="new-user-student-id" placeholder="GFC/26/004"></div><div><label>Class</label><select id="new-user-class">${CLASSES.map(c=>`<option>${c}</option>`).join("")}</select></div></div>`:""}
  <div class="row" style="margin-top:12px"><div><label>Email address</label><input id="new-user-email" type="email" placeholder="name@example.com"></div><div><label>Password</label><input id="new-user-password" type="password" placeholder="At least 6 characters"></div></div>
  <br><button onclick="activatePortalUser()">Activate account</button>
  <div style="margin-top:16px"><h3>Current portal users</h3>${renderPortalUserRows()}</div></div>`;
}
function renderPortalUserRows(){
  if(sr!=="principal")return "<p class=\"hint\">Only the principal can manage users.</p>";
  const staffRows=D.portalUsers.filter(u=>u.role==="teacher"||u.role==="principal").map(user=>`<tr><td>${user.role==="principal"?"Principal":"Teacher"}</td><td>${esc(user.email||"Unknown")}</td><td>${esc(user.studentId||"-")}</td><td>${esc(user.uid)}</td><td><button class="danger" onclick="deletePortalUser('${user.uid}','${esc(user.email||user.uid)}')">Delete</button></td></tr>`).join("");
  const studentRows=D.students.map(s=>`<tr><td>Student</td><td>${esc(s.name)}</td><td>${esc(s.id)}</td><td>${esc(s.uid)}</td><td><button class="danger" onclick="deletePortalUser('${s.uid}','${esc(s.name)}')">Delete</button></td></tr>`).join("");
  const rows=`${staffRows}${studentRows}`;
  return `<div class="scroll"><table><tr><th>Role</th><th>Name / Email</th><th>Student ID</th><th>UID</th><th></th></tr>${rows || '<tr><td colspan="5"><span class="hint">No active staff or students yet.</span></td></tr>'}</table></div>`;
}
function resultsView(){
  const list=D.students.filter(s=>s.cls===filt.cls);
  const st=statusOf(D.term,D.session,filt.cls),ed=canEdit(st),dis=ed?"":"disabled";
  const banner=`<p>Status: <span class="pill">${LABEL[st]}</span></p>`;
  let actions="";
  if(ed){actions=`<button onclick="saveResults()">Save results</button> `;
    if(sr==="teacher")actions+=`<button class="ghost" onclick="submitClass('${filt.cls}')">Submit to principal</button>`;
    else if(st==="submitted")actions+=`<button class="ghost" onclick="setStatus('${filt.cls}','published')">Approve &amp; publish</button> <button class="ghost" onclick="setStatus('${filt.cls}','draft')">Return to teachers</button>`;
    else actions+=`<span class="hint">Waiting for teachers to submit this class.</span>`;}
  else if(sr==="principal")actions=`<button class="ghost" onclick="setStatus('${filt.cls}','submitted')">Unpublish</button>`;
  else actions=`<span class="hint">Locked. Only the principal can change this class now.</span>`;
  const head=SUBJECTS.map(s=>`<th>${s.split(" ")[0]}<br>CA / Exam</th>`).join("");
  const body=list.map(s=>{const sc=D.scores[key(s.id)]||{};
    return `<tr><td><b>${esc(s.name)}</b><br><span class="hint">${esc(s.id)}</span></td>${SUBJECTS.map((sub,i)=>{const v=sc[sub]||["",""];
      return `<td><input type="number" min="0" max="40" ${dis} value="${v[0]}" data-s="${esc(s.id)}" data-j="${i}" data-k="0"> <input type="number" min="0" max="60" ${dis} value="${v[1]}" data-s="${esc(s.id)}" data-j="${i}" data-k="1"></td>`}).join("")}</tr>`}).join("");
  return `<div class="card"><h2>Enter &amp; edit results</h2><p class="hint">${esc(D.term)} · ${esc(D.session)}. CA is out of 40, exam out of 60.</p>
  ${banner}<label>Class</label><select onchange="filt.cls=this.value;render()">${CLASSES.map(c=>`<option ${c==filt.cls?"selected":""}>${c}</option>`).join("")}</select>
  ${list.length?`<div class="scroll" style="margin-top:12px"><table style="min-width:1500px"><tr><th>Student</th>${head}</tr>${body}</table></div><br>${actions}`:`<p class="hint">No students in this class yet. Add them under Students.</p>`}</div>`;
}
async function saveResults(quiet){
  if(!canEdit(statusOf(D.term,D.session,filt.cls))){note={t:"This class is locked.",e:1};render();return false;}
  let bad=0;
  document.querySelectorAll("td input[data-s]").forEach(el=>{
    const id=el.dataset.s,sub=SUBJECTS[+el.dataset.j],k=+el.dataset.k;
    const max=k?60:40;let v=el.value;
    if(v!==""&&(+v<0||+v>max)){bad++;return;}
    const o=D.scores[key(id)]=D.scores[key(id)]||{};
    o[sub]=o[sub]||["",""];o[sub][k]=v===""?"":+v;
    if(o[sub][0]===""&&o[sub][1]==="")delete o[sub];
  });
  try{await save();}catch(e){note={t:"Could not save results. Check your connection and account permissions.",e:1};render();return false;}
  if(!quiet){note=bad?{t:`${bad} score(s) out of range were skipped.`,e:1}:{t:"Saved as draft. Students cannot see it until the principal publishes."};render();}
  return !bad;}
async function submitClass(cls){
  if(!await saveResults(true)){note={t:"Fix the out-of-range scores before submitting.",e:1};render();return;}
  const has=D.students.some(s=>s.cls===cls&&Object.keys(D.scores[key(s.id)]||{}).length);
  if(!has){note={t:"Enter at least some results before submitting.",e:1};render();return;}
  await setStatus(cls,"submitted");}
async function setStatus(cls,st){
  if(st==="published"&&(sr!=="principal"||statusOf(D.term,D.session,cls)!=="submitted"))return;
  D.status=D.status||{};D.status[`${D.term}|${D.session}|${cls}`]=st;
  try{await save();}catch(e){note={t:"Could not update class status. Check your account permissions.",e:1};render();return;}
  note={t:st==="submitted"?(sr==="teacher"?`${cls} submitted to the principal.`:`${cls} unpublished.`):st==="published"?`${cls} is now live for students.`:`${cls} returned to teachers.`};render();}
function approvalsView(){
  const rows=CLASSES.map(c=>{const st=statusOf(D.term,D.session,c);
    const n=D.students.filter(s=>s.cls===c).length,r=D.students.filter(s=>s.cls===c&&Object.keys(D.scores[key(s.id)]||{}).length).length;
    const btn=st==="submitted"?`<button onclick="setStatus('${c}','published')">Approve &amp; publish</button> <button class="ghost" onclick="setStatus('${c}','draft')">Return</button>`:st==="published"?`<button class="ghost" onclick="setStatus('${c}','submitted')">Unpublish</button>`:`<span class="hint">Waiting for teachers</span>`;
    return `<tr><td><b>${c}</b></td><td>${r}/${n}</td><td><span class="pill">${LABEL[st]}</span></td><td>${btn}</td></tr>`}).join("");
  return `<div class="card"><h2>Approvals</h2><p class="hint">${esc(D.term)} · ${esc(D.session)}. Results go live for students only when you publish them.</p>
  <div class="scroll"><table><tr><th>Class</th><th>Students with results</th><th>Status</th><th></th></tr>${rows}</table></div></div>`;
}
function studentsView(){
  const rows=D.students.map((s,i)=>`<tr><td>${esc(s.id)}</td><td>${esc(s.name)}</td><td>${esc(s.cls)}</td><td>${sr==="principal"?`<button class="danger" onclick="delStu(${i})">Remove</button>`:""}</td></tr>`).join("");
  return `<div class="card"><h2>Add student</h2><div class="row"><div><label>Full name</label><input id="an"></div><div><label>Student ID</label><input id="ai" placeholder="GFC/26/004"></div>
  <div><label>Class</label><select id="ac">${CLASSES.map(c=>`<option>${c}</option>`).join("")}</select></div><div><label>Firebase Auth UID</label><input id="au" placeholder="From Firebase Authentication"></div></div><br><button onclick="addStu()">Add student</button>
  <p class="hint">Create the student's Firebase account and users/{UID} role profile first, then link that Auth UID here.</p></div>
  <div class="card"><h2>All students (${D.students.length})</h2><div class="scroll"><table><tr><th>ID</th><th>Name</th><th>Class</th><th></th></tr>${rows}</table></div></div>`;
}
async function addStu(){
  const s={name:$("#an").value.trim(),id:$("#ai").value.trim().toUpperCase(),cls:$("#ac").value,uid:$("#au").value.trim()};
  if(!s.name||!s.id||!s.uid)note={t:"Enter a name, student ID, and the student's Firebase Auth UID.",e:1};
  else if(D.students.some(x=>x.id===s.id))note={t:"That Student ID already exists.",e:1};
  else if(D.students.some(x=>x.uid===s.uid))note={t:"That Firebase account is already linked to a student.",e:1};
  else{D.students.push(s);try{await save();note={t:`${s.name} added.`};}catch(e){D.students.pop();note={t:"Could not add student. Check your account permissions.",e:1};}}
  render();}
async function delStu(i){if(!confirm("Remove this student and their results?"))return;
  const s=D.students[i];D.students.splice(i,1);Object.keys(D.scores).forEach(k=>{if(k.endsWith("|"+s.id))delete D.scores[k]});
  try{await save();render();}catch(e){note={t:"Could not remove student. Check your account permissions.",e:1};render();}}
function uploadView(){
  return `<div class="card"><h2>Bulk upload (CSV)</h2><p class="hint">One row per score: <b>student_id, subject, ca, exam</b>. Subject names must match: ${SUBJECTS.join(", ")}.</p>
  <textarea id="csv" rows="7" placeholder="GFC/26/002,Mathematics,30,48&#10;GFC/26/002,Physics,27,41"></textarea>
  <label>Or choose a file</label><input type="file" accept=".csv,text/csv" onchange="readCsv(this.files[0])"><br><br><button onclick="importCsv()">Import for ${esc(D.term)}</button></div>`;
}
function readCsv(f){if(!f)return;const r=new FileReader();r.onload=()=>{$("#csv").value=r.result};r.readAsText(f);}
async function importCsv(){
  const lines=$("#csv").value.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);let ok=0,skip=0;
  for(const l of lines){const [id,sub,ca,ex]=l.split(",").map(x=>x.trim());
    if(!id||/^student/i.test(id))continue;
    const st=D.students.find(s=>s.id.toUpperCase()===id.toUpperCase());
    const sj=SUBJECTS.find(s=>s.toLowerCase()===(sub||"").toLowerCase());
    if(!st||!canEdit(statusOf(D.term,D.session,st.cls))||!sj||isNaN(+ca)||isNaN(+ex)||+ca>40||+ex>60||+ca<0||+ex<0){skip++;continue;}
    const o=D.scores[key(st.id)]=D.scores[key(st.id)]||{};o[sj]=[+ca,+ex];ok++;}
  try{await save();note={t:`Imported ${ok} score(s). Skipped ${skip} invalid row(s).`,e:!ok&&skip};}catch(e){note={t:"Could not import results. Check your account permissions.",e:1};}render();}
async function saveSettings(){
  D.session=$("#ses").value.trim()||D.session;D.term=$("#trm").value;
  try{await save();note={t:"Term updated."};}catch(e){note={t:"Could not update term settings. Check your account permissions.",e:1};}
  render();}
function settingsView(){
  return `<div class="card"><h2>Term settings</h2><div class="row"><div><label>Session</label><input id="ses" value="${esc(D.session)}"></div>
  <div><label>Term</label><select id="trm">${TERMS.map(t=>`<option ${t==D.term?"selected":""}>${t}</option>`).join("")}</select></div></div><br>
  <button onclick="saveSettings()">Save</button></div>`;
}
render();
