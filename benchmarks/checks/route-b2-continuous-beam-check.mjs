// Independent check (2026-11-26): route S8811951/B2 as a continuous beam (uniform EI,
// rigid pinned supports, free ends) vs CHAINAGE_TRIBUTARY_SPAN_V2 EMPTY results.
// Usage: node benchmarks/checks/route-b2-continuous-beam-check.mjs [liftedSupportIndexes]   e.g. 4
// Continuous beam (uniform EI, pinned supports, free ends) vs V2 tributary, route B2.
import { items, sup, v2 } from './route-b2-data.mjs';
const g=9.80665;
const L=16480.16; const n=1648; const h=L/n; // 10 mm elements
const N=n+1, dof=2*N; const K=Array.from({length:dof},()=>new Float64Array(dof)); const F=new Float64Array(dof);
const ke=[[12,6*h,-12,6*h],[6*h,4*h*h,-6*h,2*h*h],[-12,-6*h,12,-6*h],[6*h,2*h*h,-6*h,4*h*h]].map(r=>r.map(v=>v/h**3));
for(let e=0;e<n;e++){const id=[2*e,2*e+1,2*e+2,2*e+3]; for(let i=0;i<4;i++)for(let j=0;j<4;j++)K[id[i]][id[j]]+=ke[i][j];}
const addPoint=(x,P)=>{const e=Math.min(n-1,Math.floor(x/h)); const xi=(x-e*h)/h; const N1=1-3*xi*xi+2*xi**3,N2=h*(xi-2*xi*xi+xi**3),N3=3*xi*xi-2*xi**3,N4=h*(-xi*xi+xi**3); F[2*e]+=P*N1;F[2*e+1]+=P*N2;F[2*e+2]+=P*N3;F[2*e+3]+=P*N4;};
for(const [kg,a,b,dist] of items){const W=-kg*g; if(dist&&b>a){const m=Math.max(1,Math.round((b-a)/5)); for(let k=0;k<m;k++) addPoint(a+(k+0.5)*(b-a)/m, W/m);} else addPoint((a+b)/2, W);}
const off=(process.argv[2]||"").split(",").filter(Boolean).map(Number); const supNodes=sup.map(x=>Math.round(x/h)).map((v,i)=>off.includes(i)?null:v);
// penalty pinned supports
const big=1e12; supNodes.forEach(i=>{if(i!==null)K[2*i][2*i]+=big});
// solve (dense Gauss) — banded small enough
const A=K.map(r=>Array.from(r)); const bvec=Array.from(F);
for(let i=0;i<dof;i++){let p=A[i][i]; for(let r=i+1;r<Math.min(dof,i+5);r++){const f=A[r][i]/p; if(!f)continue; for(let c=i;c<Math.min(dof,i+6);c++)A[r][c]-=f*A[i][c]; bvec[r]-=f*bvec[i];}}
const u=new Array(dof).fill(0); for(let i=dof-1;i>=0;i--){let s=bvec[i]; for(let c=i+1;c<Math.min(dof,i+6);c++)s-=A[i][c]*u[c]; u[i]=s/A[i][i];}
const R=supNodes.map(i=>i===null?0:-big*u[2*i]);
const tot=items.reduce((s,i)=>s+i[0],0)*g;
console.log('total N', tot.toFixed(0), 'sum beam', R.reduce((a,b)=>a+b,0).toFixed(0), 'sum V2', v2.reduce((a,b)=>a+b,0).toFixed(0));
sup.forEach((x,i)=>console.log(`ch ${x.toFixed(0).padStart(6)}  V2 ${v2[i].toFixed(0).padStart(5)} N  beam ${R[i].toFixed(0).padStart(5)} N  diff ${((v2[i]/R[i]-1)*100).toFixed(1).padStart(6)} %`));
