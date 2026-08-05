import { generateXClientToken, generateXTrSignature } from './src/utils/crypto';
const SPOOF='196.28.244.1'; const BASE='https://api4.aoneroom.com';
const INFO=JSON.stringify({package_name:'com.community.oneroom',version_name:'3.0.11.1230.03',version_code:50020042,os:'android',os_version:'12',install_ch:'ps',device_id:'a3f1c8e94b7d02516ac9e83f47b21d60',install_store:'ps',gaid:'7c9e6679-7425-40de-944b-e07fc1f90ae7',brand:'Redmi',model:'2201117TG',system_language:'fr',net:'NETWORK_WIFI',region:'BF',timezone:'Africa/Ouagadougou',sp_code:'','X-Play-Mode':'2'});
function hdrs(url:string,token?:string){const h:Record<string,string>={'User-Agent':'MovieBoxPro/16.2.1 (Android 12; Pixel 6)','X-M-Version':'16.2.1',Accept:'application/json','Content-Type':'application/json;charset=UTF-8',Referer:BASE+'/','x-client-token':generateXClientToken(),'x-tr-signature':generateXTrSignature('GET','application/json','application/json;charset=UTF-8',url,null,false),'x-client-info':INFO,'x-client-status':'0','X-Play-Mode':'2','X-Forwarded-For':SPOOF,'CF-Connecting-IP':SPOOF,'X-Real-IP':SPOOF};if(token)h['Authorization']=`Bearer ${token}`;return h;}
(async()=>{
  const u0=`${BASE}/wefeed-mobile-bff/tab-operating?page=1&tabId=0&version=`;
  const r0=await fetch(u0,{headers:hdrs(u0)}); let token=''; try{token=JSON.parse(r0.headers.get('x-user')||'{}').token||'';}catch{}
  const u=`${BASE}/wefeed-mobile-bff/tab/ranking-list?tabId=2&page=1&perPage=20`;
  const j:any=await (await fetch(u,{headers:hdrs(u,token)})).json();
  console.log('categoryList brut :', JSON.stringify((j?.data?.categoryList||[]).slice(0,3)));
  console.log('currentCategoryType :', j?.data?.currentCategoryType);
  console.log('ops :', JSON.stringify(j?.data?.ops||[]).slice(0,200));
  console.log('champs subject[0] :', Object.keys(j?.data?.subjects?.[0]||{}).join(','));
  const s0=j?.data?.subjects?.[0]||{};
  console.log('detailUrl:',s0.detailUrl); console.log('playUrl:',s0.playUrl);
  console.log('cover:',JSON.stringify(s0.cover).slice(0,120)); console.log('corner:',s0.corner,'| genre:',s0.genre,'| dl:',s0.dl,'| hasResource:',s0.hasResource);
  const cats=(j?.data?.categoryList||[]);
  for(const c of cats.slice(0,4)){
    const key=c.categoryType ?? c.type ?? c.id;
    const uu=`${BASE}/wefeed-mobile-bff/tab/ranking-list?tabId=2&page=1&perPage=20&categoryType=${encodeURIComponent(key)}`;
    const jj:any=await (await fetch(uu,{headers:hdrs(uu,token)})).json();
    const subs=jj?.data?.subjects||[];
    console.log(`  categoryType=${String(key).padEnd(22)} "${c.name||c.title}" -> ${subs.length} items, ex="${(subs[0]?.title||'').slice(0,40)}", current=${jj?.data?.currentCategoryType}`);
  }
})();
