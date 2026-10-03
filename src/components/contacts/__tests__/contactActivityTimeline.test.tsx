import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {afterEach,describe,it,expect,vi} from 'vitest';
vi.mock('@/contexts/BrandingContext',()=>({useBranding:()=>({formatDateTime:(d:Date)=>d.toISOString()})}));
import {ContactActivityTimeline} from '../activity/ContactActivityTimeline';
afterEach(cleanup);
describe('operational Activity tab',()=>{
 it('renders actor, assignee, changes and legacy evidence separately',()=>{
  render(<ContactActivityTimeline items={[{key:'1',title:'Appointment rescheduled',actor:'Scheduler',timestamp:null,details:['Start: old → new','Assigned to: Owner'],legacy:false},{key:'2',title:'Old note',actor:'Actor not recorded',timestamp:null,details:[],legacy:true}]} loading={false} error={null} hasMore={false} onRefresh={()=>{}} onLoadEarlier={()=>{}}/>);
  expect(screen.getByText('Assigned to: Owner')).toBeInTheDocument();expect(screen.getByText('Start: old → new')).toBeInTheDocument();expect(screen.getByText('Earlier logged activity')).toBeInTheDocument();expect(screen.getByText(/Date not recorded • Scheduler/)).toBeInTheDocument();
 });
 it('offers retry/load earlier without claiming complete history',()=>{
  const retry=vi.fn(),earlier=vi.fn();render(<ContactActivityTimeline items={[]} loading={false} error="Unavailable" hasMore onRefresh={retry} onLoadEarlier={earlier}/>);
  fireEvent.click(screen.getByText('Retry'));fireEvent.click(screen.getByText('Load earlier'));expect(retry).toHaveBeenCalledOnce();expect(earlier).toHaveBeenCalledOnce();expect(screen.queryByText(/complete history/i)).toBeNull();
 });
});
