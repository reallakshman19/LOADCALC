// Independent check (2026-11-26): route S8811951/B2 as a continuous beam (uniform EI,
// rigid pinned supports, free ends) vs CHAINAGE_TRIBUTARY_SPAN_V2 EMPTY results.
// Usage: node benchmarks/checks/route-b2-continuous-beam-check.mjs [liftedSupportIndexes]   e.g. 4
// Continuous beam (uniform EI, pinned supports, free ends) vs V2 tributary, route B2.
const g=9.80665;
const items=[[13.69,0,323.85,0],[22.71,323.85,742.63,1],[9.13,742.63,742.63,0],[40.67,742.63,1492.63,1],[9.13,1492.63,1492.63,0],[43.38,1492.63,2292.63,1],[59,2292.63,2439.63,0],[378,2442.83,3052.83,0],[59,3056.03,3203.03,0],[43.38,3203.03,4003.03,1],[9.13,4003.03,4003.03,0],[45.02,4003.03,4833.29,1],[9.13,4833.29,4833.29,0],[74.76,4833.29,6212.03,1],[59,6212.03,6359.03,0],[697.14,6362.23,6972.23,0],[59,6975.43,7122.43,0],[149.44,7122.43,9878.43,1],[59,9878.43,10025.43,0],[1.38,10028.63,10054.03,1],[59,10057.23,10204.23,0],[9.13,10204.23,10349.75,0],[32.09,10349.75,12450.75,1],[17,12450.75,12559.75,0],[124.2,12562.95,12962.95,0],[17,12966.15,13075.15,0],[41.01,13075.15,15760.17,1],[9.13,15760.17,15905.70,0],[59,15905.70,16052.70,0],[408,16055.90,16480.16,0]];
const sup=[1492.8,4002.8,5837.2,9122.8,11259.3,14899.8];
const v2=[3791.6,3483.9,7014.0,3839.5,1858.5,5672.7];
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
