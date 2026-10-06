'use strict';

const TICK_MS = 1000;

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

class CTOS {
  constructor() {
    this.cols = 8;
    this.rows = 6;
    this.tick = 0;
    this.hour = 8.5;
    this.weather = 'clear';
    this.weatherTimer = 0;
    this.attackerTimer = 0;
    this.lights = [];
    this.roads = [];
    this.cameras = [];
    this.substations = [];
    this.events = [];
    this.history = [];
    this.threat = 5;
    this.controlled = false;
    this.build();
    this.log('system', 'ctOS online — distrito de Chicago-Norte inicializado');
  }

  build() {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const id = `L-${r}-${c}`;
        this.lights.push({
          id,
          x: c,
          y: r,
          mode: 'auto',
          state: (r + c) % 2 === 0 ? 'ns' : 'ew',
          yellow: false,
          timer: Math.floor(rand(4, 12)),
          powered: true,
        });
      }
    }

    const idx = (r, c) => r * this.cols + c;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (c < this.cols - 1) {
          this.roads.push({ id: `H-${r}-${c}`, a: idx(r, c), b: idx(r, c + 1), axis: 'h', flow: rand(0.2, 0.9), load: rand(10, 80) });
        }
        if (r < this.rows - 1) {
          this.roads.push({ id: `V-${r}-${c}`, a: idx(r, c), b: idx(r + 1, c), axis: 'v', flow: rand(0.2, 0.9), load: rand(10, 80) });
        }
      }
    }

    const camSpots = [
      [0, 0], [0, 7], [2, 3], [3, 5], [5, 0], [5, 7], [1, 5], [4, 2],
    ];
    camSpots.forEach(([r, c], i) => {
      this.cameras.push({
        id: `CAM-${String(i + 1).padStart(2, '0')}`,
        x: c,
        y: r,
        online: true,
        pan: 0,
        zoom: 1,
        recording: true,
        detections: 0,
      });
    });

    const subs = [
      { id: 'SUB-01', zone: 'noroeste', capacity: 100 },
      { id: 'SUB-02', zone: 'nordeste', capacity: 100 },
      { id: 'SUB-03', zone: 'sudoeste', capacity: 100 },
      { id: 'SUB-04', zone: 'sudeste', capacity: 100 },
    ];
    subs.forEach((s) => {
      this.substations.push({ ...s, load: rand(35, 65), online: true });
    });
  }

  log(type, msg) {
    this.events.unshift({ t: Date.now(), tick: this.tick, type, msg });
    if (this.events.length > 200) this.events.pop();
  }

  lightAt(r, c) {
    if (r < 0 || c < 0 || r >= this.rows || c >= this.cols) return null;
    return this.lights[r * this.cols + c];
  }

  zoneOf(x, y) {
    return (y < this.rows / 2 ? 0 : 2) + (x < this.cols / 2 ? 0 : 1);
  }

  isNight() {
    return this.hour >= 19 || this.hour < 6;
  }

  setLight(id, mode) {
    const l = this.lights.find((x) => x.id === id);
    if (!l) return { ok: false, error: 'semáforo não encontrado' };
    if (!['auto', 'ns', 'ew', 'blink', 'off'].includes(mode)) return { ok: false, error: 'modo inválido' };
    l.mode = mode;
    l.yellow = false;
    if (mode === 'ns' || mode === 'ew') l.state = mode;
    if (mode === 'off') l.powered = false;
    else l.powered = true;
    this.log('control', `semáforo ${id} → modo ${mode}`);
    return { ok: true };
  }

  setLightLine(axis, index, mode) {
    if (!['row', 'col'].includes(axis)) return { ok: false, error: 'eixo inválido' };
    if (!['auto', 'ns', 'ew', 'blink', 'off'].includes(mode)) return { ok: false, error: 'modo inválido' };
    const targets = axis === 'row'
      ? this.lights.filter((l) => l.y === index)
      : this.lights.filter((l) => l.x === index);
    if (!targets.length) return { ok: false, error: 'linha/coluna fora da grade' };
    targets.forEach((l) => {
      l.mode = mode;
      l.yellow = false;
      if (mode === 'ns' || mode === 'ew') l.state = mode;
      l.powered = mode !== 'off';
    });
    this.log('control', `${axis === 'row' ? 'linha' : 'coluna'} ${index} → modo ${mode} (${targets.length} semáforos)`);
    return { ok: true, count: targets.length };
  }

  setWeather(kind) {
    if (!['clear', 'rain', 'storm'].includes(kind)) return { ok: false, error: 'clima desconhecido' };
    this.weather = kind;
    this.weatherTimer = kind === 'clear' ? 0 : Math.floor(rand(45, 90));
    const names = { clear: 'céu limpo', rain: 'chuva', storm: 'tempestade' };
    this.log('system', `previsão alterada: ${names[kind]}`);
    return { ok: true };
  }

  setSubstation(id, online) {
    const s = this.substations.find((x) => x.id === id);
    if (!s) return { ok: false, error: 'subestação não encontrada' };
    s.online = !!online;
    this.log('power', `${id} ${s.online ? 'restaurada' : 'DESLIGADA'} — zona ${s.zone}`);
    if (!s.online) this.threat = clamp(this.threat + 12, 0, 100);
    return { ok: true };
  }

  setCamera(id, patch) {
    const cam = this.cameras.find((x) => x.id === id);
    if (!cam) return { ok: false, error: 'câmera não encontrada' };
    if (!cam.online) return { ok: false, error: 'câmera offline' };
    if (patch.pan !== undefined) cam.pan = clamp(Number(patch.pan) || 0, -180, 180);
    if (patch.zoom !== undefined) cam.zoom = clamp(Number(patch.zoom) || 1, 1, 4);
    if (patch.recording !== undefined) cam.recording = !!patch.recording;
    this.log('camera', `${id} pan=${cam.pan}° zoom=${cam.zoom}x`);
    return { ok: true };
  }

  triggerEvent(kind) {
    const events = {
      blackout: () => {
        const subs = this.substations.filter((s) => s.online);
        if (!subs.length) return 'nenhuma subestação ativa';
        const s = subs[Math.floor(Math.random() * subs.length)];
        this.setSubstation(s.id, false);
        return `apagão na zona ${s.zone} (${s.id})`;
      },
      hack: () => {
        this.controlled = true;
        this.attackerTimer = Math.floor(rand(15, 30));
        this.threat = clamp(this.threat + 25, 0, 100);
        return 'INTRUSÃO: atacante assumiu controle central do ctOS';
      },
      restore: () => {
        this.controlled = false;
        this.attackerTimer = 0;
        this.threat = clamp(this.threat - 20, 0, 100);
        this.weather = 'clear';
        this.weatherTimer = 0;
        this.substations.forEach((s) => { s.online = true; });
        this.lights.forEach((l) => { l.mode = 'auto'; l.powered = true; l.yellow = false; l.timer = Math.floor(rand(4, 12)); });
        this.cameras.forEach((c) => { c.online = true; c.recording = true; });
        this.roads.forEach((r) => { r.load = clamp(r.load - 30, 5, 60); r.flow = rand(0.5, 0.9); });
        return 'controle restaurado — todos os subsistemas online';
      },
      jam: () => {
        this.roads.forEach((r) => { r.load = clamp(r.load + rand(15, 40), 0, 100); r.flow = rand(0.05, 0.25); });
        this.threat = clamp(this.threat + 8, 0, 100);
        return ' congestionamento grave induzido na malha viária';
      },
      crime: () => {
        const online = this.cameras.filter((c) => c.online);
        if (!online.length) return 'nenhuma câmera online';
        const cam = online[Math.floor(Math.random() * online.length)];
        cam.detections++;
        this.threat = clamp(this.threat + 6, 0, 100);
        return `atividade suspeita detectada por ${cam.id} (${cam.x},${cam.y})`;
      },
      attacker: () => {
        this.controlled = true;
        this.attackerTimer = Math.floor(rand(8, 15));
        this.threat = clamp(this.threat + 30, 0, 100);
        return 'ATAQUE COORDENADO: atacante assumiu o ctOS e iniciou sabotagem';
      },
      rain: () => { this.weather = 'rain'; this.weatherTimer = Math.floor(rand(45, 90)); return 'chuva forte se aproximando do distrito'; },
      storm: () => { this.weather = 'storm'; this.weatherTimer = Math.floor(rand(30, 60)); this.threat = clamp(this.threat + 5, 0, 100); return 'tempestade elétrica — risco de surtos na rede'; },
    };
    const fn = events[kind];
    if (!fn) return { ok: false, error: 'evento desconhecido' };
    const msg = fn();
    this.log('alert', msg);
    return { ok: true, msg };
  }

  step() {
    this.tick++;

    // relógio do distrito: 1 tick = 2 min simulados (dia completo a cada 12 min)
    this.hour = (this.hour + 2 / 60) % 24;

    // clima expira
    if (this.weather !== 'clear' && --this.weatherTimer <= 0) {
      this.weather = 'clear';
      this.log('system', 'tempo abriu — céu limpo');
    }

    const rain = this.weather === 'rain';
    const storm = this.weather === 'storm';
    const night = this.isNight();
    const rush = (this.hour >= 7 && this.hour < 9) || (this.hour >= 17 && this.hour < 19.5);

    for (const l of this.lights) {
      const sub = this.substations[this.zoneOf(l.x, l.y)];
      l.powered = (sub ? sub.online : true) && l.mode !== 'off';
      if (!l.powered) continue;

      if (l.mode === 'blink') {
        l.yellow = false;
        l.state = Math.floor(this.tick / 2) % 2 === 0 ? 'ns' : 'ew';
        continue;
      }
      if (l.mode === 'auto') {
        l.timer--;
        if (l.timer <= 1 && l.timer > 0) l.yellow = true;
        if (l.timer <= 0) {
          l.state = l.state === 'ns' ? 'ew' : 'ns';
          l.yellow = false;
          l.timer = Math.floor(rand(5, 14));
        }
      } else {
        l.yellow = false;
      }
    }

    const weatherFactor = storm ? 1.6 : rain ? 1.3 : 1;
    const demandFactor = (rush ? 1.35 : night ? 0.6 : 1) * weatherFactor;

    for (const road of this.roads) {
      const a = this.lights[road.a];
      const b = this.lights[road.b];
      const wanted = road.axis === 'h' ? 'ew' : 'ns';
      const greenA = a.powered && a.state === wanted && !a.yellow;
      const greenB = b.powered && b.state === wanted && !b.yellow;
      const open = (greenA || greenB) && a.powered && b.powered;
      const targetFlow = (open ? rand(0.55, 1) : rand(0.02, 0.2)) / weatherFactor;
      road.flow += (targetFlow - road.flow) * 0.2;
      const push = (road.flow > 0.4 ? rand(-6, 8) : rand(2, 12)) * demandFactor;
      const targetLoad = clamp(road.load + push, 5, 100);
      road.load += (targetLoad - road.load) * 0.15;
      if (road.flow < 0.25 && Math.random() < 0.1) road.load = clamp(road.load + rand(3, 9), 0, 100);
      if (road.flow > 0.7 && Math.random() < 0.25) road.load = clamp(road.load - rand(2, 7), 0, 100);
    }

    for (const s of this.substations) {
      if (!s.online) { s.load = Math.max(0, s.load - 8); continue; }
      const target = rand(45, 80) * (rush ? 1.15 : 1);
      s.load += (target - s.load) * 0.1;
      if (s.load > 92) { this.log('power', `${s.id} sobrecarga (${s.load.toFixed(0)}%)`); this.threat = clamp(this.threat + 3, 0, 100); }
      if (storm && Math.random() < 0.015) {
        s.online = false;
        this.log('power', `${s.id} atingida por raio — DESLIGADA`);
        this.threat = clamp(this.threat + 10, 0, 100);
      }
    }

    // câmeras: sem energia na zona ou offline
    for (const cam of this.cameras) {
      const sub = this.substations[this.zoneOf(cam.x, cam.y)];
      if (sub && !sub.online) {
        if (cam.online) { cam.online = false; this.log('camera', `${cam.id} sem energia na zona`); }
        continue;
      }
      if (!cam.online && Math.random() < 0.05) {
        cam.online = true;
        this.log('camera', `${cam.id} reconectada`);
      }
      if (cam.online && cam.recording && Math.random() < (night ? 0.2 : 0.08)) cam.detections++;
    }
    if (Math.random() < 0.015) {
      const cam = this.cameras[Math.floor(Math.random() * this.cameras.length)];
      if (cam.online) { cam.online = false; this.log('camera', `${cam.id} OFFLINE`); }
    }

    // IA do atacante: enquanto controla, sabota o sistema
    if (this.controlled && --this.attackerTimer <= 0) {
      this.attackerTimer = Math.floor(rand(8, 16));
      const moves = [
        () => {
          const l = this.lights[Math.floor(Math.random() * this.lights.length)];
          if (l.powered) { l.mode = 'blink'; this.log('alert', `atacante alterou ${l.id} para pisca-alerta`); }
        },
        () => {
          const s = this.substations.filter((x) => x.online);
          if (s.length > 1) {
            const sub = s[Math.floor(Math.random() * s.length)];
            sub.online = false;
            this.log('alert', `atacante derrubou ${sub.id} (zona ${sub.zone})`);
          }
        },
        () => {
          const cam = this.cameras.filter((c) => c.online);
          if (cam.length) {
            const c = cam[Math.floor(Math.random() * cam.length)];
            c.online = false;
            this.log('alert', `atacante desligou ${c.id}`);
          }
        },
        () => {
          const axis = Math.random() < 0.5 ? 'row' : 'col';
          const idx = Math.floor(Math.random() * (axis === 'row' ? this.rows : this.cols));
          this.setLightLine(axis, idx, 'ew');
          this.log('alert', `atacante forçou ${axis === 'row' ? 'linha' : 'coluna'} ${idx} para eixo L–O`);
        },
      ];
      moves[Math.floor(Math.random() * moves.length)]();
      this.threat = clamp(this.threat + 4, 0, 100);
      if (this.threat >= 100) {
        this.log('alert', 'ameaça em nível máximo — contramedida recomendada');
      }
    }

    const avgLoad = this.roads.reduce((s, r) => s + r.load, 0) / this.roads.length;
    const powerOn = this.substations.filter((s) => s.online).length / this.substations.length;

    if (Math.random() < 0.04) this.triggerEvent('crime');

    if (this.controlled) this.threat = clamp(this.threat + 1.2, 0, 100);
    else this.threat = clamp(this.threat - 0.4 + (avgLoad > 75 ? 0.3 : 0), 0, 100);

    // histórico de métricas (1 amostra/tick, janela de 10 min)
    this.history.push({
      tick: this.tick,
      hour: Math.round(this.hour * 10) / 10,
      congestion: Math.round(avgLoad * 10) / 10,
      power: Math.round(powerOn * 1000) / 10,
      threat: Math.round(this.threat * 10) / 10,
      cameras: this.cameras.filter((c) => c.online).length,
      weather: this.weather,
    });
    if (this.history.length > 600) this.history.shift();

    return this.snapshot(avgLoad, powerOn);
  }

  snapshot(avgLoad, powerOn) {
    if (avgLoad === undefined) avgLoad = this.roads.reduce((s, r) => s + r.load, 0) / this.roads.length;
    if (powerOn === undefined) powerOn = this.substations.filter((s) => s.online).length / this.substations.length;
    const r1 = (n) => Math.round(n * 10) / 10;
    return {
      tick: this.tick,
      time: Date.now(),
      hour: Math.round(this.hour * 10) / 10,
      weather: this.weather,
      night: this.isNight(),
      threat: r1(this.threat),
      controlled: this.controlled,
      metrics: {
        congestion: r1(avgLoad),
        power: r1(powerOn * 100),
        camerasOnline: this.cameras.filter((c) => c.online).length,
        camerasTotal: this.cameras.length,
        lights: this.lights.filter((l) => l.powered).length,
        lightsTotal: this.lights.length,
        alerts: this.events.filter((e) => e.type === 'alert').length,
      },
      lights: this.lights.map((l) => ({
        id: l.id, x: l.x, y: l.y, mode: l.mode, state: l.state,
        yellow: l.yellow, powered: l.powered,
      })),
      roads: this.roads.map((r) => ({ id: r.id, a: r.a, b: r.b, axis: r.axis, flow: r1(r.flow), load: r1(r.load) })),
      cameras: this.cameras.map((c) => ({
        id: c.id, x: c.x, y: c.y, online: c.online, pan: c.pan,
        zoom: c.zoom, recording: c.recording, detections: c.detections,
      })),
      substations: this.substations.map((s) => ({ id: s.id, zone: s.zone, load: r1(s.load), online: s.online })),
      events: this.events.slice(0, 25),
      grid: { cols: this.cols, rows: this.rows },
      stats: {
        avgCongestion: Math.round((this.history.length ? this.history.reduce((s, h) => s + h.congestion, 0) / this.history.length : avgLoad) * 10) / 10,
        peakCongestion: this.history.length ? Math.max(...this.history.map((h) => h.congestion)) : Math.round(avgLoad * 10) / 10,
        historyLen: this.history.length,
        uptime: this.tick,
        offlineSubs: this.substations.filter((s) => !s.online).length,
        offlineCams: this.cameras.filter((c) => !c.online).length,
      },
    };
  }
}

module.exports = { CTOS, TICK_MS };
