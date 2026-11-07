// ============================================================================
// HH engine — R 3단계 "최종 통일본"(hh_rates, exp_gate, solve_tree_voltage,
// simulate_file)을 JavaScript로 옮긴 것. 계산 순서와 기본값은 R과 동일하다.
// 방법: 게이팅 = 지수 오일러, 막전위 = 후진 오일러(트리 선형계 직접 풀이).
// 비교용으로 고전 RK4(명시적) 풀이도 함께 제공한다.
// ============================================================================
(function (root) {
  const HH = {
    DT_MS: 0.01, TOTAL_TIME_MS: 20, STIM_START_MS: 2, STIM_END_MS: 5,
    STIM_DENSITY_UA_CM2: 20, MAX_ABS_V_MV: 200,
    CM_UF_CM2: 1.0, RA_OHM_CM: 150.0, GNA_MS_CM2: 120.0, GK_MS_CM2: 36.0, GL_MS_CM2: 0.3,
    ENA_MV: 50.0, EK_MV: -77.0, EL_MV: -54.4, VREST_MV: -65.0,
  };

  // x/(1-exp(-x/y)) 의 x=0 근처 제거 가능한 특이점 처리
  function vtrap(x, y) {
    const z = x / y;
    if (Math.abs(z) < 1e-6) return y * (1 + z / 2 + z * z / 12);
    return x / (-Math.expm1(-z));
  }
  function rates(v) {
    return {
      am: 0.1 * vtrap(v + 40, 10), bm: 4 * Math.exp(-(v + 65) / 18),
      ah: 0.07 * Math.exp(-(v + 65) / 20), bh: 1 / (1 + Math.exp(-(v + 35) / 10)),
      an: 0.01 * vtrap(v + 55, 10), bn: 0.125 * Math.exp(-(v + 65) / 80),
    };
  }
  // x(t+dt) = x_inf + (x - x_inf) * exp(-dt*(a+b))
  function expGate(x, a, b, dt) {
    const s = a + b;
    if (!Number.isFinite(s) || s <= 0) throw new Error('게이팅 속도 비정상');
    const xi = a / s;
    const out = xi + (x - xi) * Math.exp(-dt * s);
    return Math.min(1, Math.max(0, out));
  }

  // 회로 준비: 면적·용량·전도도, 위상 순서, 자극/근위 지점 (R과 같은 선택 규칙)
  function prepare(n, opt) {
    const N = n.N, P = Object.assign({}, HH, opt || {});
    const area = new Float64Array(N), C = new Float64Array(N), gnaMax = new Float64Array(N), gkMax = new Float64Array(N), gl = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const rc = n.r[i] * 1e-4, lc = n.effLen[i] * 1e-4;
      area[i] = 2 * Math.PI * rc * lc;
      C[i] = P.CM_UF_CM2 * area[i];
      gnaMax[i] = P.GNA_MS_CM2 * area[i]; gkMax[i] = P.GK_MS_CM2 * area[i]; gl[i] = P.GL_MS_CM2 * area[i];
    }
    const edgeG = new Float64Array(N);
    for (let i = 0; i < N; i++) if (n.parent[i] >= 0) {
      const rc = n.r[i] * 1e-4, lc = n.effLen[i] * 1e-4;
      edgeG[i] = 1000 / (P.RA_OHM_CM * lc / (Math.PI * rc * rc)); // mS
    }
    // R: root 순서대로 BFS, 자식은 번호 순
    const topo = new Int32Array(N); let used = 0;
    for (const r of n.roots) topo[used++] = r;
    for (let at = 0; at < used; at++) for (const c of n.children[topo[at]]) topo[used++] = c;
    if (used !== N) throw new Error('연결 구조에 순환/누락이 있습니다');
    // 경로 길이(계산용 길이 누적)와 소속 root
    const rootOf = new Int32Array(N), pathLen = new Float64Array(N);
    for (let k = 0; k < N; k++) { const i = topo[k], p = n.parent[i]; if (p < 0) { rootOf[i] = i; pathLen[i] = 0; } else { rootOf[i] = rootOf[p]; pathLen[i] = pathLen[p] + n.effLen[i]; } }
    const count = new Map(); for (let i = 0; i < N; i++) count.set(rootOf[i], (count.get(rootOf[i]) || 0) + 1);
    const soma = n.roots.filter(r => n.type[r] === 1);
    const pool = soma.length ? soma : n.roots;
    let chosen = pool[0]; for (const r of pool) if (count.get(r) > count.get(chosen)) chosen = r;
    let autoStim = -1;
    for (let i = 0; i < N; i++) if (rootOf[i] === chosen && n.childCount[i] === 0 && (autoStim < 0 || pathLen[i] > pathLen[autoStim])) autoStim = i;
    return { N, P, area, C, gnaMax, gkMax, gl, edgeG, topo, rootOf, pathLen, chosenRoot: chosen, proximalKind: soma.length ? 'soma_type1_root' : 'root_proxy_not_confirmed_soma', autoStim, parent: n.parent, roots: n.roots };
  }

  // 안정 트리 해법 (R solve_tree_voltage와 같은 순서)
  function solveTree(base, rhs, parent, edgeG, topo, roots, Y, B, V) {
    const N = base.length;
    for (let i = 0; i < N; i++) { Y[i] = base[i]; B[i] = rhs[i]; }
    for (let k = N - 1; k >= 0; k--) {
      const ii = topo[k], p = parent[ii];
      if (p < 0) continue;
      const g = edgeG[ii], den = g + Y[ii];
      const fr = g / den;
      Y[p] = Y[p] + fr * Y[ii];
      B[p] = B[p] + fr * B[ii];
    }
    for (const r of roots) V[r] = B[r] / Y[r];
    for (let k = 0; k < N; k++) {
      const ii = topo[k], p = parent[ii];
      if (p < 0) continue;
      const g = edgeG[ii], den = g + Y[ii];
      V[ii] = (Y[ii] / den) * (B[ii] / Y[ii]) + (g / den) * V[p];
    }
  }

  // 게이팅 지수 오일러 + 전압 후진 오일러 (R 3단계와 동일)
  function simulate(n, opt) {
    const S = prepare(n, opt), P = S.P, N = S.N, dt = P.DT_MS;
    const steps = Math.ceil(P.TOTAL_TIME_MS / dt);
    const stim = (opt && opt.stimIdx >= 0) ? opt.stimIdx : S.autoStim;
    const prox = (opt && opt.proxIdx >= 0) ? opt.proxIdx : S.chosenRoot;
    if (stim < 0) throw new Error('자극할 말단 노드가 없습니다');
    const rec = (opt && opt.recordEvery) || 1, nRec = Math.floor(steps / rec) + 1;
    const Vr = new Float32Array(nRec * N), Mr = new Float32Array(nRec * N), Hr = new Float32Array(nRec * N), Nr = new Float32Array(nRec * N), T = new Float64Array(nRec);
    let V = new Float64Array(N).fill(P.VREST_MV);
    const r0 = rates(P.VREST_MV);
    const m = new Float64Array(N).fill(r0.am / (r0.am + r0.bm)), h = new Float64Array(N).fill(r0.ah / (r0.ah + r0.bh)), ng = new Float64Array(N).fill(r0.an / (r0.an + r0.bn));
    const base = new Float64Array(N), rhs = new Float64Array(N), Y = new Float64Array(N), B = new Float64Array(N), Vn = new Float64Array(N);
    const peak = new Float64Array(N), minD = new Float64Array(N), peakT = new Float64Array(N);
    // 자극 전류(µA): 기본은 R과 같이 밀도×자극 노드 면적, stimCurrentUA를 주면 고정 전류
    const stimI = (opt && Number.isFinite(opt.stimCurrentUA)) ? opt.stimCurrentUA : P.STIM_DENSITY_UA_CM2 * S.area[stim];
    const save = (k, t) => { T[k] = t; const o = k * N; for (let i = 0; i < N; i++) { Vr[o + i] = V[i]; Mr[o + i] = m[i]; Hr[o + i] = h[i]; Nr[o + i] = ng[i]; } };
    save(0, 0);
    for (let s = 1; s <= steps; s++) {
      const t = (s - 1) * dt;
      const on = t >= P.STIM_START_MS && t < P.STIM_END_MS;
      for (let i = 0; i < N; i++) {
        const v = V[i];
        if (!Number.isFinite(v)) throw new Error('막전위에 NaN/Inf 발생');
        const rr = rates(v);
        m[i] = expGate(m[i], rr.am, rr.bm, dt); h[i] = expGate(h[i], rr.ah, rr.bh, dt); ng[i] = expGate(ng[i], rr.an, rr.bn, dt);
        const gna = S.gnaMax[i] * Math.pow(m[i], 3) * h[i], gk = S.gkMax[i] * Math.pow(ng[i], 4), gt = gna + gk + S.gl[i];
        base[i] = (S.C[i] / dt) + gt;
        rhs[i] = (S.C[i] / dt) * v + gna * P.ENA_MV + gk * P.EK_MV + S.gl[i] * P.EL_MV + ((on && i === stim) ? stimI : 0);
      }
      solveTree(base, rhs, S.parent, S.edgeG, S.topo, S.roots, Y, B, Vn);
      for (let i = 0; i < N; i++) {
        const v = Vn[i];
        if (!Number.isFinite(v) || Math.abs(v) > P.MAX_ABS_V_MV) throw new Error(`전압 발산/비유한값: t=${(t + dt).toFixed(4)} ms`);
        V[i] = v;
        const d = v - P.VREST_MV;
        if (d > peak[i]) { peak[i] = d; peakT[i] = t + dt; }
        if (d < minD[i]) minD[i] = d;
      }
      if (s % rec === 0) save(s / rec, t + dt);
    }
    const sp = peak[stim], pp = peak[prox];
    return { method: 'expEuler', S, N, steps, dt, nRec, T, V: Vr, m: Mr, h: Hr, n: Nr, peak, minD, peakT, stim, prox, stimI, ratio: sp > 1e-9 ? pp / sp : NaN };
  }

  // 비교용: 명시적 고전 RK4 (전체 연립 ODE). 발산하면 그 시각을 보고한다.
  function simulateRK4(n, opt) {
    const S = prepare(n, opt), P = S.P, N = S.N, dt = P.DT_MS;
    const tEnd = Math.min(P.TOTAL_TIME_MS, (opt && opt.rk4MaxTime) || P.TOTAL_TIME_MS);
    const steps = Math.ceil(tEnd / dt);
    const stim = (opt && opt.stimIdx >= 0) ? opt.stimIdx : S.autoStim;
    const prox = (opt && opt.proxIdx >= 0) ? opt.proxIdx : S.chosenRoot;
    const stimI = (opt && Number.isFinite(opt.stimCurrentUA)) ? opt.stimCurrentUA : P.STIM_DENSITY_UA_CM2 * S.area[stim];
    const maxRec = 2001, rec = Math.max(1, Math.ceil(steps / (maxRec - 1)));
    const y = new Float64Array(4 * N);
    const r0 = rates(P.VREST_MV);
    for (let i = 0; i < N; i++) { y[i] = P.VREST_MV; y[N + i] = r0.am / (r0.am + r0.bm); y[2 * N + i] = r0.ah / (r0.ah + r0.bh); y[3 * N + i] = r0.an / (r0.an + r0.bn); }
    const f = (t, Y, out) => {
      const on = t >= P.STIM_START_MS && t < P.STIM_END_MS;
      for (let i = 0; i < N; i++) {
        const v = Y[i], mm = Y[N + i], hh = Y[2 * N + i], nn = Y[3 * N + i], rr = rates(v);
        const Iion = S.gnaMax[i] * mm * mm * mm * hh * (v - P.ENA_MV) + S.gkMax[i] * nn * nn * nn * nn * (v - P.EK_MV) + S.gl[i] * (v - P.EL_MV);
        out[i] = (((on && i === stim) ? stimI : 0) - Iion);
        out[N + i] = rr.am * (1 - mm) - rr.bm * mm; out[2 * N + i] = rr.ah * (1 - hh) - rr.bh * hh; out[3 * N + i] = rr.an * (1 - nn) - rr.bn * nn;
      }
      for (let i = 0; i < N; i++) { const p = S.parent[i]; if (p < 0) continue; const I = S.edgeG[i] * (Y[p] - Y[i]); out[i] += I; out[p] -= I; }
      for (let i = 0; i < N; i++) out[i] /= S.C[i];
    };
    const k1 = new Float64Array(4 * N), k2 = new Float64Array(4 * N), k3 = new Float64Array(4 * N), k4 = new Float64Array(4 * N), tmp = new Float64Array(4 * N);
    const Tr = [0], Vs = [y[stim]], Vp = [y[prox]];
    let diverged = null;
    for (let s = 1; s <= steps; s++) {
      const t = (s - 1) * dt;
      f(t, y, k1);
      for (let j = 0; j < y.length; j++) tmp[j] = y[j] + dt / 2 * k1[j]; f(t + dt / 2, tmp, k2);
      for (let j = 0; j < y.length; j++) tmp[j] = y[j] + dt / 2 * k2[j]; f(t + dt / 2, tmp, k3);
      for (let j = 0; j < y.length; j++) tmp[j] = y[j] + dt * k3[j]; f(t + dt, tmp, k4);
      let bad = false;
      for (let j = 0; j < y.length; j++) { y[j] += dt / 6 * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]); if (j < N && (!Number.isFinite(y[j]) || Math.abs(y[j]) > 1e4)) bad = true; }
      if (bad) { diverged = { t: t + dt, step: s }; break; }
      if (s % rec === 0) { Tr.push(t + dt); Vs.push(y[stim]); Vp.push(y[prox]); }
    }
    return { method: 'rk4', dt, steps, tEnd, diverged, T: Tr, Vstim: Vs, Vprox: Vp, stim, prox };
  }

  // RK4가 안정하려면 필요한 시간 간격 추정 (Gershgorin 상한, RK4 실축 안정 한계 2.785)
  function rk4StableDt(n, opt) {
    const S = prepare(n, opt), N = S.N, ax = new Float64Array(N);
    for (let i = 0; i < N; i++) { const p = S.parent[i]; if (p >= 0) { ax[i] += S.edgeG[i]; ax[p] += S.edgeG[i]; } }
    let lam = 0;
    for (let i = 0; i < N; i++) lam = Math.max(lam, 2 * (ax[i] + S.gnaMax[i] + S.gkMax[i] + S.gl[i]) / S.C[i]);
    return 2.785 / lam;
  }

  const api = { HH, rates, vtrap, expGate, prepare, simulate, simulateRK4, rk4StableDt };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NeuronHH = api;
})(typeof window !== 'undefined' ? window : globalThis);
