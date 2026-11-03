import {render,screen} from '@testing-library/react';
import {expect,it} from 'vitest';
import {RoomStats} from '../RoomStats';
import {roomSchema} from '@/lib/inbounds/contracts';
const data=roomSchema.parse({organization_id:'a0000000-0000-0000-0000-000000000001',user_id:'a1000000-0000-0000-0000-000000000001',admin:false,session:null,pending:null,presence:{available:0,busy:0,paused:0},stats:{total:17,answered:8,missed:4,voicemails:2,pending:1},outcomes:[{id:'configured',name:'Custom agency outcome',count:3}],agents:[],missed:[],voicemail_calls:[]});
it('shows agent totals and configured outcome names',()=>{render(<RoomStats data={data}/>);expect(screen.getByText('My answered calls')).toBeInTheDocument();expect(screen.getByText('Custom agency outcome')).toBeInTheDocument();expect(screen.queryByText('Inbound calls')).not.toBeInTheDocument();});
it('adds agency total, missed and voicemail metrics for admins',()=>{render(<RoomStats data={{...data,admin:true}}/>);expect(screen.getByText('Inbound calls')).toBeInTheDocument();expect(screen.getByText('Missed')).toBeInTheDocument();expect(screen.getByText('Voicemails')).toBeInTheDocument();});
