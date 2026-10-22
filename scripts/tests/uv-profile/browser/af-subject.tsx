import {useState} from 'react';
import {MemoryRouter} from 'react-router-dom';
import {ProfileHero} from '@/components/agent-profile/ProfileHero';
import {FixtureAuth} from './auth';
import {UnderwriterVerifiedProfile} from '@/components/underwriter-verified/UnderwriterVerifiedProfile';
export default function Subject(){
 const [settings,setSettings]=useState(true);
 return <FixtureAuth><div className="space-y-4 p-6"><button onClick={()=>setSettings(!settings)}>{settings?'Agent Profile':'Settings'}</button>{settings?<UnderwriterVerifiedProfile settings/>:<MemoryRouter><ProfileHero firstName="Test" lastName="Agent" role="Agent" avatarUrl={null} organizationName="Synthetic Agency" organizationLogoUrl={null} npn="123456" residentState="CA" licensedStateCount={1} carrierAppointmentCount={1} readinessPercent={100} isFullyReady actions={<UnderwriterVerifiedProfile/>}/></MemoryRouter>}</div></FixtureAuth>;
}
