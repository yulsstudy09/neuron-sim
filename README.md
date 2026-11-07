# CA1 뉴런 시뮬레이터

2026 포항제철고 수리과학 심포지엄(SCI-Math) — 「뉴런의 모양이 바뀌면 전기 신호도 약해질까?」 팀 프로젝트용 웹 시뮬레이터

**사이트:** https://yulsstudy09.github.io/neuron-sim/

## 현재 기능 (1·2단계)
- Zhang et al.(2020) 해마 CA1 SWC 149개(WT/AD × 6/12개월)를 3D로 보기, 다른 SWC 불러오기
- 노드를 클릭하면 좌표, 반지름, 구간·가지 길이와 막면적, 막용량, 축저항, gNa/gK/gL 표시
- 팀 R 코드(1·2단계 v3)의 보정 규칙을 그대로 적용: 반지름 0 → 0.1 µm, 길이 0 → 0.35 µm, 비정상 반지름 → 이웃 중앙값. 원본 값은 따로 보관
- 검증: 149개 전부 팀의 `_parameters.csv`와 일치 (최대 상대오차 5×10⁻¹⁵)

## 구조
- `index.html` — 배포용 단일 파일 (빌드 결과)
- `src/engine.js` — R 계산을 옮긴 계산 엔진, `src/app.html` — 화면
- `tools/build.js` — `node tools/build.js data` 로 index 생성 (`cp dist/neuron-sim.html index.html`)
- `tools/validate12.js` — R 결과 CSV와 비교 검증
- `data/` — 원본 SWC 149개

보정 기준과 고전 HH 상수는 기존 연구 결과를 재현하기 위한 탐색적 가정이며 생물학적 측정값이 아닙니다.
