import { CATALOGUE_IDENTITIES } from './catalogue-identities.js';
const ID = 'cpr-addenda';
export const CATALOGUE_FLAMETHROWERS = ['Flamethrower','Dragon Flamethrower','Burst Flamethrower'];
export const CATALOGUE_SMARTGUNS = ['Malorian Arms 3516','WAA Bullpup Assault Weapon','Sub-Flechette Gun','ARS-5 Submachine Gun','Nova Model 757 Cityhunter','СВК Midnight Arms Dawnmaker','Винтовка Militech Mountain Goat','Рельсотрон Tsunami Arms «Deathwind»'];
export const CATALOGUE_SCOPED_GUNS = ['ARS-5 Submachine Gun','Винтовка Militech Mountain Goat','Hello Cutie 1TruLuv'];
const bySource = new Map(CATALOGUE_IDENTITIES.map(x => [x.uuid, x]));
const byName = new Map();
for (const x of CATALOGUE_IDENTITIES) for (const name of x.names) {
  const key = `${x.type}:${name}`;
  if (!byName.has(key)) byName.set(key, x.key);
  else if (byName.get(key) !== x.key) byName.set(key, null);
}
export function catalogueIdentity(item) {
  if (!item) return '';
  const source = item.pack ? `Compendium.${item.pack}.Item.${item.id ?? item._id}` :
    item._stats?.compendiumSource || item.flags?.core?.sourceId;
  const known = bySource.get(source);
  if (known && known.type === item.type) return known.key;
  // A foreign source, particularly G&C homebrew, must not inherit core rules.
  if (source) return '';
  return byName.get(`${item.type}:${item.flags?.babele?.originalName ?? item.name}`) ?? '';
}
export function catalogueFromPack(item, pack) {
  const source=item?.pack ? `Compendium.${item.pack}.Item.${item.id??item._id}` : item?._stats?.compendiumSource || item?.flags?.core?.sourceId;
  const entry=bySource.get(source);
  return Boolean(entry && entry.type===item.type && source.startsWith(`Compendium.${pack}.Item.`));
}
export function catalogueVehicleFit(carrier, requested=[]) {
  const pack='cyberpunk-red-core.dlc_spinning-your-wheels';
  const upgrades=requested.filter(i=>i.type==='itemUpgrade' && catalogueFromPack(i,pack));
  if(!upgrades.length && catalogueIdentity(carrier)!=='Bicycle')return null;
  if(upgrades.length && catalogueIdentity(carrier)!=='Bicycle')return 'Это улучшение предназначено только для велосипеда.';
  const items=[...new Map([...(carrier.getInstalledItems?.()??[]),...requested].map(i=>[i.id??i._id,i])).values()];
  const keys=items.filter(i=>i.type==='itemUpgrade' && catalogueFromPack(i,pack)).map(catalogueIdentity);
  if(new Set(keys).size!==keys.length)return 'На велосипеде допустимо только одно улучшение каждого типа.';
  if(keys.includes('Folding Frame') && keys.some(k=>['Enclosure','Reinforced Frame','Smuggling Compartment'].includes(k)))return 'Складная рама несовместима с корпусом, усиленной рамой и контрабандным отсеком.';
  if(keys.includes('Bulletproof Glass') && !keys.includes('Enclosure'))return 'Пуленепробиваемое стекло требует корпус.';
  if(keys.includes('Cycle Armor') && !keys.includes('Reinforced Frame'))return 'Велосипедная броня требует усиленную раму.';
  return null;
}
/** The 2026 Black Chrome errata exempts these fingers from maximum-humanity
 * depression only. Their normal installation Humanity Loss still applies. */
export function catalogueHumanityExempt(item, actor) {
  if (catalogueExternalCyberware(item,actor)) return true;
  if (item?.type !== 'cyberware' || !/ Cyberfingers?$/.test(catalogueIdentity(item))) return false;
  return values(actor?.items).some(hand => hand.system?.isInstalledInActor &&
    catalogueIdentity(hand) === 'Dynalar Modular Finger Enthusiast Cyberhand' &&
    hand.system.installedItems?.list?.includes(item.id ?? item._id));
}
/** Options inside worn external equipment are not implanted into the user. */
export function catalogueExternalCyberware(item, actor) {
  if (item?.type!=='cyberware') return false;
  const external=['Smart Glasses','Smart Lens','Battleglove','Xtra-Dex Smart Glove','MechaMan Smart Glove','Spider Cyberchair'];
  const items=values(actor?.items), pending=[item],seen=new Set();
  while(pending.length) {
    const current=pending.pop(),id=current.id??current._id;
    if(seen.has(id))continue;seen.add(id);
    if(external.includes(catalogueIdentity(current)))return true;
    pending.push(...items.filter(p=>p.system?.installedItems?.list?.includes(id)));
  }
  return false;
}
export function catalogueCyberPrerequisite(actor, item) {
  const required = {'Heuristic Health Monitor':'Biomonitor','Appetite Controller':'Biomonitor','Combat Tail':'Neural Link'}[catalogueIdentity(item)];
  if (!required) return null;
  const keys = [...catalogueLiveItems(actor,Infinity).values()].map(catalogueIdentity);
  return keys.includes(required) ? null : required==='Biomonitor' ? 'Для этого импланта требуется установленный биомонитор.' : 'Для боевого хвоста требуется установленный нейролинк.';
}
function values(collection) { return Array.from(collection?.values?.() ?? collection ?? []); }
/** Only roots installed on the actor or equipped carriers supply usable options.
 * An EMP-disabled carrier disables its entire subtree. Cycles terminate. */
export function catalogueLiveItems(actor, now = 0) {
  const items = values(actor?.items), byId = new Map(items.map(i => [i.id ?? i._id, i]));
  const roots = [...(actor?.system?.installedItems?.list ?? [])];
  for (const item of items) if (item.system?.equipped === 'equipped') roots.push(item.id ?? item._id);
  const live = new Map(), pending = [...roots];
  while (pending.length) {
    const id = pending.pop(), item = byId.get(id);
    if (!item || live.has(id) || item.flags?.[ID]?.empUntil > now) continue;
    live.set(id, item);
    pending.push(...(item.system?.installedItems?.list ?? []));
  }
  const connected=[...live.values()].map(catalogueIdentity);
  if (!connected.includes('Neural Link') || !connected.includes('Interface Plugs')) {
    const blocked=[...live.values()].filter(i=>catalogueIdentity(i)==='Xtra-Dex Smart Glove').flatMap(i=>i.system.installedItems?.list??[]);
    const seen=new Set();
    while(blocked.length) {
      const id=blocked.pop();if(seen.has(id))continue;seen.add(id);
      blocked.push(...(byId.get(id)?.system.installedItems?.list??[]));live.delete(id);
    }
  }
  return live;
}
export function pairedCatalogueOption(actor, key, now = 0) {
  const live = catalogueLiveItems(actor, now), parents = new Map();
  for (const item of live.values()) for (const child of item.system?.installedItems?.list ?? []) {
    if (live.has(child)) parents.set(child, item);
  }
  const eyes = new Set();
  for (const item of live.values()) {
    if (catalogueIdentity(item) !== key) continue;
    const carrier = parents.get(item.id ?? item._id);
    const identity = catalogueIdentity(carrier);
    if (['Smart Glasses', 'MonoVision'].includes(identity)) return true;
    if (identity!=='Smart Lens' && carrier?.system?.type === 'cyberEye' && carrier.system.isFoundational) eyes.add(carrier.id ?? carrier._id);
  }
  return eyes.size >= 2;
}
const light = new Set(['Light Tattoo', 'Kill Display', "Lead's Turn-On-Show-Off Nails",'Laser Light Street Jacket','Laser Light Electric Guitar']);
export function catalogueFireProtection(actor, now=0) {
  // Fire-resistant material is not disabled by an EMP affecting suit electronics.
  return values(actor?.items).some(item=>item.type==='armor' &&
    item.system.equipped==='equipped' && catalogueIdentity(item)==='Fire Brand Bunker Gear');
}
export function catalogueArmorPenalty(actor, stat, base) {
  if (!['dex','move'].includes(stat)) return base;
  const items=new Set([...(actor.getEquippedArmors?.('head')??[]),...(actor.getEquippedArmors?.('body')??[])]);
  let penalty=base;
  for(const item of items) {
    const key=catalogueIdentity(item);
    const standard=key.startsWith('Тяжёлый Metalgear® (')?4:key.startsWith('Гибридный Metalgear® (')?3:null;
    if (standard && Math.abs(Number(item.system.penalty))===standard) penalty=Math.min(penalty,-standard-1);
  }
  return penalty;
}
/** Prime Time's +2 WILL does not increase hit points (Hornet's Pharmacy p.3). */
export function catalogueTemporaryWillHp(actor) {
  return values(actor?.items).filter(i=>catalogueIdentity(i)==='Prime Time').reduce((sum,item)=>sum+
    values(item.effects).filter(e=>!e.disabled && !e.isSuppressed).reduce((n,e)=>n+
      (e.changes??[]).filter(c=>c.key==='system.stats.will.value' && Number(c.value)===2 && c.mode===2).length*5,0),0);
}
/** These carriers have finger sockets, not interchangeable arm-option slots. */
export function catalogueHandFit(carrier, requested=[]) {
  if (catalogueIdentity(carrier)==='Spider Cyberchair') {
    if(requested.some(i=>i.type==='cyberware' && (i.system.isFoundational || !['cyberArm','cyberLeg','cyberLimb'].includes(i.system.type)))) return 'Кресло «Паук» принимает только опции киберруки, киберноги и киберконечности.';
    return null;
  }
  if (catalogueIdentity(carrier)==='Smart Lens' && requested.some(i=>['Anti-Dazzle','Color Shift','Image Enhance','Low Light/IR/UV','Virtuality'].includes(catalogueIdentity(i)))) return 'В умную линзу нельзя устанавливать опции, которым требуется пара.';
  const key=catalogueIdentity(carrier);
  if (!['Xtra-Dex Smart Glove','Modular Finger Cyberhand','Dynalar Modular Finger Enthusiast Cyberhand'].includes(key)) return null;
  const byId=new Map([...(carrier.getInstalledItems?.()??[]),...requested].map(i=>[i.id??i._id,i]));
  const items=[...byId.values()], glove=key==='Xtra-Dex Smart Glove';
  let fingers=0,options=0;
  for(const item of items) {
    const finger=/ Cyberfingers?$/.test(catalogueIdentity(item));
    const size=Math.max(0,Number(item.system.size)||0);
    if(finger) fingers+=size;
    else if(glove && item.type==='cyberware' && !item.system.isFoundational && ['cyberArm','cyberLimb'].includes(item.system.type)) options+=size;
    else if(glove && item.type==='itemUpgrade') options+=size;
    else return 'В этот носитель можно устанавливать только подходящие киберпальцы и разрешённые опции руки.';
  }
  const maximum=key==='Dynalar Modular Finger Enthusiast Cyberhand'?8:5;
  if(fingers>maximum) return `В носителе только ${maximum} мест для киберпальцев.`;
  if(glove && options>2) return 'У Xtra-Dex только два слота опций руки; места киберпальцев не заменяют их.';
  return null;
}
const nonstack = new Map([
  ['Targeting Scope', 'targeting'], ['Amplified Hearing', 'hearing'], ['Image Enhance', 'image'],
  ['Voice Stress Analyzer', 'voiceStress'], ['Toxin Binders', 'toxin'], ['AudioVox', 'audioVox'],
  ['Techscanner', 'techscanner'], ['Medscanner', 'medscanner'], ['Agent', 'agent'],
  ['Internal Agent', 'agent'], ['Watch-Man', 'agent'],
  ['Smartsticks','instrument'],['Laser Light Electric Guitar','instrument'],['KillStrom Banshee Microphone','instrument'],["Master Mechanic's Tool Kit",'makerTools'],
  ['Superchrome® Covering (Cyber Arm)', 'superchrome'], ['Superchrome® Covering (Cyber Leg)', 'superchrome'],
]);
function usable(item, live, now) {
  if (item?.flags?.[ID]?.empUntil > now) return false;
  if (item?.type === 'cyberware') return live.has(item.id ?? item._id);
  return true; // Core suppression already handles carried/equipped non-cyber items.
}
/** Filter native CPRMod objects without changing their prototypes or IDs. */
export function filterCatalogueModifiers(mods, effects, { actor, now = 0, context } = {}) {
  if (!actor) return mods;
  const live = catalogueLiveItems(actor, now), identities = [...live.values()].map(catalogueIdentity);
  const enabled = new Map();
  for (const effect of effects) {
    for (const change of effect.changes ?? []) enabled.set(`${change.key}-${effect.id ?? effect._id}`, effect);
  }
  const hasFashionPair = identities.includes('Chemskin') && identities.includes('Techhair');
  const tattooCount = identities.filter(key => light.has(key)).length;
  const used = new Set();
  return mods.filter(mod => {
    // Another module may canonicalize a bonus key, but its effect ID stays intact.
    const effect = enabled.get(mod.id) ?? effects.find(e => mod.id?.endsWith(`-${e.id ?? e._id}`));
    const item = effect?.parent;
    const key = catalogueIdentity(item);
    if (!key) return true;
    if (key==="Master Mechanic's Tool Kit") {
      const technician=values(actor.items).some(i=>i.type==='role' && i.system?.rank>0 &&
        (i.system.mainRoleAbility==='Maker' || i.flags?.babele?.originalName==='Tech'));
      if (!technician) return false;
      mod.isSituational=true;mod.onByDefault=false;mod.source=`${item.name} (только специализации Творца)`;
    }
    if (key==='RapiDeploy Sheath') {
      mod.isSituational=true;mod.onByDefault=false;mod.source=`${item.name} (только сокрытие скрываемого оружия)`;
    }
    const group = light.has(key) && mod.key==='bonuses.wardrobeAndStyle' ? 'lightTattoos' : ['Chemskin', 'Techhair'].includes(key) ? 'fashionPair' : nonstack.get(key);
    if (!group && key !== 'TeleOptics') return true;
    if (!usable(item, live, now)) return false;
    if (group === 'fashionPair' && !hasFashionPair) return false;
    if (group === 'lightTattoos' && tattooCount < 3) return false;
    if (group === 'image' && !pairedCatalogueOption(actor, key, now)) return false;
    if (key === 'TeleOptics') {
      if (context && (!context.weapon?.system?.isRanged || !['attack', 'aimed'].includes(context.type))) return false;
      if (context?.distance !== null && context?.distance !== undefined && context.distance < 51) return false;
      // A scope fitted to the attacking weapon supplies the same bonus.
      if (context?.scope) return false;
      mod.isSituational = true;
      mod.onByDefault = Boolean(context && context.distance !== null && context.distance >= 51);
      mod.source = `${item.name} (от 51 м)`;
    }
    // User-authored values are outside this standard +1/+2 non-stacking fix.
    const expected = key === "Master Mechanic's Tool Kit" ? 4 : ['Targeting Scope','TeleOptics','Smartsticks','Laser Light Electric Guitar'].includes(key) ? 1 : 2;
    if (Number(mod.value) !== expected) return true;
    const unique = `${group ?? 'teleoptics'}:${mod.key}`;
    if (used.has(unique)) return false;
    used.add(unique);
    return true;
  });
}
export function hasCatalogueSmartlink(actor, now = 0) {
  const keys = [...catalogueLiveItems(actor, now).values()].map(catalogueIdentity);
  return keys.includes('Neural Link') && (keys.includes('Interface Plugs') || keys.includes('Subdermal Grip') || keys.includes('MechaMan Smart Glove'));
}
/** Exact catalogue frames require two separate installed ports, except EL-F4-NT. */
export function catalogueFrameConnected(item, actor, now=0) {
  const key=catalogueIdentity(item);
  if (!['LF-001 SWAT Linear Frame','Fūma Kotarō Linear Frame','Vermilion Linear Frame'].includes(key)) return true;
  return [...catalogueLiveItems(actor,now).values()].filter(i=>i.type==='cyberware' && catalogueIdentity(i)==='Interface Plugs').length>=2;
}
export function catalogueFlashProtection(actor, now = 0) {
  const keys = [...catalogueLiveItems(actor, now).values()].map(catalogueIdentity);
  return {
    eyes: pairedCatalogueOption(actor, 'Anti-Dazzle', now) || keys.includes('OptiShield'),
    ears: keys.includes('Level Damper') || keys.includes('Auto Level Dampening Ear Protectors'),
  };
}
const magazineTypes = { 'Medium Pistol':'medPistol','Heavy Pistol':'heavyPistol','Very Heavy Pistol':'vHeavyPistol',SMG:'smg','Heavy SMG':'heavySmg',Shotgun:'shotgun','Assault Rifle':'assaultRifle','Sniper Rifle':'sniperRifle','Grenade Launcher':'grenadeLauncher','Rocket Launcher':'rocketLauncher' };
export function catalogueMagazineType(item) {
  const match = /^(?:Drum|Extended) Magazine \((.+)\)$/.exec(catalogueIdentity(item));
  return match ? magazineTypes[match[1]] : null;
}
export function catalogueUpgradeFit(upgrade, weapon, requested = []) {
  if (upgrade?.type !== 'itemUpgrade' || weapon?.type !== 'weapon') return { allowed: true, reason: null };
  const type = catalogueMagazineType(upgrade), key = catalogueIdentity(upgrade);
  const weaponKey = catalogueIdentity(weapon);
  if (weaponKey==='SurvivalMaster') return {allowed:false,reason:'СёрвайвалМастер не допускает модификаций и техапгрейдов.'};
  const noCapacity = ['Hades Multipurpose Assault Shotgun','Midnight Arms Beast Shotgun',
    'Militech Fox Dual Ammo Pistol','Rostović Ulični Uništitelj (aka the Street Destroyer)',
    'Westwood','Sanroo Hello Cutie Ultra-K8 Assault Pistol','Multiple Ammunition Pistol','Рельсотрон Tsunami Arms «Deathwind»','Timeless WW1 Rifle to Pistol Conversion'];
  const capacity = upgrade.system?.modifiers?.magazine;
  const carrier = upgrade.flags?.[ID]?.carrierChanges ?? {};
  if (noCapacity.includes(weaponKey) && (type ||
      (capacity && Number.isFinite(Number(capacity.value)) && (Number(capacity.value) !== 0 || capacity.type === 'override')) ||
      Object.keys(carrier).some(path => /^(?:system\.)?magazine(?:\.|$)/.test(path)))) {
    return {allowed:false,reason:'Правила этого оружия запрещают модификации вместимости магазина.'};
  }
  if (Number(upgrade.system?.size) > 0 &&
      (weaponKey.startsWith('ModFire 10X (') || ['Sternmeyer M-04 Variable Assault','Tommyknocker','M-02 Heavy Rifle'].includes(weaponKey)) &&
      !['Sniping Scope','Infrared Nightvision Scope'].includes(key)) {
    return {allowed:false,reason:'Слоты этого оружия предназначены только для прицелов.'};
  }
  if (type && type !== weapon.system.weaponType) return { allowed:false, reason:`«${upgrade.name}» предназначен для другого типа оружия.` };
  if (type && [...(weapon.system.installedUpgrades ?? []), ...requested].some(i =>
    (i.id ?? i._id) !== (upgrade.id ?? upgrade._id) && catalogueMagazineType(i))) {
    return { allowed:false, reason:'На оружии может быть только один увеличенный или барабанный магазин.' };
  }
  if (['Bayonet','Grenade Launcher Underbarrel','Shotgun Underbarrel','Штык-Аэрогипо'].includes(key) &&
      !['shotgun','assaultRifle','sniperRifle'].includes(weapon.system.weaponType)) {
    return { allowed:false, reason:'Эта модификация предназначена для оружия, использующего навык длинноствольного оружия.' };
  }
  if (key === 'Подствольный крюк-кошка' && !['shotgun','assaultRifle','sniperRifle'].includes(weapon.system.weaponType) &&
      !(/^Crossbow(?: \(|$)/.test(weaponKey) || ['GunMart Hunter','Eagletech Striker','Eagletech Scorpion'].includes(weaponKey))) {
    return {allowed:false,reason:'Крюк-кошка подходит арбалетам и длинноствольному оружию.'};
  }
  if (key === 'Модуль совместимости боеприпасов' && CATALOGUE_FLAMETHROWERS.includes(weaponKey)) {
    return {allowed:false,reason:'Модуль совместимости боеприпасов не подходит огнемёту.'};
  }
  return { allowed:true, reason:null };
}
export function cataloguePreventsConcealment(weapon) {
  if (catalogueIdentity(weapon)==='Pocket Launcher' && Number(weapon.system.magazine?.value)>0) return true;
  return (weapon.system.installedUpgrades ?? []).some(i => catalogueMagazineType(i) ||
    ['Bayonet','Grenade Launcher Underbarrel','Shotgun Underbarrel'].includes(catalogueIdentity(i)));
}
/** Actual upgrade mods are copied, because core sometimes returns a data reference. */
export function filterCatalogueUpgrades(mods, weapon, { now = 0, context } = {}) {
  const upgrades = weapon.system?.installedUpgrades ?? [];
  const used = new Set();
  const result = mods.map(mod => ({ ...mod })).filter(mod => {
    const candidates = upgrades.filter(item => item.name === mod.source);
    if (!candidates.length || new Set(candidates.map(catalogueIdentity)).size !== 1) return true;
    const key = catalogueIdentity(candidates[0]);
    if (!['Smartgun Link', 'Sniping Scope'].includes(key) || Number(mod.value) !== 1) return true;
    if (candidates[0].flags?.[ID]?.empUntil > now) return false;
    if (key === 'Smartgun Link' && !hasCatalogueSmartlink(weapon.actor, now)) return false;
    if (key === 'Sniping Scope') {
      if (context && (!weapon.system.isRanged || !['attack', 'aimed'].includes(context.type))) return false;
      if (context?.distance !== null && context?.distance !== undefined && context.distance < 51) return false;
      mod.isSituational = true;
      mod.onByDefault = Boolean(context && context.distance !== null && context.distance >= 51);
      mod.source = `${candidates[0].name} (от 51 м)`;
    }
    if (used.has(key)) return false;
    used.add(key);
    return true;
  });
  if (CATALOGUE_SCOPED_GUNS.includes(catalogueIdentity(weapon)) && !used.has('Sniping Scope') &&
      !(weapon.flags?.[ID]?.empUntil > now) &&
      (!context || (['attack','aimed'].includes(context.type) && (context.distance==null || context.distance>=51)))) {
    result.push({id:'addenda-built-in-sniping-scope',source:'Встроенный снайперский прицел (от 51 м)',
      value:1,isSituational:true,onByDefault:Boolean(context?.distance>=51)});
  }
  return result;
}
