// HUD, plan sheet, help, plan-mode chrome.
import { TOOLS } from './tools.js';
import { FEATURE_TYPES } from './plan.js';
import { CFG } from './config.js';

const $ = id => document.getElementById(id);

export const UI = {
  init() {
    this.el = {
      loading: $('loading'), loadingText: $('loadingText'), loadingBar: $('loadingBar'),
      hud: $('hud'), tool: $('hudTool'), mode: $('hudMode'), brush: $('hudBrush'),
      soil: $('hudSoil'), stamina: $('barStamina'), load: $('barLoad'), loadText: $('loadText'),
      toast: $('toast'), cross: $('crosshair'), barrow: $('barrowBox'), stats: $('statLine'),
      staminaNum: $('hudStamina'),
      target: $('target'), targetName: $('targetName'), targetH: $('tH'), targetR: $('tR'),
      targetHBar: $('tHBar'), targetRBar: $('tRBar'), sweep: $('sweep'),
      help: $('help'), planSheet: $('planSheet'), planRows: $('planRows'),
      planUI: $('planUI'), planPalette: $('planPalette'), planInfo: $('planInfo'),
      intro: $('intro'), action: $('hudAction'), feature: $('hudFeature'),
      barrowBar: $('barrowBar'), barrowText: $('barrowText'),
    };
    this.el.planPalette.innerHTML = FEATURE_TYPES.map((t, i) => `
      <div class="pt" data-type="${t.id}" style="--c:#${t.color.toString(16).padStart(6, '0')}">
        <b>${i + 1}</b> ${t.name}<span>r${t.r}m h${Math.abs(t.h)}m</span>
      </div>`).join('');
    this.el.hint = $('hint');
  },

  setLoading(text, pct) {
    this.el.loadingText.textContent = text;
    this.el.loadingBar.style.width = Math.round(pct * 100) + '%';
  },
  hideLoading() { this.el.loading.classList.add('gone'); },

  showHelp(v) { this.el.help.classList.toggle('show', v); },
  showSheet(v) { this.el.planSheet.classList.toggle('show', v); },
  showPlanUI(v) {
    this.el.planUI.classList.toggle('show', v);
    document.body.classList.toggle('planmode', v);
  },
  showIntro(v) { this.el.intro.classList.toggle('show', v); },

  toast(msg, t = 2.4) {
    if (!msg) return;
    this.el.toast.textContent = msg;
    this.el.toast.classList.add('show');
    clearTimeout(this._tt);
    this._tt = setTimeout(() => this.el.toast.classList.remove('show'), t * 1000);
  },

  // what LMB does with the tool in hand — one line, no modes to remember
  verb(toolId) {
    return toolId === 'flathead' ? 'pack' : toolId === 'pickaxe' ? 'break'
      : toolId === 'rake' ? 'level' : 'dig / slap';
  },

  update(state) {
    const { player, planProgress, terrain, mode } = state;
    this.el.tool.textContent = player.tool.name;
    this.el.mode.textContent = `LMB ${this.verb(player.tool.id)}\nRMB place dirt`;
    this.el.mode.classList.toggle('pour', player.action === 'place dirt' || player.action === 'trickle');
    this.el.brush.textContent = player.brushRadius.toFixed(2) + ' m';
    this.el.action.textContent = player.working ? player.action : '—';

    const aim = player.aim;
    if (aim.hit) {
      const p = terrain.packedAt(aim.point.x, aim.point.z);
      const slope = terrain.slopeAt(aim.point.x, aim.point.z);
      const angle = Math.atan(slope) * 180 / Math.PI;
      // spoil will not go back into the hole it came out of
      const inHole = terrain.blockedDump(aim.point.x, aim.point.z,
        player.placeRNow || player.brushRadius);
      this.el.soil.textContent =
        `packed ${(p / 255 * 100).toFixed(0)}%   face ${angle.toFixed(0)}°   ` +
        `${p > 190 ? 'FIRM' : p > 90 ? 'holding' : 'LOOSE — will slump'}` +
        (inHole ? '   · in the hole you dug — dump it outside' : '');
      this.el.soil.classList.toggle('loose', p <= 90);
      this.el.soil.classList.toggle('inhole', inHole);
    } else {
      this.el.soil.textContent = 'looking at the sky';
      this.el.soil.classList.remove('loose');
      this.el.soil.classList.remove('inhole');
    }
    this.el.cross.classList.toggle('active', !!aim.hit);

    this.el.stamina.style.width = player.stamina.toFixed(0) + '%';
    this.el.stamina.classList.toggle('low', player.stamina < 22);
    if (this.el.staminaNum) this.el.staminaNum.textContent = player.stamina.toFixed(0) + '%';
    const cap = player.loadMax;
    const full = player.load >= cap - 0.5;
    this.el.load.style.width = Math.min(100, player.load / cap * 100).toFixed(0) + '%';
    this.el.load.classList.toggle('full', full);
    this.el.loadText.classList.toggle('full', full);
    this.el.loadText.textContent = full
      ? `${player.load.toFixed(0)} / ${cap} L — FULL · RMB to place`
      : `${player.load.toFixed(0)} / ${cap} L`;

    const b = player.barrow;
    if (b.placed) {
      const d = player.barrowDist();
      this.el.barrow.classList.add('show');
      this.el.barrowBar.style.width = (b.fill / CFG.BARROW_MAX * 100).toFixed(0) + '%';
      this.el.barrowText.textContent = d < 3.2
        ? `wheelbarrow — ${b.fill.toFixed(0)} L (in range)`
        : `wheelbarrow — ${b.fill.toFixed(0)} L · ${d.toFixed(1)} m away`;
      this.el.barrow.classList.toggle('near', d < 3.2);
    } else this.el.barrow.classList.remove('show');

    // nearest planned feature reference
    let best = null, bd = 1e9;
    for (const f of planProgress) {
      const dx = f.x - player.pos.x, dz = f.z - player.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < bd) { bd = d; best = f; }
    }
    if (best && bd < 60) {
      this.el.target.classList.add('show');
      this.el.targetName.textContent = `${best.name} · ${bd.toFixed(0)} m`;
      this.el.targetH.textContent = `${best.rise >= 0 ? '+' : ''}${best.rise.toFixed(2)} / ${best.target.toFixed(2)} m`;
      this.el.targetR.textContent = `${best.measR.toFixed(2)} / ${best.r.toFixed(2)} m`;
      this.el.targetHBar.style.width = Math.min(100, best.hProg * 100).toFixed(0) + '%';
      this.el.targetRBar.style.width = Math.min(100, best.rProg * 100).toFixed(0) + '%';
      this.el.targetHBar.classList.toggle('done', best.hProg > 0.9);
      this.el.targetRBar.classList.toggle('done', best.rProg > 0.75);
      this.el.feature.textContent = `${best.name}: ${(Math.min(best.hProg, 1) * 100).toFixed(0)}% built`;
    } else {
      this.el.target.classList.remove('show');
      this.el.feature.textContent = planProgress.length ? `${planProgress.length} planned features` : 'no plan yet — click Plan';
    }
    this.el.stats.textContent =
      `dug ${(player.stats.litresDug / 1000).toFixed(2)} m³ · placed ${(player.stats.litresPlaced / 1000).toFixed(2)} m³`;
  },

  renderSheet(progress) {
    if (!progress.length) {
      this.el.planRows.innerHTML = `<tr><td colspan="5" class="muted">No features planned. Click <b>Plan</b>, then click the ground in plan view.</td></tr>`;
      return;
    }
    this.el.planRows.innerHTML = progress.map((f, i) => {
      const wpct = Math.min(100, f.hProg * 100).toFixed(0);
      const rpct = Math.min(100, f.rProg * 100).toFixed(0);
      return `<tr class="${f.done ? 'done' : ''}">
        <td>${i + 1}</td>
        <td>${f.name}</td>
        <td>${f.rise >= 0 ? '+' : ''}${f.rise.toFixed(2)} / ${f.target.toFixed(2)} m</td>
        <td>${f.measR.toFixed(2)} / ${f.r.toFixed(2)} m</td>
        <td><div class="mini"><i style="width:${wpct}%"></i></div><div class="mini"><i class="${f.done ? 'ok' : ''}" style="width:${rpct}%"></i></div></td>
      </tr>`;
    }).join('');
  },
};
