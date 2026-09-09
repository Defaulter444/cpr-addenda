import { MODULE_ID } from './constants.js';

export function rulerDv(table,distance) {
  if(!Number.isFinite(distance)||distance<0)return null;
  const roll=Math.ceil(distance-1e-8);
  for(const [range,text]of Object.entries(table??{})){
    if(!/^\d+_\d+$/.test(range))continue;
    const [start,end]=range.split('_').map(Number);
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end)continue;
    if(roll<start||roll>end)continue;
    const value=String(text).trim();
    return /^\d+$/.test(value)&&Number.isSafeInteger(Number(value))&&Number(value)>0?Number(value):null;
  }
  return null;
}

export function registerRulerDistancePatch() {
  libWrapper.register(MODULE_ID,'Ruler.prototype._getSegmentLabel',function(wrapped,segment,...args){
    const label=wrapped(segment,...args);
    if(!this.user?.isSelf||segment.teleport)return label;
    let token=canvas.tokens.controlled[0];
    if(!token){
      const owned=canvas.tokens.ownedTokens.filter(t=>['character','mook'].includes(t.actor?.type));
      if(owned.length===1)token=owned[0];
    }
    const selected=token?.document.getFlag(game.system.id,'cprDvTable');
    if(!selected?.table)return label;
    // Preserve the ruler's original distance text; replace only its CPR DV line.
    const base=label.replace(/\nDV: [^\n]*/,'');
    const dv=rulerDv(selected.table,segment.distance);
    return dv===null?base:`${base}\nDV: ${dv} ${String(selected.name??'').replace(/^DV /,'')}`;
  },'WRAPPER');
}
