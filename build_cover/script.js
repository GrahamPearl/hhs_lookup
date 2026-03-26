const PREFIX="teacher_";

let teacherCache={};

function refreshTeachers(){
 let sel=document.getElementById("absenceTeacherSelect");
 sel.innerHTML="";
 Object.keys(localStorage).forEach(k=>{
  if(k.startsWith(PREFIX)){
    let name=k.replace(PREFIX,"");
    let o=document.createElement("option");
    o.value=name;
    o.textContent=name;
    sel.appendChild(o);
  }
 });
}

function loadTeacher(name){
 if(!teacherCache[name]){
   teacherCache[name]=JSON.parse(localStorage.getItem(PREFIX+name));
 }
 return teacherCache[name];
}

function compute(absent,day){
 let scores={}, availability={}, subjects={};

 Object.keys(localStorage).forEach(k=>{
   if(!k.startsWith(PREFIX)) return;
   let name=k.replace(PREFIX,"");
   if(name===absent) return;

   let data=loadTeacher(name);
   let free=0;

   for(let c=0;c<data.config.cols;c++){
     let entry=data.entries?.find(e=>e.row==day && e.col==c);
     if(entry && entry.type==="free"){
       free++;
       if(!availability[c]) availability[c]=[];
       availability[c].push(name);
     }
     if(entry && entry.subject){
       subjects[name]=subjects[name]||new Set();
       subjects[name].add(entry.subject);
     }
   }
   scores[name]=free;
 });

 return {scores,availability,subjects};
}

function suggest(res,absent){
 let absentData=loadTeacher(absent);
 let best=null,score=-1;

 Object.keys(res.scores).forEach(name=>{
   let s=res.scores[name];

   // subject match bonus
   let match=0;
   absentData.entries?.forEach(e=>{
     if(e.subject && res.subjects[name]?.has(e.subject)) match+=2;
   });

   let finalScore = s + match;

   if(finalScore>score){
     score=finalScore;
     best=name;
   }
 });

 return {best,score};
}

function render(res,absent){
 let div=document.getElementById("results");
 let bestDiv=document.getElementById("best");

 let html="";
 Object.keys(res.availability).forEach(p=>{
   html+=`<div>P${parseInt(p)+1}: ${res.availability[p].join(", ")}</div>`;
 });
 div.innerHTML=html;

 let best=suggest(res,absent);
 bestDiv.classList.remove("d-none");
 bestDiv.innerText="Best: "+best.best+" (score "+best.score+")";

 buildDragGrid(res);
}

function buildDragGrid(res){
 let grid=document.getElementById("grid");
 grid.innerHTML="";

 Object.keys(res.availability).forEach(p=>{
   let col=document.createElement("div");
   col.className="col-md-2";

   let h=document.createElement("h6");
   h.innerText="P"+(parseInt(p)+1);
   col.appendChild(h);

   res.availability[p].forEach(name=>{
     let div=document.createElement("div");
     div.className="cell free";
     div.innerText=name;
     div.draggable=true;

     div.ondragstart=e=>{
       e.dataTransfer.setData("text",name);
     };

     col.appendChild(div);
   });

   grid.appendChild(col);
 });
}

document.getElementById("checkBtn").onclick=()=>{
 let t=document.getElementById("absenceTeacherSelect").value;
 let d=parseInt(document.getElementById("absenceDaySelect").value);
 let res=compute(t,d);
 render(res,t);
};

// BULK IMPORT
document.getElementById("bulkBtn").onclick=()=>{
 document.getElementById("bulkInput").click();
};

document.getElementById("bulkInput").addEventListener("change",async e=>{
 let files=Array.from(e.target.files);
 let status=document.getElementById("status");
 let count=0;

 for(let f of files){
   if(!f.name.endsWith(".json")) continue;

   let txt=await f.text();
   let data=JSON.parse(txt);

   let name=data.teacherName || f.name.replace(".json","");
   localStorage.setItem(PREFIX+name,JSON.stringify(data));
   count++;

   status.innerText="Imported "+count;
   await new Promise(r=>setTimeout(r,0));
 }

 status.innerText="Done: "+count;
 refreshTeachers();
});

refreshTeachers();
