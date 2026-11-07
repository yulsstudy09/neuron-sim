// ============================================================================
// Neuron engine — R 1·2단계 v3 코드(read_swc_safe, fix_invalid_radius,
// 길이/막면적/막용량/축저항 계산)를 JavaScript로 옮긴 것.
// 계산 순서와 규칙은 R 원본과 동일하게 유지한다. 원본 값은 변경하지 않는다.
// ============================================================================
(function (root) {
  const CFG = {
    R_ZERO_REPLACEMENT_UM: 0.1,
    R_INVALID_FALLBACK_UM: 0.175,
    ZERO_EDGE_EFFECTIVE_LENGTH_UM: 0.35,
    ROOT_LENGTH_UM: 1.0,
    CM_UF_PER_CM2: 1.0,
    RA_OHM_CM: 150.0,
    GNA_MS_PER_CM2: 120.0,
    GK_MS_PER_CM2: 36.0,
    GL_MS_PER_CM2: 0.3,
  };

  function median(a) {
    const s = a.slice().sort((x, y) => x - y);
    const n = s.length;
    if (!n) return NaN;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  }

  // R as.numeric과 같은 방식으로 숫자 토큰만 허용
  function asNumeric(tok) {
    const t = tok.trim();
    if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return parseFloat(t);
    if (/^[+-]?inf$/i.test(t)) return t[0] === '-' ? -Infinity : Infinity;
    return NaN; // NA
  }

  // ---- read_swc_safe ----
  function readSwcSafe(text) {
    const lines = text.split(/\r?\n/);
    const recs = [], bad = [], nan = new Set();
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i].trim();
      if (!raw || raw[0] === '#') continue;
      const toks = raw.split(/\s+/);
      if (toks.length !== 7) { bad.push(i + 1); continue; }
      // 6번째 반지름 열의 MSVC NaN 표기('-1.#QNAN0', '-1.#IND00')만 NA로 교체
      if (/^(\+|-)?[0-9]+\.#(QNAN|IND)/.test(toks[5].toUpperCase())) { toks[5] = 'NA'; nan.add(i + 1); }
      const v = toks.map(asNumeric);
      const req = [0, 1, 2, 3, 4, 6];
      if (req.some(k => !Number.isFinite(v[k]))) { bad.push(i + 1); continue; }
      if (!Number.isFinite(v[5])) { v[5] = NaN; nan.add(i + 1); }
      recs.push(v);
    }
    if (!recs.length) throw new Error('읽을 수 있는 SWC 행이 없습니다.');
    if (bad.length) throw new Error('정확히 7개 열이 아니거나 필수 값이 손상된 행: ' + bad.slice(0, 10).join(','));
    if (recs.some(v => v[0] !== Math.floor(v[0]) || v[6] !== Math.floor(v[6]))) throw new Error('id/pid 정수 형식 오류');
    return { recs, nanLines: [...nan] };
  }

  // ---- 전체 1·2단계 처리 (R 루프 본문과 동일) ----
  function processSwc(text, cfgOverride) {
    const { recs, nanLines } = readSwcSafe(text);
    const n = processRecords(recs, cfgOverride);
    n.nanLines = nanLines;
    return n;
  }

  // recs: [id,type,x,y,z,r원본,pid] 배열. rOverride: Map(id → 사용자가 지정한 계산용 반지름)
  function processRecords(recs, cfgOverride, rOverride) {
    const C = Object.assign({}, CFG, cfgOverride || {});
    const nanLines = [];
    const N = recs.length;
    const id = new Float64Array(N), type = new Int32Array(N), pid = new Float64Array(N);
    const x = new Float64Array(N), y = new Float64Array(N), z = new Float64Array(N);
    const rOrig = new Float64Array(N);
    recs.forEach((v, i) => { id[i] = v[0]; type[i] = v[1]; x[i] = v[2]; y[i] = v[3]; z[i] = v[4]; rOrig[i] = v[5]; pid[i] = v[6]; });

    const idx = new Map();
    for (let i = 0; i < N; i++) { if (idx.has(id[i])) throw new Error('SWC 파일 내 id 중복'); idx.set(id[i], i); }
    const roots = [], children = [];
    for (let i = 0; i < N; i++) (pid[i] === -1 ? roots : children).push(i);
    if (!roots.length) throw new Error('root 없음');
    if (!children.length) throw new Error('연결 edge 없음');
    const parent = new Int32Array(N).fill(-1);
    for (const c of children) {
      const p = idx.get(pid[c]);
      if (p === undefined) throw new Error('부모 노드 id 누락');
      if (p === c) throw new Error('자기 자신을 부모로 지정');
      parent[c] = p;
    }

    // 플래그
    const invalidOrig = new Uint8Array(N), wasZero = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      invalidOrig[i] = (!Number.isFinite(rOrig[i]) || rOrig[i] < 0) ? 1 : 0;
      wasZero[i] = (!invalidOrig[i] && rOrig[i] === 0) ? 1 : 0;
    }

    // ---- fix_invalid_radius ----
    const r = Float64Array.from(rOrig);
    const repairs = [];
    const invalid = [];
    for (let i = 0; i < N; i++) if (invalidOrig[i]) invalid.push(i);
    if (invalid.length) {
      const validAll = [];
      for (let i = 0; i < N; i++) if (Number.isFinite(rOrig[i]) && rOrig[i] > 0) validAll.push(rOrig[i]);
      const globalFallback = validAll.length ? median(validAll) : C.R_INVALID_FALLBACK_UM;
      const kids = Array.from({ length: N }, () => []);
      for (const c of children) kids[parent[c]].push(c);
      for (const i of invalid) {
        const near = [];
        // R: which(d$pid==d$id[i] | d$id==d$pid[i]) — 자식들과 부모
        for (let j = 0; j < N; j++) if (j !== i && (pid[j] === id[i] || id[j] === pid[i])) near.push(j);
        const nr = near.map(j => rOrig[j]).filter(v => Number.isFinite(v) && v > 0);
        let method;
        if (nr.length) { r[i] = median(nr); method = 'neighbor_median_positive_radius'; }
        else { r[i] = globalFallback; method = 'file_median_positive_radius_or_fallback'; }
        repairs.push({ node: id[i], repair: 'invalid_radius', original: 'NaN/IND/negative', replacement: r[i], method });
      }
    }
    for (let i = 0; i < N; i++) if (wasZero[i]) r[i] = C.R_ZERO_REPLACEMENT_UM;
    // 사용자 편집 반지름 (보정 이후에 덮어씀; 원본 값은 rOrig에 그대로)
    const rEdited = new Uint8Array(N);
    if (rOverride && rOverride.size) for (let i = 0; i < N; i++) {
      const v = rOverride.get(id[i]);
      if (v !== undefined && Number.isFinite(v) && v > 0) { r[i] = v; rEdited[i] = 1; }
    }

    const childCount = new Int32Array(N);
    for (const c of children) childCount[parent[c]]++;

    // 길이
    const geomLen = new Float64Array(N).fill(NaN);
    for (const c of children) {
      const p = parent[c];
      geomLen[c] = Math.sqrt((x[c] - x[p]) ** 2 + (y[c] - y[p]) ** 2 + (z[c] - z[p]) ** 2);
    }
    const effLen = Float64Array.from(geomLen);
    for (const rt of roots) effLen[rt] = C.ROOT_LENGTH_UM;
    const lenZero = new Uint8Array(N);
    for (const c of children) if (geomLen[c] === 0) { lenZero[c] = 1; effLen[c] = C.ZERO_EDGE_EFFECTIVE_LENGTH_UM; }
    for (let i = 0; i < N; i++) if (!Number.isFinite(effLen[i]) || effLen[i] <= 0) throw new Error('계산용 구획 길이 오류');
    for (let i = 0; i < N; i++) if (lenZero[i]) repairs.push({ node: id[i], repair: 'zero_length_edge', original: '0 um', replacement: effLen[i], method: 'effective_length_only_keep_xyz_pid' });

    // 전기적 파라미터 (cm 단위, R과 동일)
    const area = new Float64Array(N), cap = new Float64Array(N), Ra = new Float64Array(N);
    const gNa = new Float64Array(N), gK = new Float64Array(N), gL = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const rc = r[i] * 1e-4, lc = effLen[i] * 1e-4;
      area[i] = 2 * Math.PI * rc * lc;
      cap[i] = C.CM_UF_PER_CM2 * area[i];
      Ra[i] = C.RA_OHM_CM * lc / (Math.PI * rc * rc);
      gNa[i] = C.GNA_MS_PER_CM2 * area[i];
      gK[i] = C.GK_MS_PER_CM2 * area[i];
      gL[i] = C.GL_MS_PER_CM2 * area[i];
      if (![area[i], cap[i], Ra[i], gNa[i]].every(Number.isFinite)) throw new Error('전기적 매개변수 계산 오류');
    }

    // 연결 성분(다중 root) — 시각화/요약용
    const comp = new Int32Array(N).fill(-1);
    const order = [];
    const kids2 = Array.from({ length: N }, () => []);
    for (const c of children) kids2[parent[c]].push(c);
    roots.forEach((rt, k) => {
      const st = [rt];
      while (st.length) { const u = st.pop(); comp[u] = k; order.push(u); for (const v of kids2[u]) st.push(v); }
    });
    if (order.length !== N) throw new Error('연결 구조에 순환/누락이 있습니다');

    return {
      N, id, type, x, y, z, pid, parent, roots, children: kids2, comp,
      rOrig, r, rEdited, invalidOrig, wasZero, childCount, geomLen, effLen, lenZero,
      area, cap, Ra, gNa, gK, gL, repairs, nanLines, cfg: C,
    };
  }

  // R의 _parameters.csv와 같은 열 구성으로 내보내기
  const PARAM_COLS = ['id', 'type', 'x', 'y', 'z', 'r', 'pid', 'radius_original_um', 'radius_invalid_original', 'radius_was_zero', 'child_count', 'is_bifurcation', 'is_terminal', 'geometric_length_um', 'length_was_zero', 'effective_length_um', 'length_i', 'surface_area', 'capacitance', 'axial_resistance', 'g_Na_max', 'g_K_max', 'g_L_max'];
  function rowValues(n, i) {
    const B = v => (v ? 'TRUE' : 'FALSE');
    const F = v => (Number.isFinite(v) ? String(v) : 'NA');
    return [n.id[i], n.type[i], n.x[i], n.y[i], n.z[i], F(n.r[i]), n.pid[i], F(n.rOrig[i]), B(n.invalidOrig[i]), B(n.wasZero[i]), n.childCount[i], B(n.childCount[i] >= 2), B(n.childCount[i] === 0), F(n.geomLen[i]), B(n.lenZero[i]), n.effLen[i], n.effLen[i], n.area[i], n.cap[i], n.Ra[i], n.gNa[i], n.gK[i], n.gL[i]];
  }
  function toParamsCsv(n) {
    const out = [PARAM_COLS.map(c => '"' + c + '"').join(',')];
    for (let i = 0; i < n.N; i++) out.push(rowValues(n, i).join(','));
    return out.join('\n');
  }

  const api = { CFG, readSwcSafe, processSwc, processRecords, toParamsCsv, PARAM_COLS, rowValues, median };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NeuronEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
