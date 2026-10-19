import {useState} from 'react';
import {FixtureAuth} from './auth';
import {UnderwriterVerifiedProfile} from '@/components/underwriter-verified/UnderwriterVerifiedProfile';
export default function Subject(){
 const [settings,setSettings]=useState(true);
 return <FixtureAuth><div className="space-y-4 p-6"><button onClick={()=>setSettings(!settings)}>{settings?'Agent Profile':'Settings'}</button><UnderwriterVerifiedProfile settings={settings}/></div></FixtureAuth>;
}
