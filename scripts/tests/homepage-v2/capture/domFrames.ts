/** Fast, read-only rasterization of our synthetic product DOM. Styles are cached
 * per real element; live text, transforms, opacity and animated glows are sampled.
 * Nothing is drawn by hand and no CRM/browser chrome is included. */
const PROPERTIES = ["box-sizing", "display", "position", "top", "right", "bottom", "left", "z-index",
  "width", "min-width", "max-width", "height", "min-height", "max-height", "aspect-ratio",
  "margin-top", "margin-right", "margin-bottom", "margin-left", "padding-top", "padding-right", "padding-bottom", "padding-left",
  "flex", "flex-direction", "flex-wrap", "flex-grow", "flex-shrink", "flex-basis", "align-items", "align-self", "align-content", "justify-content",
  "grid-template-columns", "grid-template-rows", "grid-auto-flow", "grid-column", "grid-row", "row-gap", "column-gap", "order",
  "overflow-x", "overflow-y", "color", "background-color", "background-image", "background-size", "background-position", "background-repeat",
  "border-top", "border-right", "border-bottom", "border-left", "border-radius", "box-shadow", "outline", "outline-offset",
  "font-family", "font-size", "font-weight", "font-style", "font-variant-numeric", "line-height", "letter-spacing", "text-transform", "text-align",
  "text-decoration", "text-overflow", "white-space", "word-break", "overflow-wrap", "vertical-align", "opacity", "transform", "transform-origin",
  "filter", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "object-fit", "object-position", "isolation"];
const DYNAMIC = ["transform", "opacity", "box-shadow", "filter", "background-position"];
const SVG = "http://www.w3.org/2000/svg";

export async function prepareFrames(root: HTMLElement) {
  const cache = new WeakMap<Element, { identity: string; css: string }>();
  const images = new Map<string, string>();
  for (const image of root.querySelectorAll("img")) {
    const url = new URL(image.src, location.href);
    if (url.origin !== location.origin) throw new Error("Capture accepts only local authorized images");
    const blob = await (await fetch(url)).blob();
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob);
    });
    images.set(image.src, data);
  }
  function clone(source: Node): Node {
    if (!(source instanceof Element)) return source.cloneNode(false);
    const copy = source.cloneNode(false) as Element;
    const identity = `${source.getAttribute("class") || ""}|${source.getAttribute("style") || ""}`;
    const computed = getComputedStyle(source);
    let cached = cache.get(source);
    if (!cached || cached.identity !== identity) {
      cached = { identity, css: PROPERTIES.map(property => `${property}:${computed.getPropertyValue(property)};`).join("") };
      cache.set(source, cached);
    }
    copy.setAttribute("style", cached.css + DYNAMIC.map(property => `${property}:${computed.getPropertyValue(property)};`).join(""));
    if (source instanceof HTMLImageElement) copy.setAttribute("src", images.get(source.src)!);
    if (source instanceof HTMLInputElement) copy.setAttribute("value", source.value);
    if (source instanceof HTMLTextAreaElement) copy.textContent = source.value;
    else for (const child of source.childNodes) copy.appendChild(clone(child));
    return copy;
  }
  const canvas = document.createElement("canvas"); canvas.width = 960; canvas.height = 600;
  const context = canvas.getContext("2d")!;
  return {
    canvas,
    async draw() {
      const svg = document.createElementNS(SVG, "svg"); svg.setAttribute("width", "960"); svg.setAttribute("height", "600");
      const foreign = document.createElementNS(SVG, "foreignObject"); foreign.setAttribute("width", "100%"); foreign.setAttribute("height", "100%");
      const surface = clone(root) as HTMLElement;
      // Centering belongs to the capture tool's page, not to the recorded frame.
      surface.style.margin = "0"; surface.style.left = "0"; surface.style.top = "0";
      surface.style.transform = "scale(0.8)"; surface.style.transformOrigin = "0 0";
      foreign.appendChild(surface); svg.appendChild(foreign);
      const image = new Image();
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
      await image.decode();
      context.fillStyle = "#0b1220"; context.fillRect(0, 0, 960, 600); context.drawImage(image, 0, 0);
    },
  };
}
