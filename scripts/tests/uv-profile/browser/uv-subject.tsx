import {BrowserRouter,Routes,Route} from 'react-router-dom';
import Index from '@/pages/Index';
import Search from '@/pages/Search';
export default function Subject(){return <BrowserRouter><Routes><Route path="/" element={<Search/>}/><Route path="/:agencySlug/:agentSlug" element={<Index/>}/></Routes></BrowserRouter>}
