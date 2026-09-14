import { catalogueIdentity, hasCatalogueSmartlink, catalogueLiveItems, catalogueExternalCyberware, CATALOGUE_FLAMETHROWERS, CATALOGUE_SMARTGUNS } from './catalogue-rules.js';
import { hasCatalogueCyberskull, applyCyberskullDamage } from './catalogue-damage.js';
import { applyCatalogueJunkRoll } from './catalogue-ammo.js';
const HELIX = 'Tsunami Arms Helix';
const RAIL = 'Rhinemetall EMG-86 Railgun';
const HURRICANE = 'Constitutional Arms Hurricane Assault Weapon';
const MALORIAN = 'Malorian Arms 3516';
const PEPPER = 'Federated Arms Pepper Shaker';
const MICRO = 'MicroCutie by HelloCutie';
const UMBRELLA = 'Tactical Umbrella';
const VICTORIA = 'Пулемёт MetaCorp «Victoria»';
const MK27 = 'Лёгкий пулемёт Militech MK.27';
const DEATHWIND = 'Рельсотрон Tsunami Arms «Deathwind»';
const SCATTER = 'Scatter Ratter';
const AMMO_COMPATIBILITY = 'Модуль совместимости боеприпасов';
const WRONG_CALIBERS = ['medPistol','heavyPistol','vHeavyPistol','rifle','shotgunShell','shotgunSlug'];
/** Repair only the exact historical carrier operation, preserving later edits
 * and overlapping operations. This module never grants different calibers. */
export function catalogueAmmoRepair(weapon) {
  if (weapon?.type !== 'weapon') return null;
  const restore = weapon.flags?.['cpr-addenda']?.carrierRestore;
  if (!restore) return null;
  const upgrades = weapon.getInstalledItems?.('itemUpgrade') ?? weapon.system.installedUpgrades ?? [];
  for (const upgrade of upgrades) {
    if (catalogueIdentity(upgrade) !== AMMO_COMPATIBILITY) continue;
    const record = restore[upgrade.id];
    const previous = record?.['system.ammoVariety'] ?? record?.system?.ammoVariety;
    if (!Array.isArray(previous)) continue;
    if (Object.entries(restore).some(([id,paths])=>id!==upgrade.id &&
        (Object.hasOwn(paths,'system.ammoVariety') || paths.system?.ammoVariety !== undefined))) continue;
    const wrong = [...new Set([...previous,...WRONG_CALIBERS])];
    const current = weapon.system.ammoVariety;
    if (!Array.isArray(current) || current.length!==wrong.length || !current.every(x=>wrong.includes(x))) continue;
    // The shipped erroneous operation changed only this one field. Do not
    // erase custom restoration metadata or rely on object merge to delete it.
    if (Object.keys(record).length !== 1 || (record.system && Object.keys(record.system).length !== 1)) continue;
    return {'system.ammoVariety':[...previous], [`flags.cpr-addenda.carrierRestore.-=${upgrade.id}`]:null,
      'flags.cpr-addenda.catalogueAmmoRepair':{before:[...current],after:[...previous]}};
  }
  return null;
}
export function catalogueAmmoFit(weapon, ammo) {
  if (ammo?.type !== 'ammo') return true;
  const key = catalogueIdentity(weapon), s = ammo.system;
  if (CATALOGUE_FLAMETHROWERS.includes(key)) return s.variety === 'shotgunShell' && s.type === 'incendiary';
  if (key === 'Big Dreem') return catalogueIdentity(ammo)==='Big Dreem Rounds' && s.type==='basic';
  if (key === 'SportMaster') return catalogueIdentity(ammo)==='Rifle (Small Game)';
  if (key === 'Firebreather') return s.variety==='shotgunShell' && s.type==='incendiary';
  if (key === 'Sub-Flechette Gun') return catalogueIdentity(ammo) === 'Sub-Flechette Rounds' && s.type === 'armorPiercing';
  if (key === 'Nova Model 757 Cityhunter') return catalogueIdentity(ammo) === 'Nova Model 757 Rounds' && ['basic','smart','rubber'].includes(s.type);
  if (key === 'M-02 Heavy Rifle') return catalogueIdentity(ammo)==='M-02 Rounds' && s.type==='armorPiercing';
  if (key === 'TearJerker') return s.variety==='grenade' && ['smoke','teargas'].includes(s.type);
  if (key === 'SDF-45') return s.variety==='rocket' && s.type==='armorPiercing';
  if (key === 'Archimedes') return s.variety==='rocket' && s.type==='smart';
  if (key === 'Dartgun' && weapon.type === 'weapon') return s.variety === 'arrow' && !['basic','rubber'].includes(s.type);
  if (key === 'GunMart Engage Rocket Launcher') return s.variety === 'rocket' && s.type === 'armorPiercing';
  if (['Rostović Ulični Uništitelj (aka the Street Destroyer)','Crusher'].includes(key)) return s.variety === 'shotgunShell';
  return true;
}
export function catalogueAttackError(weapon, type, actor, now = 0) {
  if (catalogueIdentity(weapon)===MICRO && catalogueHyperburst(weapon) && type==='aimed') return 'В режиме «ГипурррВзрыв» прицельная атака недоступна.';
  const key = catalogueIdentity(weapon);
  if (key==='Combat Tail' && ![...catalogueLiveItems(actor,now).values()].some(i=>catalogueIdentity(i)==='Neural Link')) return 'Боевой хвост требует работающий установленный нейролинк.';
  if (key==='Timeless WW1 Rifle to Pistol Conversion' && weapon.flags?.['cpr-addenda']?.boltPending) return 'Перед следующим выстрелом передёрните затвор действием через кнопку листа оружия.';
  if (key==='SurvivalMaster' && weapon.flags?.['cpr-addenda']?.weaponDisassembled) return 'Сначала соберите СёрвайвалМастер. Сборка занимает одну минуту.';
  if (['SurvivalMaster','SportMaster'].includes(key) && ['autofire','suppressive'].includes(type)) return 'Эта винтовка не поддерживает автоогонь и подавляющий огонь.';
  const body = Number(actor?.getStat?.('body') ?? actor?.system?.stats?.body?.value ?? 0);
  const prone = [...(actor?.statuses ?? [])].some(status => /^(prone|lieDown|lying|lyingDown)$/i.test(status));
  const mounted = Boolean(weapon.flags?.['cpr-addenda']?.vehicleMountedPosition || weapon.flags?.['cpr-addenda']?.vehicleMounted);
  if (key === VICTORIA && !['autofire','suppressive'].includes(type)) return 'Victoria допускает только автоогонь и подавляющий огонь.';
  if (key === VICTORIA && body < 12 && !mounted) return 'Victoria требует ТЕЛ от 12 или установки на крепление.';
  if (key === MK27 && body < 11 && !prone && !mounted) return 'MK.27 требует ТЕЛ от 11, стрельбу лёжа или установку на крепление.';
  if (key === SCATTER && body < 8 && !mounted) return 'Scatter Ratter требует ТЕЛ от 8 или установки на крепление.';
  if (key === DEATHWIND && body < (prone ? 12 : 14)) return 'Deathwind требует ТЕЛ от 14 либо ТЕЛ от 12 при стрельбе лёжа.';
  if (catalogueExternalCyberware(weapon,actor) && !catalogueLiveItems(actor,now).has(weapon.id??weapon._id)) return 'Оружие во внешнем носителе недоступно: проверьте ношение, подключение и ЭМИ.';
  if (key === 'Archimedes' && ![...catalogueLiveItems(actor,now).values()].some(i=>catalogueIdentity(i)==='Targeting Scope')) return 'Архимед требует работающий установленный киберимплант «Тактический прицел».';
  if (key === 'M-02 Heavy Rifle' && ['autofire','suppressive'].includes(type)) return 'Штернмейер M-02 не поддерживает автоогонь и подавляющий огонь.';
  if (['Enviro-launcher','Molotov Cocktail'].includes(key) && weapon.flags?.['cpr-addenda']?.weaponDestroyed) return 'Этот одноразовый предмет уже использован.';
  if (key === 'Teen Dreem' && weapon.flags?.['cpr-addenda']?.weaponDestroyed) return 'Оружие разрушено после автоматического или подавляющего огня.';
  if (key === 'Hellbringer' && weapon.flags?.['cpr-addenda']?.weaponJammed) return 'Оружие заклинило. Устраните задержку действием через кнопку в листе оружия.';
  if ([HELIX,PEPPER,'Big Dreem'].includes(key) && type !== 'autofire') return 'Это оружие стреляет только автоматическим огнём.';
  if ([RAIL,HURRICANE,DEATHWIND,...CATALOGUE_FLAMETHROWERS,'Crusher','Aegis','Nomad Air Cannon','Molotov Cocktail'].includes(key) && type === 'aimed') return 'Это оружие не допускает прицельную атаку.';
  if (key === RAIL && ['autofire','suppressive'].includes(type)) return 'Рейнметалл EMG-86 не поддерживает автоматический огонь.';
  if (key === MALORIAN && !hasCatalogueSmartlink(actor, now)) return 'Малориан 3516 требует работающий нейролинк и личный порт или смартлинк.';
  return null;
}
export function catalogueNonlethal(weapon) {
  if (['Stun Baton','Stun Gun','Aegis'].includes(catalogueIdentity(weapon))) return true;
  try { return weapon._getLoadedAmmoProp?.('type') === 'rubber'; } catch { return false; }
}
/** Keep native damage rolls and their armor/shield application, correcting only
 * the special rules that core's general weapon schema cannot represent. */
export function applyCatalogueWeaponRules(item) {
  applyChainknifeMode(item);
  applyCatalogueAlternateProfile(item);
  if (catalogueIdentity(item)==='SurvivalMaster') item.system.concealable.concealable=Boolean(item.flags?.['cpr-addenda']?.weaponDisassembled);
  if (item._createAttackRoll) {
    const original = item._createAttackRoll;
    item._createAttackRoll = function (type, actor, ...args) {
      const error = catalogueAttackError(this, type, actor, game.time.worldTime);
      if (error) { ui.notifications.warn(error); return null; }
      const roll = original.call(this, type, actor, ...args);
      if (roll) roll._addendaFireMode = type;
      if (roll && catalogueIdentity(this)===MICRO) roll._addendaHyperburst = catalogueHyperburst(this);
      if (roll && CATALOGUE_SMARTGUNS.includes(catalogueIdentity(this)) && hasCatalogueSmartlink(actor,game.time.worldTime) &&
          !(this.flags?.['cpr-addenda']?.empUntil > game.time.worldTime) &&
          !this.getAllUpgradeMods('attackmod').some(m => m.id === 'addenda-built-in-smartlink' ||
            this.system.installedUpgrades?.some(i => catalogueIdentity(i) === 'Smartgun Link' && i.name === m.source && Number(m.value) === 1))) {
        roll.addMod([{id:'addenda-built-in-smartlink',source:'Встроенный коннектор смартлинка',value:1,isSituational:false,onByDefault:true}]);
      }
      return roll;
    };
  }
  if (item._createDamageRoll) {
    const original = item._createDamageRoll;
    item._createDamageRoll = function (type, actor, ...args) {
      const roll = original.call(this, [HELIX,PEPPER,'Big Dreem'].includes(catalogueIdentity(this)) ? 'autofire' : type, actor, ...args);
      if (!roll) return roll;
      if (catalogueIdentity(this)===MICRO && this.flags?.['cpr-addenda']?.lastHyperburst) roll.formula='4d6';
      if (['M-02 Heavy Rifle','SportMaster','SurvivalMaster'].includes(catalogueIdentity(this))) {
        this.system.fireModes.autoFire=0;roll.autofireMultiplierMax=0;
      }
      const nonlethal = catalogueNonlethal(this);
      if (catalogueIdentity(this)==='Aegis') roll.formula='4d6';
      const noDamage = ['Air Pistol','Shrieker','Microwaver','Nomad Air Cannon','TearJerker'].includes(catalogueIdentity(this));
      if (noDamage) { roll.formula = '0'; roll.mods = []; }
      if (nonlethal || noDamage || CATALOGUE_FLAMETHROWERS.includes(catalogueIdentity(this))) {
        roll.wasCritSuccess = () => false;
        roll.wasCritFail = () => false;
      }
      if (nonlethal) {
        roll._addendaNonlethal = true;
        roll.rollCardExtraArgs.ablationValue = 0;
      }
      applyCatalogueJunkRoll(roll,this,catalogueIdentity(this)===MICRO && this.flags?.['cpr-addenda']?.lastHyperburst ? '4d6' : this.system.damage);
      return roll;
    };
  }
  if (item.bulletConsumption && catalogueIdentity(item) === HELIX) item.bulletConsumption = () => 20;
  if (item.bulletConsumption && catalogueIdentity(item) === VICTORIA) item.bulletConsumption = () => 20;
  if (item.bulletConsumption && catalogueIdentity(item) === PEPPER) item.bulletConsumption = () => 6;
  if (catalogueIdentity(item)===MICRO && item.bulletConsumption) {
    const original=item.bulletConsumption;
    item.bulletConsumption=function(roll) {return (roll?._addendaHyperburst ?? catalogueHyperburst(this)) ? Number(this.system.magazine.value) : original.call(this,roll);};
    const discharge=item.dischargeItem;
    item.dischargeItem=async function(roll) {
      if (!this.hasAmmo(roll)) return false;
      const burst=roll?._addendaHyperburst ?? catalogueHyperburst(this);
      const result=await discharge.call(this,roll);
      await this.update({'flags.cpr-addenda.lastHyperburst':burst,...(this.system.magazine.value<4?{'flags.cpr-addenda.hyperburst':false}:{})});
      return result;
    };
  }
  if (catalogueIdentity(item)==='Molotov Cocktail') item.hasAmmo=function () {return !this.flags?.['cpr-addenda']?.weaponDestroyed;};
  if (catalogueIdentity(item) === 'Teen Dreem') {
    const consumption = item.bulletConsumption, hasAmmo = item.hasAmmo;
    item.bulletConsumption = function (roll) { return catalogueBurst(roll) ? Number(this.system.magazine.value) : consumption.call(this,roll); };
    item.hasAmmo = function (roll) { return !this.flags?.['cpr-addenda']?.weaponDestroyed && (catalogueBurst(roll) ? this.system.magazine.value >= 2 : hasAmmo.call(this,roll)); };
  }
  if (item.dischargeItem && ['Teen Dreem','Hellbringer','Enviro-launcher','Molotov Cocktail','Timeless WW1 Rifle to Pistol Conversion'].includes(catalogueIdentity(item))) {
    const original = item.dischargeItem;
    item.dischargeItem = async function (roll) {
      if (!this.hasAmmo(roll)) return false;
      const key = catalogueIdentity(this), burst = catalogueBurst(roll);
      const jam = key === 'Hellbringer' && Number(this.actor?.getStat('body')) < 10;
      const result = await original.call(this,roll);
      if (key === 'Teen Dreem' && burst) await this.update({'flags.cpr-addenda.weaponDestroyed':true});
      if (['Enviro-launcher','Molotov Cocktail'].includes(key)) await this.update({'flags.cpr-addenda.weaponDestroyed':true});
      if (key === 'Timeless WW1 Rifle to Pistol Conversion') await this.update({'flags.cpr-addenda.boltPending':true});
      if (jam) await this.update({'flags.cpr-addenda.weaponJammed':true});
      return result;
    };
  }
  if (item.canInstallItems) {
    const original = item.canInstallItems;
    item.canInstallItems = function (items, ...args) {
      if (catalogueIdentity(this)==='Firebreather' && items.some(i=>i.type==='itemUpgrade')) {
        ui.notifications.warn('Огненное дыхание несовместимо с модификациями оружия.');return false;
      }
      if (items.some(ammo => !catalogueAmmoFit(this, ammo))) {
        ui.notifications.warn('Этот боеприпас не подходит оружию. Допустимый тип указан в описании.');
        return false;
      }
      return original.call(this, items, ...args);
    };
  }
}
export function catalogueBurst(roll) {
  return ['autofire','suppressive'].includes(roll?._addendaFireMode) || /cpr-(?:autofire|suppressive)/.test(roll?.rollCard ?? '');
}
export function catalogueHyperburst(item) {
  return Boolean(item.flags?.['cpr-addenda']?.hyperburst && Number(item.system?.magazine?.value)>=4);
}
export function applyCatalogueAlternateProfile(item) {
  const key=catalogueIdentity(item),s=item.system;
  if (key===MICRO) {
    if (['2d6','4d6'].includes(s.damage)) s.damage=catalogueHyperburst(item)?'4d6':'2d6';
    if ([1,2].includes(s.rof)) s.rof=catalogueHyperburst(item)?1:2;
  }
  if (key===UMBRELLA) {
    const melee=Boolean(item.flags?.['cpr-addenda']?.umbrellaMelee);
    if (['heavyPistol','heavyMelee'].includes(s.weaponType)) {
      s.weaponType=melee?'heavyMelee':'heavyPistol';s.weaponSkill=melee?'Melee Weapon':'Handgun';s.isRanged=!melee;
      s.quality=melee?'excellent':'poor';s.attackmod=melee?1:0;s.canIgnoreArmor=melee;s.ignoreArmorPercent=melee?50:0;
    }
  }
}
export function applyChainknifeMode(item) {
  if (catalogueIdentity(item) !== 'Chainknife') return;
  const s=item.system, revved=Boolean(item.flags?.['cpr-addenda']?.chainknifeRevved);
  // Derive only the original profiles. Preserve custom damage or quality.
  if (['2d6','4d6'].includes(s.damage)) s.damage=revved?'4d6':'2d6';
  if (['medMelee','vHeavyMelee'].includes(s.weaponType)) s.weaponType=revved?'vHeavyMelee':'medMelee';
  if (['standard','excellent'].includes(s.quality)) s.quality=revved?'excellent':'standard';
  if ([0,1].includes(s.attackmod)) s.attackmod=revved?1:0;
}
export function catalogueWeaponButtons(item) {
    const buttons=[];if (!item?.isOwner || item.pack) return buttons;
    if (catalogueIdentity(item)===MICRO) buttons.unshift({class:'addenda-hyperburst',icon:'fas fa-fire',
      label:catalogueHyperburst(item)?'Выключить ГипурррВзрыв (действие)':'Включить ГипурррВзрыв (действие)',
      onclick:()=>{
        if(!catalogueHyperburst(item) && item.system.magazine.value<4) return ui.notifications.warn('Для ГипурррВзрыва нужно не менее четырёх патронов.');
        return item.update({'flags.cpr-addenda.hyperburst':!catalogueHyperburst(item)});
      }});
    if (catalogueIdentity(item)===UMBRELLA) buttons.unshift({class:'addenda-umbrella-mode',icon:'fas fa-exchange-alt',
      label:item.flags?.['cpr-addenda']?.umbrellaMelee?'Профиль: пистолет':'Профиль: холодное оружие',
      onclick:()=>item.update({'flags.cpr-addenda.umbrellaMelee':!item.flags?.['cpr-addenda']?.umbrellaMelee})});
    if (catalogueIdentity(item)==='Timeless WW1 Rifle to Pistol Conversion' && item.flags?.['cpr-addenda']?.boltPending) buttons.unshift({
      class:'addenda-cycle-bolt',icon:'fas fa-wrench',label:'Передёрнуть затвор (действие)',
      onclick:()=>item.update({'flags.cpr-addenda.boltPending':false})});
    if (catalogueIdentity(item)==='SurvivalMaster') buttons.unshift({
      class:'addenda-disassemble',icon:'fas fa-wrench',label:item.flags?.['cpr-addenda']?.weaponDisassembled?'Собрать (1 мин)':'Разобрать (1 мин)',
      onclick:()=>item.update({'flags.cpr-addenda.weaponDisassembled':!item.flags?.['cpr-addenda']?.weaponDisassembled,'system.concealable.isConcealed':false})});
    if (catalogueIdentity(item)==='Chainknife') buttons.unshift({
      class:'addenda-chainknife-mode',icon:'fas fa-power-off',
      label:item.flags?.['cpr-addenda']?.chainknifeRevved?'Выключить (действие)':'Завести (действие)',
      onclick:()=>item.update({'flags.cpr-addenda.chainknifeRevved':!item.flags?.['cpr-addenda']?.chainknifeRevved})});
    if (catalogueIdentity(item)==='Hellbringer' && item.flags?.['cpr-addenda']?.weaponJammed) buttons.unshift({
      class:'addenda-clear-jam',icon:'fas fa-wrench',label:'Устранить задержку (действие)',
      onclick:()=>item.update({'flags.cpr-addenda.weaponJammed':false})});
    return buttons;
}
export function registerCatalogueWeaponControls() {
  Hooks.on('getItemSheetHeaderButtons',(sheet,buttons)=>buttons.unshift(...catalogueWeaponButtons(sheet.object)));
  // V12 refreshes the sheet body without rebuilding its outer window header.
  // Reconcile our controls after every render, including newly jammed weapons.
  Hooks.on('renderItemSheet',sheet=>{
    const header=sheet.element?.[0]?.querySelector('.window-header');if(!header)return;
    const classes=['addenda-hyperburst','addenda-umbrella-mode','addenda-cycle-bolt','addenda-disassemble','addenda-chainknife-mode','addenda-clear-jam'];
    for(const button of header.querySelectorAll(classes.map(c=>'.'+c).join(',')))button.remove();
    for(const spec of catalogueWeaponButtons(sheet.object)) {
      const button=document.createElement('a');button.classList.add('header-button',spec.class);
      const icon=document.createElement('i');icon.className=spec.icon;
      button.append(icon,document.createTextNode(' '+spec.label));
      button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();spec.onclick(event);});
      header.insertBefore(button,header.querySelector('.close'));
    }
  });
  Hooks.on('preUpdateItem',(item,changes)=>{
    if (catalogueIdentity(item)===MICRO) {
      const ammo=foundry.utils.getProperty(changes,'system.magazine.value');
      if(ammo!==undefined && Number(ammo)<4) foundry.utils.setProperty(changes,'flags.cpr-addenda.hyperburst',false);
    }
    if (catalogueIdentity(item)!=='Chainknife') return;
    const equipped=foundry.utils.getProperty(changes,'system.equipped');
    if (equipped!==undefined && equipped!=='equipped') foundry.utils.setProperty(changes,'flags.cpr-addenda.chainknifeRevved',false);
  });
  Hooks.on('preCreateItem',item=>{
    if (catalogueIdentity(item)==='Chainknife') item.updateSource({'flags.cpr-addenda.chainknifeRevved':false});
  });
}
export function nonlethalKnockout(data) {
  const hp = data.actor?.system?.derivedStats?.hp?.value;
  return data.damageLethal === false && hp > 0 && hp <= 1 &&
    Number.isFinite(data.totalDamageDealt) && Number.isFinite(data.totalDamageReduction) &&
    Math.max(0, data.totalDamageDealt - data.totalDamageReduction) >= hp + data.hpReduction;
}
export async function renderCatalogueWeaponCard(wrapped, roll, ...args) {
  if (!roll._addendaNonlethal || !roll.rollCard.endsWith('/chat/cpr-damage-rollcard.hbs')) return wrapped(roll, ...args);
  // Use a module template and core's original message creation, preserving its
  // visibility, speaker and integration hooks. Foundry v12's global renderTemplate
  // is non-configurable and cannot be wrapped through libWrapper.
  roll.criticalCard = false;
  const template = document.createElement('template');
  template.innerHTML = await renderTemplate(roll.rollCard, roll);
  for (const button of template.content.querySelectorAll('[data-action="applyDamage"]')) {
    button.dataset.damageLethal = 'false'; button.dataset.bonusDamage = '0'; button.dataset.ablation = '0';
  }
  const previous = roll.rollCard;
  roll._addendaRenderedCard = template.innerHTML;
  roll.rollCard = 'modules/cpr-addenda/templates/nonlethal-card.hbs';
  try { return await wrapped(roll, ...args); }
  finally { roll.rollCard = previous; delete roll._addendaRenderedCard; }
}
export function registerCatalogueWeaponCards(CPRChat) {
  globalThis.cprAddendaCatalogueChat = CPRChat;
  libWrapper.register('cpr-addenda', 'cprAddendaCatalogueChat.RenderDamageApplicationCard', async function (wrapped, data) {
    if (nonlethalKnockout(data) && data.actor.isOwner) {
      const status = CONFIG.statusEffects.find(e => /unconscious|без сознания/i.test(`${e.id} ${game.i18n.localize(e.name ?? e.label ?? '')}`));
      if (status) await data.actor.toggleStatusEffect(status.id, {active:true});
    }
    return wrapped(data);
  }, 'WRAPPER');
  libWrapper.register('cpr-addenda', 'CONFIG.Actor.documentClass.prototype._applyDamage', async function (wrapped, damage, bonus, location, ablation, variety, ...args) {
    if (location === 'head' && hasCatalogueCyberskull(this, game.time.worldTime)) {
      const {default:ActorUtils} = await import('/systems/cyberpunk-red-core/modules/utils/ActorUtils.js');
      return applyCyberskullDamage(this, [damage,bonus,location,ablation,variety,...args], ActorUtils, CPRChat);
    }
    const form = args[3];
    if (variety !== 'paintball' || damage !== 0 || bonus !== 0 || ablation !== 1 ||
        !['body','head'].includes(location) ||
        (form?.useShield && this.getEquippedArmors('shield').some(i => i.system.shieldHitPoints.value > 0))) {
      return wrapped(damage, bonus, location, ablation, variety, ...args);
    }
    const armors = this.getEquippedArmors(location);
    const {default:ArmorUtils} = await import('/systems/cyberpunk-red-core/modules/utils/ActorUtils.js');
    const sp = Math.max(0, ...await Promise.all(armors.map(item => ArmorUtils.calculateArmorSP(item, location, true))));
    if (armors.length) await this._ablateArmor(location, 1);
    return CPRChat.RenderDamageApplicationCard({actor:this,damage:0,bonusDamage:0,hpReduction:0,
      rawDamageDealt:0,totalDamageDealt:0,totalDamageReduction:0,location,
      armorData:{value:sp,equipped:armors.length>0},ablation:armors.length?1:0,shieldAblation:0});
  }, 'MIXED');
}
