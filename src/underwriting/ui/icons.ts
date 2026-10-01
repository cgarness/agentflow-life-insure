const paths:Record<string,string>={
  shield:'M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Zm-4 9 3 3 5-6',
  arrow:'M5 12h14m-6-6 6 6-6 6',
  check:'m5 12 4 4L19 6',
  lock:'M6 10h12v11H6V10Zm3 0V6a3 3 0 0 1 6 0v4',
  spark:'m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z',
  search:'M21 21l-5-5m2-6a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z',
  reset:'M3 11a9 9 0 1 1 3 8M3 4v7h7',
  clipboard:'M9 4H5v17h14V4h-4M9 3h6v4H9V3Zm-1 9h8m-8 4h5',
  chevron:'m8 5 7 7-7 7'
};
export function icon(name:string,classes='h-5 w-5'):SVGSVGElement {
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  for(const [k,v] of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.7','stroke-linecap':'round','stroke-linejoin':'round',class:classes,'aria-hidden':'true'}))svg.setAttribute(k,v);
  const p=document.createElementNS(svg.namespaceURI,'path');p.setAttribute('d',paths[name]??paths.check!);svg.append(p);return svg;
}
