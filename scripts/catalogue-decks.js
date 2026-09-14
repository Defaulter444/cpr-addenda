import { catalogueIdentity } from './catalogue-rules.js';
const programOnly = new Set(['Kirama Entry Deck','Kirama Training Deck','Microtech Warrior','Kestrel 2','Verdant Knight']);
const pools = {'Microtech Assault':[4,5],Kerberos:[6,5],'Parraline 6000':[3,6]};
const iceNames = {Hellhound:['Hellhound','Адская гончая','Адская Гончая'],Asp:['Asp','Аспид'],Wisp:['Wisp','Висп']};
function isProgram(item, key) {
  if (catalogueIdentity(item) === key) return true;
  return item.type === 'program' && (iceNames[key] ?? []).includes(item.flags?.babele?.originalName ?? item.name);
}
export function catalogueDeckFit(deck, requested) {
  if (deck.type !== 'cyberdeck') return null;
  const key = catalogueIdentity(deck);
  const current = deck.getInstalledItems?.() ?? [];
  const items = [...new Map([...current,...requested].map((i,n) => [i.id ?? i._id ?? `new-${n}`,i])).values()];
  const programs = items.filter(i=>i.type==='program');
  const hardware = items.filter(i=>i.type==='itemUpgrade');
  if (programOnly.has(key) && hardware.length) return 'Эта дека допускает только программы.';
  if (key === 'Hummingbird' && programs.length) return '«Колибри» допускает только оборудование.';
  if (key === 'Kirama Entry Deck') {
    const count = new Map();
    for (const p of programs) {
      const group = /attacker$/.test(p.system.class) ? 'attacker' : p.system.class;
      count.set(group,(count.get(group)??0)+1);
    }
    if ([...count.values()].some(n=>n>1)) return 'Стартовая дека допускает по одной атакующей, защитной, усиливающей программе и чёрному ЛЬДУ.';
  }
  if (key === 'Microtech Assault' && programs.some(p=>p.system.class!=='blackice')) return 'Программные слоты «Штурмовика» предназначены только для чёрного ЛЬДА.';
  if (key === 'Kerberos' && programs.some(p=>p.system.class!=='blackice'||!isProgram(p,'Hellhound'))) return '«Керберос» допускает только «Адских гончих».';
  if (key === 'Verdant Knight' && programs.some(p=>!['Sword','Shield'].includes(catalogueIdentity(p)))) return 'Эта дека допускает только программы «Меч» и «Щит».';
  if (key === "Warlock's Book" && programs.some(p=>!['booster','defender'].includes(p.system.class))) return '«Книга колдуна» допускает только усилители и защитные программы.';
  if (key === 'MicroMate' && programs.some(p=>p.system.class==='defender')) return 'МикроМат не допускает защитные программы.';
  if (key === 'Kaliya' && programs.some(p=>(p.system.class==='defender'&&!isProgram(p,'Flak'))||(p.system.class==='blackice'&&!isProgram(p,'Asp')))) return 'Калья допускает из защитных программ только «Зенитку», а из чёрного ЛЬДА — «Аспида».';
  const sum = list => list.reduce((n,i)=>n+Math.max(0,Number(i.system.size)||0),0);
  const total = Number(deck.availableInstallSlots?.()) + Number(deck.system.installedItems.usedSlots);
  if (pools[key]) {
    const [p,h] = pools[key], extra = Number.isFinite(total) ? Math.max(0,total-p-h) : 0;
    if (Math.max(0,sum(programs)-p)+Math.max(0,sum(hardware)-h)>extra) return `У деки отдельные слоты: ${p} для программ и ${h} для оборудования.`;
  }
  if (key === 'Kaliya') {
    const extra = Number.isFinite(total) ? Math.max(0,total-9) : 0;
    const flak = sum(programs.filter(p=>isProgram(p,'Flak')));
    if (sum(items)-Math.min(3,flak)>6+extra) return 'Три отдельных слота Кальи предназначены только для «Зенитки».';
  }
  if (hardware.some(i=>catalogueIdentity(i)==='Swamp Mist') && programs.some(p=>p.system.class==='blackice'&&!isProgram(p,'Wisp'))) return '«Болотный туман» допускает только чёрный ЛЁД «Висп».';
  return null;
}
export function applyCatalogueDeckRules(item) {
  if (item.type !== 'cyberdeck') return;
  if (item.canInstallItems) {
    const original = item.canInstallItems;
    item.canInstallItems = function (items,...args) {
      const reason = catalogueDeckFit(this,items);
      if (reason) { ui.notifications.warn(reason); return false; }
      return original.call(this,items,...args);
    };
  }
  if (item.getInstallableItems) {
    const original = item.getInstallableItems;
    item.getInstallableItems = function (...args) {
      return original.apply(this,args).filter(i=>!catalogueDeckFit(this,[i]));
    };
  }
}
