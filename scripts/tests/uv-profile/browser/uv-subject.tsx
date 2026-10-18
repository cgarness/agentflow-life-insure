import '@fontsource/plus-jakarta-sans/300.css';
import '@fontsource/plus-jakarta-sans/400.css';
import '@fontsource/plus-jakarta-sans/500.css';
import '@fontsource/plus-jakarta-sans/600.css';
import '@fontsource/plus-jakarta-sans/700.css';
import '@fontsource/plus-jakarta-sans/800.css';
import '@fontsource/plus-jakarta-sans/400-italic.css';
import '@fontsource/dancing-script/400.css';
import '@fontsource/dancing-script/500.css';
import '@fontsource/dancing-script/600.css';
import '@fontsource/dancing-script/700.css';
import {BrowserRouter,Routes,Route} from 'react-router-dom';
import Index from '@/pages/Index';
import Search from '@/pages/Search';
export default function Subject(){return <BrowserRouter><Routes><Route path="/" element={<Search/>}/><Route path="/:agencySlug/:agentSlug" element={<Index/>}/></Routes></BrowserRouter>}
