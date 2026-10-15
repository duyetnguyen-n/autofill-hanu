import { afterEach, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { supabaseAuth } from '../../manager/cloud/auth';

const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();});

it('uses real Supabase SDK PKCE, HttpOnly cookies and server verification; rejects forged tokens and clears cookies on logout',async()=>{
  const userId='11111111-1111-4111-8111-111111111111',sessionId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const encoded=(v:unknown)=>Buffer.from(JSON.stringify(v)).toString('base64url');
  const token=`${encoded({alg:'HS256',typ:'JWT'})}.${encoded({sub:userId,session_id:sessionId,exp:Math.floor(Date.now()/1000)+3600})}.fixture-signature`;
  const user={id:userId,email:'auth@example.test',app_metadata:{provider:'google'},user_metadata:{full_name:'Auth thử nghiệm',email_verified:true},identities:[{id:userId,user_id:userId,provider:'google',identity_data:{sub:'google-fixture',email:'auth@example.test',email_verified:true}}],aud:'authenticated',created_at:new Date().toISOString()};
  let verifiedCalls=0,codeChallenge='',codeVerifier='';
  let origin='';
  const server=createServer(async(req,res)=>{
    const path=new URL(req.url!,origin).pathname;
    if(path.startsWith('/auth/v1/')){
      res.setHeader('Content-Type','application/json');
      if(path==='/auth/v1/token'){
        let text='';for await(const chunk of req)text+=chunk;const body=JSON.parse(text);codeVerifier=body.code_verifier;
        if(body.auth_code!=='fixture-code'||!codeVerifier||createHash('sha256').update(codeVerifier).digest('base64url')!==codeChallenge){res.statusCode=400;res.end(JSON.stringify({message:'Invalid verifier'}));return;}
        res.end(JSON.stringify({access_token:token,refresh_token:'fixture-refresh-token',expires_in:3600,token_type:'bearer',user}));return;
      }
      if(path==='/auth/v1/user'){
        verifiedCalls++;if(req.headers.authorization!==`Bearer ${token}`){res.statusCode=401;res.end(JSON.stringify({message:'Invalid token'}));return;}
        res.end(JSON.stringify(user));return;
      }
      if(path==='/auth/v1/logout'){res.statusCode=204;res.end();return;}
      res.statusCode=404;res.end('{}');return;
    }
    try{
      const auth=supabaseAuth({origin,host:'127.0.0.1',port:0,development:true,supabaseUrl:origin,publishableKey:'fixture-public-key',secretKey:'fixture-secret-key',databaseUrl:'fixture-only'}).request(req,res);
      if(path==='/login'){const url=await auth.login();codeChallenge=new URL(url).searchParams.get('code_challenge')!;res.end(JSON.stringify({url}));return;}
      if(path==='/callback'){await auth.callback('fixture-code');const data=await auth.user();res.end(JSON.stringify(data));return;}
      if(path==='/me'){res.end(JSON.stringify(await auth.user()??null));return;}
      if(path==='/logout'){await auth.logout();res.end('{}');return;}
      res.statusCode=404;res.end();
    }catch(e){res.statusCode=400;res.end(JSON.stringify({error:(e as Error).message}));}
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  cleanups.push(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
  const jar=new Map<string,string>();
  function cookies(response:Response){for(const cookie of response.headers.getSetCookie()){expect(cookie).toContain('HttpOnly');expect(cookie).toContain('SameSite=Lax');const pair=cookie.split(';')[0],index=pair.indexOf('=');jar.set(pair.slice(0,index),pair.slice(index+1));}}
  async function request(path:string){const response=await fetch(`${origin}${path}`,{headers:{Cookie:[...jar].map(([key,value])=>`${key}=${value}`).join('; ')}});cookies(response);return response;}
  const login=await request('/login'),data=await login.json();
  expect(data.url).toContain('provider=google');expect(codeChallenge).toBeTruthy();expect([...jar.keys()].some(key=>key.includes('code-verifier'))).toBe(true);
  const callback=await request('/callback');expect(callback.status).toBe(200);expect(await callback.json()).toMatchObject({id:userId,sessionKey:sessionId});expect(codeVerifier).toBeTruthy();
  const count=verifiedCalls;expect(await(await request('/me')).json()).toMatchObject({id:userId});expect(verifiedCalls).toBeGreaterThan(count);
  expect(await(await request('/me')).json()).toMatchObject({emailVerified:true,googleSub:'google-fixture'});
  user.identities[0].identity_data.email_verified=false;
  expect(await(await request('/me')).json()).toMatchObject({emailVerified:false});
  user.identities[0].identity_data.email_verified=true;
  // The SDK must consult Auth, rather than trust the user payload in its cookie.
  const cookieKey=[...jar.keys()].find(key=>key.includes('auth-token')&&!key.includes('code-verifier'))!;
  const value=jar.get(cookieKey)!;
  const decoded=JSON.parse(Buffer.from(decodeURIComponent(value).slice('base64-'.length),'base64url').toString());
  decoded.access_token=decoded.access_token.replace('fixture-signature','forged-signature');
  jar.set(cookieKey,'base64-'+Buffer.from(JSON.stringify(decoded)).toString('base64url'));
  expect(await(await request('/me')).json()).toBeNull();
  // Restore the valid session to exercise SDK logout and expiration cookies.
  jar.set(cookieKey,value);
  const logout=await request('/logout');expect(logout.status).toBe(200);expect(logout.headers.getSetCookie().some(cookie=>cookie.includes('Max-Age=0'))).toBe(true);
},20000);
