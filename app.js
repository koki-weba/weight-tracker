/* =====================================================
   体重管理アプリ - メインロジック
   ===================================================== */

(() => {
  "use strict";

  // -----------------------------
  // 定数 & ストレージキー
  // -----------------------------
  const STORAGE_KEY = "weightTrackerData_v1";
  const THEME_KEY = "weightTrackerTheme";

  const DEFAULT_DATA = {
    settings: {
      height: null,
      startWeight: null,
      targetWeight: null,
      targetDate: null,
      dailyCalGoal: 2000,
    },
    records: {}, // { 'YYYY-MM-DD': { weight, dailyCalories } }
    exercises: [], // [{ id, name, muscle }]
    workouts: [], // [{ id, date, entries: [{ exerciseId, sets: [{ weight, reps }] }] }]
  };

  const MUSCLE_LABELS = {
    chest: "胸",
    back: "背中",
    legs: "脚",
    shoulders: "肩",
    arms: "腕",
    core: "体幹",
    other: "その他",
  };

  const SEED_EXERCISES = [
    { id: "ex_bench", name: "ベンチプレス", muscle: "chest" },
    { id: "ex_squat", name: "スクワット", muscle: "legs" },
    { id: "ex_deadlift", name: "デッドリフト", muscle: "back" },
    { id: "ex_ohp", name: "ショルダープレス", muscle: "shoulders" },
    { id: "ex_row", name: "ベントオーバーロウ", muscle: "back" },
    { id: "ex_curl", name: "アームカール", muscle: "arms" },
  ];

  const WEEKLY_AVG_MIN_RANGE = 30;

  // -----------------------------
  // ユーティリティ
  // -----------------------------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const pad = (n) => String(n).padStart(2, "0");

  // モーション設定
  const prefersReducedMotion = () =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // -----------------------------
  // 数値カウントアップアニメ
  // -----------------------------
  const _numCache = new WeakMap();
  function animateNumber(el, to, opts = {}) {
    if (!el) return;
    const {
      duration = 600,
      decimals = 0,
      prefix = "",
      suffix = "",
      formatter = null,
      thousands = true,
    } = opts;
    const targetVal = Number(to);
    if (isNaN(targetVal)) {
      el.textContent = prefix + (to ?? "") + suffix;
      return;
    }
    const from = _numCache.get(el) ?? 0;
    _numCache.set(el, targetVal);
    if (prefersReducedMotion()) {
      el.textContent = formatter ? formatter(targetVal) : formatNum(targetVal, decimals, thousands, prefix, suffix);
      return;
    }
    if (Math.abs(targetVal - from) < 0.01 && el.textContent) {
      el.textContent = formatter ? formatter(targetVal) : formatNum(targetVal, decimals, thousands, prefix, suffix);
      return;
    }
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      const val = from + (targetVal - from) * eased;
      el.textContent = formatter ? formatter(val) : formatNum(val, decimals, thousands, prefix, suffix);
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  function formatNum(v, decimals, thousands, prefix, suffix) {
    let s = decimals > 0 ? v.toFixed(decimals) : Math.round(v).toString();
    if (thousands) {
      const parts = s.split(".");
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      s = parts.join(".");
    }
    return prefix + s + suffix;
  }

  // -----------------------------
  // リップル効果
  // -----------------------------
  function attachRipples() {
    const targets = ".btn, .quick-btn, .nav-btn, .seg-btn";
    document.body.addEventListener("pointerdown", (e) => {
      const el = e.target.closest(targets);
      if (!el || el.disabled) return;
      if (prefersReducedMotion()) return;
      const rect = el.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height) * 1.2;
      const ripple = document.createElement("span");
      ripple.className = "ripple";
      ripple.style.width = ripple.style.height = size + "px";
      ripple.style.left = (e.clientX - rect.left - size / 2) + "px";
      ripple.style.top = (e.clientY - rect.top - size / 2) + "px";
      el.appendChild(ripple);
      setTimeout(() => ripple.remove(), 600);
    }, { passive: true });
  }

  function formatDate(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function formatJpDate(s) {
    if (!s) return "--";
    const [y, m, d] = s.split("-");
    return `${parseInt(m)}月${parseInt(d)}日`;
  }
  function todayStr() {
    return formatDate(new Date());
  }
  function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }
  // 月曜始まりの週
  function startOfWeek(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay();
    const diff = (day === 0 ? -6 : 1) - day;
    d.setDate(d.getDate() + diff);
    return d;
  }
  function getWeekDates(date) {
    const start = startOfWeek(date);
    return Array.from({ length: 7 }, (_, i) => formatDate(addDays(start, i)));
  }
  function daysUntil(dateStr) {
    if (!dateStr) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(dateStr + "T00:00:00");
    return Math.round((target - today) / 86400000);
  }

  // -----------------------------
  // ストア
  // -----------------------------
  function normalizeRecord(rec) {
    if (!rec) return { weight: null, dailyCalories: null };
    let dailyCalories =
      rec.dailyCalories != null && rec.dailyCalories !== ""
        ? Number(rec.dailyCalories)
        : null;
    if ((dailyCalories == null || isNaN(dailyCalories)) && rec.meals?.length) {
      dailyCalories = rec.meals.reduce((s, m) => s + (Number(m.kcal) || 0), 0);
    }
    if (dailyCalories != null && isNaN(dailyCalories)) dailyCalories = null;
    const weight =
      rec.weight != null && rec.weight !== "" ? Number(rec.weight) : null;
    return { weight, dailyCalories };
  }

  function normalizeRecords(records) {
    const out = {};
    for (const [date, rec] of Object.entries(records || {})) {
      out[date] = normalizeRecord(rec);
    }
    return out;
  }

  function uid(prefix = "id") {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function normalizeExercise(ex) {
    if (!ex || !ex.name) return null;
    const muscle = MUSCLE_LABELS[ex.muscle] ? ex.muscle : "other";
    return {
      id: ex.id || uid("ex"),
      name: String(ex.name).trim().slice(0, 40),
      muscle,
    };
  }

  function normalizeExercises(list) {
    const out = [];
    const seen = new Set();
    for (const ex of list || []) {
      const n = normalizeExercise(ex);
      if (!n || seen.has(n.id)) continue;
      seen.add(n.id);
      out.push(n);
    }
    return out;
  }

  function normalizeSet(set) {
    if (!set) return null;
    const weight = Number(set.weight);
    const reps = parseInt(set.reps, 10);
    if (isNaN(weight) || weight < 0 || isNaN(reps) || reps <= 0) return null;
    return { weight: +weight.toFixed(1), reps };
  }

  function normalizeWorkout(w) {
    if (!w || !w.date) return null;
    const entries = [];
    for (const entry of w.entries || []) {
      if (!entry?.exerciseId) continue;
      const sets = (entry.sets || []).map(normalizeSet).filter(Boolean);
      entries.push({ exerciseId: entry.exerciseId, sets });
    }
    return {
      id: w.id || uid("wo"),
      date: w.date,
      note: w.note ? String(w.note).slice(0, 200) : "",
      entries,
    };
  }

  function normalizeWorkouts(list) {
    return (list || []).map(normalizeWorkout).filter(Boolean);
  }

  function hydrateState(parsed) {
    let exercises = normalizeExercises(parsed.exercises);
    if (!exercises.length) exercises = structuredClone(SEED_EXERCISES);
    return {
      settings: { ...DEFAULT_DATA.settings, ...(parsed.settings || {}) },
      records: normalizeRecords(parsed.records),
      exercises,
      workouts: normalizeWorkouts(parsed.workouts),
    };
  }

  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        const data = structuredClone(DEFAULT_DATA);
        data.exercises = structuredClone(SEED_EXERCISES);
        return data;
      }
      return hydrateState(JSON.parse(raw));
    } catch (e) {
      console.warn("data load error", e);
      const data = structuredClone(DEFAULT_DATA);
      data.exercises = structuredClone(SEED_EXERCISES);
      return data;
    }
  }
  function saveData() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn("save error", e);
      throw new Error("データの保存に失敗しました（ストレージ容量不足の可能性）");
    }
  }

  let state = loadData();

  // -----------------------------
  // テーマ
  // -----------------------------
  function applyTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    localStorage.setItem(THEME_KEY, t);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", t === "dark" ? "#0d1117" : "#6366f1");
    setTimeout(() => updateCharts(), 60);
  }
  function initTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved) {
      applyTheme(saved);
    } else {
      const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      applyTheme(dark ? "dark" : "light");
    }
  }

  // -----------------------------
  // トースト
  // -----------------------------
  let toastTimer;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2400);
  }

  // -----------------------------
  // ナビゲーション
  // -----------------------------
  const PAGE_TITLES = {
    home: { title: "ホーム", subtitle: "今日の状態を確認しましょう" },
    record: { title: "記録", subtitle: "体重と摂取カロリーを記録しましょう" },
    train: { title: "筋トレ", subtitle: "種目・重量・回数を記録しましょう" },
    graph: { title: "グラフ", subtitle: "推移を可視化して確認" },
    settings: { title: "設定", subtitle: "目標と身体情報の設定" },
  };

  let currentView = "home";
  function switchView(target) {
    if (target === currentView) return;
    currentView = target;
    $$(".view").forEach((v) => {
      const isActive = v.dataset.view === target;
      // active クラスを付け直すことでスタガー入場アニメを再生
      if (isActive) {
        v.classList.remove("active");
        // 強制リフロー(アニメ再起動)
        // eslint-disable-next-line no-unused-expressions
        v.offsetWidth;
        v.classList.add("active");
      } else {
        v.classList.remove("active");
      }
    });
    $$(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.target === target));
    const meta = PAGE_TITLES[target];
    if (meta) {
      $("#page-title").textContent = meta.title;
      $("#page-subtitle").textContent = meta.subtitle;
    }
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
    if (target === "graph") setTimeout(updateCharts, 80);
    if (target === "train") renderTrainView();
  }

  // -----------------------------
  // 計算ヘルパ
  // -----------------------------
  function getRecord(date) {
    return state.records[date] || { weight: null, dailyCalories: null };
  }
  function ensureRecord(date) {
    if (!state.records[date]) state.records[date] = { weight: null, dailyCalories: null };
    return state.records[date];
  }
  function dayCalories(date) {
    const r = state.records[date];
    if (!r) return 0;
    if (r.dailyCalories != null) return Number(r.dailyCalories) || 0;
    if (r.meals?.length) {
      return r.meals.reduce((s, m) => s + (Number(m.kcal) || 0), 0);
    }
    return 0;
  }
  function getLatestWeight(beforeDate) {
    const dates = Object.keys(state.records).sort();
    for (let i = dates.length - 1; i >= 0; i--) {
      if (beforeDate && dates[i] > beforeDate) continue;
      const w = state.records[dates[i]].weight;
      if (w != null && w !== "") return { date: dates[i], weight: Number(w) };
    }
    return null;
  }
  // 目標達成度 (0-100)
  function goalProgress() {
    const target = state.settings.targetWeight;
    const start = state.settings.startWeight;
    const latest = getLatestWeight();
    if (target == null || start == null || !latest) return null;
    const total = start - target; // 減らす場合 +、増やす場合 -
    if (total === 0) return 100;
    const done = start - latest.weight;
    let pct = (done / total) * 100;
    pct = Math.max(0, Math.min(100, pct));
    return pct;
  }

  // -----------------------------
  // ホーム描画
  // -----------------------------
  function renderHome() {
    const today = todayStr();
    $("#todayDateText").textContent = formatJpDate(today);

    const todayRec = getRecord(today);
    $("#todayWeight").textContent = todayRec.weight != null ? `${todayRec.weight} kg` : "未入力";
    const cal = dayCalories(today);
    animateNumber($("#todayCal"), cal, { suffix: " kcal" });

    // ヒーロー (目標達成度)
    const target = state.settings.targetWeight;
    const latest = getLatestWeight();
    const pct = goalProgress();

    $("#currentWeightStat").textContent = latest ? `${latest.weight} kg` : "-- kg";
    $("#targetWeightStat").textContent = target != null ? `${target} kg` : "-- kg";

    if (latest && target != null) {
      const diff = (latest.weight - target).toFixed(1);
      const sign = diff > 0 ? "+" : "";
      $("#diffWeightStat").textContent = `${sign}${diff} kg`;
    } else {
      $("#diffWeightStat").textContent = "-- kg";
    }

    if (pct != null) {
      const r = Math.round(pct);
      animateNumber($("#goalProgressText"), r, { suffix: "%", duration: 800 });
      animateNumber($("#ringPercent"), r, { duration: 800 });
      const circumference = 2 * Math.PI * 52;
      $("#ringFg").setAttribute("stroke-dasharray", circumference);
      animateAttr($("#ringFg"), "stroke-dashoffset",
        circumference - (circumference * pct) / 100, { duration: 900 });
      if (r >= 100) {
        $("#goalProgressSub").textContent = "目標達成しました！おめでとうございます";
      } else {
        const remain = (latest.weight - target).toFixed(1);
        $("#goalProgressSub").textContent = `あと ${Math.abs(remain)} kg で目標達成`;
      }
    } else {
      $("#goalProgressText").textContent = "--%";
      $("#ringPercent").textContent = 0;
      const c = 2 * Math.PI * 52;
      $("#ringFg").setAttribute("stroke-dasharray", c);
      $("#ringFg").setAttribute("stroke-dashoffset", c);
      $("#goalProgressSub").textContent = state.settings.targetWeight == null
        ? "設定タブから目標体重を設定してください"
        : "体重を記録すると達成度が表示されます";
    }

    const countdownEl = $("#goalCountdown");
    const targetDate = state.settings.targetDate;
    const daysLeft = daysUntil(targetDate);
    if (targetDate && daysLeft != null) {
      const dateLabel = formatJpDate(targetDate);
      countdownEl.hidden = false;
      countdownEl.classList.toggle("is-overdue", daysLeft < 0);
      countdownEl.classList.toggle("is-today", daysLeft === 0);
      if (daysLeft > 0) {
        $("#goalCountdownNum").textContent = daysLeft;
        $("#goalCountdownDesc").textContent = `日（${dateLabel}まで）`;
      } else if (daysLeft === 0) {
        $("#goalCountdownNum").textContent = "0";
        $("#goalCountdownDesc").textContent = `日 — 今日が目標日（${dateLabel}）`;
      } else {
        $("#goalCountdownNum").textContent = Math.abs(daysLeft);
        $("#goalCountdownDesc").textContent = `日経過（${dateLabel}）`;
      }
    } else {
      countdownEl.hidden = true;
    }

    renderWeekCalories();
  }

  // 属性のアニメーション (SVG用)
  const _attrCache = new WeakMap();
  function animateAttr(el, attr, to, opts = {}) {
    if (!el) return;
    const { duration = 600 } = opts;
    const fromMap = _attrCache.get(el) || {};
    const from = fromMap[attr] ?? (parseFloat(el.getAttribute(attr)) || 0);
    const target = Number(to);
    fromMap[attr] = target;
    _attrCache.set(el, fromMap);
    if (prefersReducedMotion()) {
      el.setAttribute(attr, target);
      return;
    }
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      el.setAttribute(attr, from + (target - from) * eased);
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function renderWeekCalories() {
    const dates = getWeekDates(new Date());
    const dailyGoal = state.settings.dailyCalGoal || 0;
    const weekBudget = dailyGoal * 7;

    let consumed = 0;
    const dayLabels = ["月", "火", "水", "木", "金", "土", "日"];
    const today = todayStr();
    const container = $("#calorieDays");
    container.innerHTML = "";

    dates.forEach((d, i) => {
      const cal = dayCalories(d);
      consumed += cal;
      const cell = document.createElement("div");
      const isToday = d === today;
      const isFuture = d > today;
      let cls = "day-cell";
      if (isToday) cls += " today";
      if (isFuture) cls += " future";
      if (!isFuture && dailyGoal > 0 && cal > 0) {
        cls += cal > dailyGoal ? " over" : " good";
      }
      cell.className = cls;
      cell.innerHTML = `<div class="d-name">${dayLabels[i]}</div><div class="d-cal">${cal > 0 ? cal : "·"}</div>`;
      container.appendChild(cell);
    });

    const remain = weekBudget - consumed;
    animateNumber($("#consumedCalText"), consumed);
    animateNumber($("#budgetCalText"), weekBudget);
    animateNumber($("#remainCalText"), remain);
    const remainEl = $("#remainCalText").parentElement;
    remainEl.classList.toggle("over", remain < 0);

    const ratio = weekBudget > 0 ? Math.min((consumed / weekBudget) * 100, 100) : 0;
    const bar = $("#calorieBarFill");
    bar.style.width = ratio + "%";
    bar.classList.toggle("over", consumed > weekBudget);

    // 週レンジ
    const first = formatJpDate(dates[0]);
    const last = formatJpDate(dates[6]);
    $("#weekRangeBadge").textContent = `${first} - ${last}`;
  }

  // -----------------------------
  // 記録ページ
  // -----------------------------
  function initRecordView() {
    const dateInput = $("#recordDate");
    dateInput.value = todayStr();
    dateInput.addEventListener("change", () => renderRecordView());

    $("#saveWeightBtn").addEventListener("click", () => {
      const date = dateInput.value || todayStr();
      const weight = parseFloat($("#inputWeight").value);
      if (isNaN(weight)) {
        toast("体重を入力してください");
        return;
      }
      const rec = ensureRecord(date);
      rec.weight = +weight.toFixed(1);
      saveData();
      renderAll();
      toast(`${formatJpDate(date)}の体重を保存しました`);
    });

    $("#saveCalBtn").addEventListener("click", () => {
      const date = dateInput.value || todayStr();
      const kcal = parseInt($("#inputDailyCal").value, 10);
      if (isNaN(kcal) || kcal < 0) {
        toast("摂取カロリーを入力してください");
        return;
      }
      const rec = ensureRecord(date);
      rec.dailyCalories = kcal;
      saveData();
      renderAll();
      toast(`${formatJpDate(date)}の摂取カロリー（${kcal.toLocaleString()} kcal）を保存しました`);
    });
  }

  function renderRecordView() {
    const date = $("#recordDate").value || todayStr();
    const rec = getRecord(date);
    $("#inputWeight").value = rec.weight != null ? rec.weight : "";
    const cal = dayCalories(date);
    $("#inputDailyCal").value = cal > 0 || rec.dailyCalories != null ? cal : "";
  }

  // -----------------------------
  // 筋トレヘルパ
  // -----------------------------
  function getExercise(id) {
    return state.exercises.find((e) => e.id === id) || null;
  }

  function estimate1RM(weight, reps) {
    const w = Number(weight);
    const r = parseInt(reps, 10);
    if (isNaN(w) || w <= 0 || isNaN(r) || r <= 0) return null;
    if (r === 1) return +w.toFixed(1);
    // Epley: w * (1 + r/30)
    return +((w * (1 + r / 30))).toFixed(1);
  }

  function setVolume(set) {
    return (Number(set.weight) || 0) * (Number(set.reps) || 0);
  }

  function entryVolume(entry) {
    return (entry.sets || []).reduce((s, set) => s + setVolume(set), 0);
  }

  function workoutVolume(workout) {
    if (!workout) return 0;
    return (workout.entries || []).reduce((s, e) => s + entryVolume(e), 0);
  }

  function getWorkoutByDate(date) {
    return state.workouts.find((w) => w.date === date) || null;
  }

  function entryMaxWeight(entry) {
    let max = null;
    for (const set of entry.sets || []) {
      const w = Number(set.weight);
      if (isNaN(w)) continue;
      if (max == null || w > max) max = w;
    }
    return max;
  }

  function entryBest1RM(entry) {
    let best = null;
    for (const set of entry.sets || []) {
      const rm = estimate1RM(set.weight, set.reps);
      if (rm == null) continue;
      if (best == null || rm > best) best = rm;
    }
    return best;
  }

  /** 種目の最高記録: 最大重量・推定1RM */
  function getPR(exerciseId) {
    let maxWeight = null;
    let maxWeightDate = null;
    let max1RM = null;
    let max1RMDate = null;
    for (const w of state.workouts) {
      for (const entry of w.entries || []) {
        if (entry.exerciseId !== exerciseId) continue;
        const mw = entryMaxWeight(entry);
        if (mw != null && (maxWeight == null || mw > maxWeight)) {
          maxWeight = mw;
          maxWeightDate = w.date;
        }
        const rm = entryBest1RM(entry);
        if (rm != null && (max1RM == null || rm > max1RM)) {
          max1RM = rm;
          max1RMDate = w.date;
        }
      }
    }
    return { maxWeight, maxWeightDate, max1RM, max1RMDate };
  }

  /** 指定日より前の直近セット */
  function getLastEntrySets(exerciseId, beforeDate) {
    const sorted = [...state.workouts]
      .filter((w) => w.date < beforeDate)
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    for (const w of sorted) {
      const entry = (w.entries || []).find((e) => e.exerciseId === exerciseId);
      if (entry && entry.sets?.length) {
        return {
          date: w.date,
          sets: entry.sets.map((s) => ({ weight: s.weight, reps: s.reps })),
        };
      }
    }
    return null;
  }

  // 編集中ドラフト（保存前）
  let trainDraft = null;

  function loadTrainDraft(date) {
    const existing = getWorkoutByDate(date);
    if (existing) {
      trainDraft = {
        id: existing.id,
        date,
        note: existing.note || "",
        entries: existing.entries.map((e) => ({
          exerciseId: e.exerciseId,
          sets: e.sets.map((s) => ({ weight: s.weight, reps: s.reps })),
        })),
      };
    } else {
      trainDraft = { id: uid("wo"), date, note: "", entries: [] };
    }
  }

  function fillMuscleSelect(sel) {
    if (!sel) return;
    sel.innerHTML = Object.entries(MUSCLE_LABELS)
      .map(([k, v]) => `<option value="${k}">${v}</option>`)
      .join("");
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatSetsSummary(sets) {
    if (!sets?.length) return "記録なし";
    return sets
      .map((s, i) => `<span class="last-set-pill"><b>${i + 1}</b>${s.weight}<small>kg</small>×${s.reps}<small>回</small></span>`)
      .join("");
  }

  function renderLastPreviewHtml(last, opts = {}) {
    const { compact = false } = opts;
    if (!last) {
      return `<div class="last-preview-inner is-empty">
        <span class="last-preview-label">前回</span>
        <p>まだこの種目の記録がありません</p>
      </div>`;
    }
    const vol = last.sets.reduce((s, set) => s + setVolume(set), 0);
    return `<div class="last-preview-inner">
      <div class="last-preview-top">
        <span class="last-preview-label">前回 · ${formatJpDate(last.date)}</span>
        ${compact ? "" : `<span class="last-preview-vol">${Math.round(vol).toLocaleString()} kg</span>`}
      </div>
      <div class="last-set-pills">${formatSetsSummary(last.sets)}</div>
    </div>`;
  }

  function updateTrainLastPreview() {
    const box = $("#trainLastPreview");
    const sel = $("#trainAddExercise");
    if (!box || !sel || !trainDraft) return;
    const id = sel.value;
    if (!id || sel.disabled) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    const last = getLastEntrySets(id, trainDraft.date);
    const pr = getPR(id);
    box.hidden = false;
    box.innerHTML = `${renderLastPreviewHtml(last)}
      <div class="last-preview-pr">
        <span>自己ベスト重量 <strong>${pr.maxWeight != null ? pr.maxWeight + " kg" : "--"}</strong></span>
        <span>自己ベスト1RM <strong>${pr.max1RM != null ? pr.max1RM + " kg" : "--"}</strong></span>
      </div>`;
  }

  function fillTrainAddSelect() {
    const sel = $("#trainAddExercise");
    if (!sel || !trainDraft) return;
    const used = new Set(trainDraft.entries.map((e) => e.exerciseId));
    const available = state.exercises.filter((e) => !used.has(e.id));
    const prev = sel.value;
    if (!available.length) {
      sel.innerHTML = `<option value="">追加できる種目がありません</option>`;
      sel.disabled = true;
      $("#trainAddEntryBtn").disabled = true;
      updateTrainLastPreview();
      return;
    }
    sel.disabled = false;
    $("#trainAddEntryBtn").disabled = false;
    sel.innerHTML = available
      .map(
        (e) =>
          `<option value="${e.id}">${escapeHtml(e.name)}（${MUSCLE_LABELS[e.muscle] || "その他"}）</option>`
      )
      .join("");
    if (prev && available.some((e) => e.id === prev)) sel.value = prev;
    updateTrainLastPreview();
  }

  function renderExerciseList() {
    const list = $("#exerciseList");
    if (!list) return;
    if (!state.exercises.length) {
      list.innerHTML = `<p class="hint">種目がありません。下のフォームから登録してください。</p>`;
      return;
    }
    list.innerHTML = state.exercises
      .map((ex) => {
        const pr = getPR(ex.id);
        const last = trainDraft
          ? getLastEntrySets(ex.id, trainDraft.date)
          : getLastEntrySets(ex.id, todayStr());
        const lastLine = last
          ? `前回 ${formatJpDate(last.date)} · ${last.sets.map((s) => `${s.weight}×${s.reps}`).join(" / ")}`
          : "前回なし";
        return `<div class="exercise-item" data-id="${ex.id}">
          <div class="exercise-meta">
            <div class="exercise-title-row">
              <strong>${escapeHtml(ex.name)}</strong>
              <span class="muscle-tag">${MUSCLE_LABELS[ex.muscle] || "その他"}</span>
            </div>
            <div class="exercise-sub">${escapeHtml(lastLine)}</div>
            <div class="exercise-pr-row">
              <span class="pr-chip">PR ${pr.maxWeight != null ? pr.maxWeight + " kg" : "未記録"}</span>
            </div>
          </div>
          <button type="button" class="btn-icon danger" data-del-ex="${ex.id}" aria-label="削除">×</button>
        </div>`;
      })
      .join("");
  }

  function renderTrainEntries() {
    const box = $("#trainEntries");
    const hint = $("#trainEmptyHint");
    if (!box || !trainDraft) return;
    const vol = workoutVolume(trainDraft);
    $("#trainVolumeBadge").textContent = `総負荷 ${Math.round(vol).toLocaleString()} kg`;

    if (!trainDraft.entries.length) {
      box.innerHTML = "";
      if (hint) hint.hidden = false;
      return;
    }
    if (hint) hint.hidden = true;

    box.innerHTML = trainDraft.entries
      .map((entry, ei) => {
        const ex = getExercise(entry.exerciseId);
        const name = ex ? ex.name : "不明な種目";
        const muscle = ex ? MUSCLE_LABELS[ex.muscle] || "その他" : "";
        const pr = getPR(entry.exerciseId);
        const bestRm = entryBest1RM(entry);
        const last = getLastEntrySets(entry.exerciseId, trainDraft.date);
        const setsHtml = (entry.sets || [])
          .map(
            (set, si) => `<div class="set-row" data-ei="${ei}" data-si="${si}">
              <span class="set-num">${si + 1}</span>
              <label class="set-field">
                <span class="set-field-label">重量</span>
                <div class="set-field-input">
                  <input type="number" inputmode="decimal" step="0.5" class="set-weight" value="${set.weight}" placeholder="0" aria-label="重量" />
                  <span>kg</span>
                </div>
              </label>
              <span class="set-x" aria-hidden="true">×</span>
              <label class="set-field">
                <span class="set-field-label">回数</span>
                <div class="set-field-input">
                  <input type="number" inputmode="numeric" class="set-reps" value="${set.reps}" placeholder="0" aria-label="回数" />
                  <span>回</span>
                </div>
              </label>
              <button type="button" class="btn-icon" data-del-set="${ei}:${si}" aria-label="セット削除">×</button>
            </div>`
          )
          .join("");
        return `<article class="train-entry" data-ei="${ei}">
          <header class="train-entry-head">
            <div class="train-entry-title">
              <strong>${escapeHtml(name)}</strong>
              ${muscle ? `<span class="muscle-tag">${muscle}</span>` : ""}
            </div>
            <button type="button" class="btn-icon danger" data-del-entry="${ei}" aria-label="種目を外す">×</button>
          </header>
          <div class="train-entry-stats">
            <div class="stat-pill"><span>PR</span><strong>${pr.maxWeight != null ? pr.maxWeight + " kg" : "--"}</strong></div>
            <div class="stat-pill"><span>推定1RM</span><strong>${bestRm != null ? bestRm + " kg" : "--"}</strong></div>
            <div class="stat-pill"><span>負荷</span><strong>${Math.round(entryVolume(entry)).toLocaleString()} kg</strong></div>
          </div>
          <div class="entry-last-block">
            ${renderLastPreviewHtml(last, { compact: true })}
            <button type="button" class="btn btn-secondary btn-sm" data-copy-last="${ei}" ${last ? "" : "disabled"}>
              前回の内容をコピー
            </button>
          </div>
          <div class="set-section">
            <div class="set-section-label">今回のセット</div>
            <div class="set-list">${setsHtml || `<p class="hint">セットがありません</p>`}</div>
            <button type="button" class="btn btn-ghost btn-sm btn-add-set" data-add-set="${ei}">＋ セットを追加</button>
          </div>
        </article>`;
      })
      .join("");
  }

  function syncDraftFromDom() {
    if (!trainDraft) return;
    $$("#trainEntries .set-row").forEach((row) => {
      const ei = parseInt(row.dataset.ei, 10);
      const si = parseInt(row.dataset.si, 10);
      const entry = trainDraft.entries[ei];
      if (!entry || !entry.sets[si]) return;
      const w = parseFloat(row.querySelector(".set-weight").value);
      const r = parseInt(row.querySelector(".set-reps").value, 10);
      entry.sets[si].weight = isNaN(w) ? 0 : +w.toFixed(1);
      entry.sets[si].reps = isNaN(r) ? 0 : r;
    });
  }

  function renderTrainView() {
    const dateInput = $("#trainDate");
    if (!dateInput) return;
    const date = dateInput.value || todayStr();
    if (!dateInput.value) dateInput.value = date;
    if (!trainDraft || trainDraft.date !== date) loadTrainDraft(date);
    renderExerciseList();
    fillTrainAddSelect();
    renderTrainEntries();
  }

  function initTrainView() {
    const dateInput = $("#trainDate");
    if (!dateInput) return;
    dateInput.value = todayStr();
    fillMuscleSelect($("#newExerciseMuscle"));

    dateInput.addEventListener("change", () => {
      syncDraftFromDom();
      loadTrainDraft(dateInput.value || todayStr());
      renderTrainView();
    });

    $("#trainAddExercise").addEventListener("change", () => updateTrainLastPreview());

    $("#trainAddEntryBtn").addEventListener("click", () => {
      syncDraftFromDom();
      const id = $("#trainAddExercise").value;
      if (!id) {
        toast("追加できる種目がありません");
        return;
      }
      if (trainDraft.entries.some((e) => e.exerciseId === id)) {
        toast("すでに追加されています");
        return;
      }
      const last = getLastEntrySets(id, trainDraft.date);
      trainDraft.entries.push({
        exerciseId: id,
        sets: last
          ? last.sets.map((s) => ({ ...s }))
          : [{ weight: 0, reps: 10 }],
      });
      renderTrainView();
      if (last) toast(`${formatJpDate(last.date)}の内容を初期値にしました`);
    });

    $("#trainEntries").addEventListener("click", (e) => {
      const delEntry = e.target.closest("[data-del-entry]");
      const delSet = e.target.closest("[data-del-set]");
      const addSet = e.target.closest("[data-add-set]");
      const copyLast = e.target.closest("[data-copy-last]");
      if (delEntry) {
        syncDraftFromDom();
        const ei = parseInt(delEntry.dataset.delEntry, 10);
        trainDraft.entries.splice(ei, 1);
        renderTrainView();
        return;
      }
      if (delSet) {
        syncDraftFromDom();
        const [ei, si] = delSet.dataset.delSet.split(":").map(Number);
        trainDraft.entries[ei]?.sets.splice(si, 1);
        renderTrainView();
        return;
      }
      if (addSet) {
        syncDraftFromDom();
        const ei = parseInt(addSet.dataset.addSet, 10);
        const entry = trainDraft.entries[ei];
        if (!entry) return;
        const prev = entry.sets[entry.sets.length - 1];
        entry.sets.push({
          weight: prev ? prev.weight : 0,
          reps: prev ? prev.reps : 10,
        });
        renderTrainView();
        return;
      }
      if (copyLast && !copyLast.disabled) {
        syncDraftFromDom();
        const ei = parseInt(copyLast.dataset.copyLast, 10);
        const entry = trainDraft.entries[ei];
        if (!entry) return;
        const last = getLastEntrySets(entry.exerciseId, trainDraft.date);
        if (!last) {
          toast("前回の記録がありません");
          return;
        }
        entry.sets = last.sets.map((s) => ({ ...s }));
        renderTrainView();
        toast(`${formatJpDate(last.date)}のセットをコピーしました`);
      }
    });

    $("#trainEntries").addEventListener("change", (e) => {
      if (e.target.matches(".set-weight, .set-reps")) {
        syncDraftFromDom();
        const vol = workoutVolume(trainDraft);
        $("#trainVolumeBadge").textContent = `総負荷 ${Math.round(vol).toLocaleString()} kg`;
        $$("#trainEntries .train-entry").forEach((card, ei) => {
          const entry = trainDraft.entries[ei];
          if (!entry) return;
          const bestRm = entryBest1RM(entry);
          const pr = getPR(entry.exerciseId);
          const stats = card.querySelector(".train-entry-stats");
          if (!stats) return;
          stats.innerHTML = `
            <div class="stat-pill"><span>PR</span><strong>${pr.maxWeight != null ? pr.maxWeight + " kg" : "--"}</strong></div>
            <div class="stat-pill"><span>推定1RM</span><strong>${bestRm != null ? bestRm + " kg" : "--"}</strong></div>
            <div class="stat-pill"><span>負荷</span><strong>${Math.round(entryVolume(entry)).toLocaleString()} kg</strong></div>`;
        });
      }
    });

    $("#saveWorkoutBtn").addEventListener("click", () => {
      syncDraftFromDom();
      const date = trainDraft.date;
      trainDraft.entries = trainDraft.entries
        .map((e) => ({
          exerciseId: e.exerciseId,
          sets: (e.sets || []).map(normalizeSet).filter(Boolean),
        }))
        .filter((e) => e.sets.length > 0);

      const idx = state.workouts.findIndex((w) => w.date === date);
      if (!trainDraft.entries.length) {
        if (idx >= 0) state.workouts.splice(idx, 1);
        saveData();
        loadTrainDraft(date);
        renderTrainView();
        fillChartExerciseSelect();
        toast("セットがないため記録を削除しました");
        return;
      }

      const saved = normalizeWorkout(trainDraft);
      if (idx >= 0) state.workouts[idx] = saved;
      else state.workouts.push(saved);
      state.workouts.sort((a, b) => (a.date < b.date ? -1 : 1));
      saveData();
      loadTrainDraft(date);
      renderTrainView();
      fillChartExerciseSelect();
      toast(`${formatJpDate(date)}のトレーニングを保存しました`);
    });

    $("#addExerciseBtn").addEventListener("click", () => {
      const name = ($("#newExerciseName").value || "").trim();
      const muscle = $("#newExerciseMuscle").value || "other";
      if (!name) {
        toast("種目名を入力してください");
        return;
      }
      if (state.exercises.some((e) => e.name === name)) {
        toast("同名の種目があります");
        return;
      }
      state.exercises.push(normalizeExercise({ name, muscle }));
      saveData();
      $("#newExerciseName").value = "";
      renderTrainView();
      fillChartExerciseSelect();
      toast(`「${name}」を登録しました`);
    });

    $("#exerciseList").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-del-ex]");
      if (!btn) return;
      const id = btn.dataset.delEx;
      const ex = getExercise(id);
      if (!ex) return;
      const used = state.workouts.some((w) =>
        (w.entries || []).some((en) => en.exerciseId === id)
      );
      const msg = used
        ? `「${ex.name}」は過去の記録で使われています。削除しますか？（記録内の種目は不明になります）`
        : `「${ex.name}」を削除しますか？`;
      if (!confirm(msg)) return;
      state.exercises = state.exercises.filter((x) => x.id !== id);
      saveData();
      if (trainDraft) {
        trainDraft.entries = trainDraft.entries.filter((en) => en.exerciseId !== id);
      }
      renderTrainView();
      fillChartExerciseSelect();
      toast("種目を削除しました");
    });
  }

  // -----------------------------
  // インポート（マージ）
  // -----------------------------
  function mergeRecords(existing, incoming) {
    const merged = { ...existing };
    let added = 0;
    let updated = 0;
    for (const [date, rec] of Object.entries(incoming)) {
      const incoming = normalizeRecord(rec);
      if (merged[date]) {
        merged[date] = {
          ...merged[date],
          weight: incoming.weight ?? merged[date].weight,
          dailyCalories: incoming.dailyCalories ?? merged[date].dailyCalories,
        };
        updated++;
      } else {
        merged[date] = incoming;
        added++;
      }
    }
    return { merged, added, updated };
  }

  function setImportHistoryStatus(msg, kind = "") {
    const el = $("#importHistoryStatus");
    if (!el) return;
    el.textContent = msg;
    el.className = "import-status" + (kind ? ` is-${kind}` : "");
  }

  function countWeightRecords() {
    return Object.keys(state.records).filter((d) => state.records[d].weight != null).length;
  }

  function loadWeightBundleScript() {
    return new Promise((resolve, reject) => {
      if (window.WEIGHT_IMPORT_RECORDS) {
        resolve(window.WEIGHT_IMPORT_RECORDS);
        return;
      }
      const s = document.createElement("script");
      s.src = `weight-bundle.js?t=${Date.now()}`;
      s.onload = () => {
        if (window.WEIGHT_IMPORT_RECORDS) resolve(window.WEIGHT_IMPORT_RECORDS);
        else reject(new Error("bundle empty"));
      };
      s.onerror = () => reject(new Error("bundle load failed"));
      document.head.appendChild(s);
    });
  }

  async function loadHistoryRecords() {
    const url = new URL("weight-import.json", window.location.href);
    url.searchParams.set("t", String(Date.now()));
    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.records) throw new Error("invalid json");
    return data.records;
  }

  async function fetchHistoryRecords() {
    try {
      return await loadHistoryRecords();
    } catch (err) {
      console.warn("weight-import.json failed, trying bundle", err);
      return loadWeightBundleScript();
    }
  }

  function applyImportedRecords(records) {
    const { merged, added, updated } = mergeRecords(state.records, records);
    state.records = normalizeRecords(merged);
    saveData();
    renderAll();
    fillSettingsForm();
    return { added, updated, total: countWeightRecords() };
  }

  // -----------------------------
  // 設定
  // -----------------------------
  function initSettingsView() {
    $("#saveSettingsBtn").addEventListener("click", () => {
      const h = parseFloat($("#settingHeight").value);
      const sw = parseFloat($("#settingStartWeight").value);
      const tw = parseFloat($("#settingTargetWeight").value);
      const td = $("#settingTargetDate").value;
      const dc = parseInt($("#settingDailyCal").value, 10);

      state.settings.height = isNaN(h) ? null : h;
      state.settings.startWeight = isNaN(sw) ? null : sw;
      state.settings.targetWeight = isNaN(tw) ? null : tw;
      state.settings.targetDate = td || null;
      state.settings.dailyCalGoal = isNaN(dc) ? 0 : dc;

      saveData();
      renderAll();
      toast("設定を保存しました");
    });

    $("#settingDailyCal").addEventListener("input", (e) => {
      const v = parseInt(e.target.value, 10);
      $("#weeklyBudgetHint").textContent = `1週間の予算: ${(isNaN(v) ? 0 : v * 7).toLocaleString()} kcal`;
    });

    $("#exportBtn").addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `weight-tracker-${todayStr()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast("データを書き出しました");
    });

    $("#importBtn").addEventListener("click", () => $("#importFile").click());

    const importHistoryBtn = $("#importHistoryBtn");
    if (importHistoryBtn) {
      importHistoryBtn.addEventListener("click", async () => {
        const btn = importHistoryBtn;
        btn.disabled = true;
        setImportHistoryStatus("履歴を読み込み中…", "loading");
        try {
          const records = await fetchHistoryRecords();
          const before = countWeightRecords();
          const { added, updated, total } = applyImportedRecords(records);
          const msg = `取り込み完了: 新規${added}件・更新${updated}件（体重記録 合計${total}件）`;
          setImportHistoryStatus(msg, "success");
          toast("履歴を取り込みました");
          if (before === 0 && total > 0) {
            currentView = "";
            switchView("home");
          }
        } catch (err) {
          console.warn("history import error", err);
          const detail = err && err.message ? `（${err.message}）` : "";
          setImportHistoryStatus(`取り込みに失敗しました${detail}`, "error");
          toast("履歴の取り込みに失敗しました");
        } finally {
          btn.disabled = false;
        }
      });
    }

    $("#importFile").addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target.result);
          if (!data.settings || !data.records) throw new Error("invalid");
          if (!confirm("既存のデータは上書きされます。続行しますか？")) return;
          state = hydrateState(data);
          saveData();
          renderAll();
          fillSettingsForm();
          toast("データを読み込みました");
        } catch (err) {
          toast("読み込みに失敗しました");
        }
      };
      reader.readAsText(file);
      e.target.value = "";
    });

    $("#resetBtn").addEventListener("click", () => {
      if (!confirm("全てのデータを削除します。この操作は取り消せません。続行しますか？")) return;
      state = structuredClone(DEFAULT_DATA);
      state.exercises = structuredClone(SEED_EXERCISES);
      trainDraft = null;
      saveData();
      fillSettingsForm();
      fillChartExerciseSelect();
      renderAll();
      toast("全データを削除しました");
    });
  }

  function fillSettingsForm() {
    const s = state.settings;
    $("#settingHeight").value = s.height ?? "";
    $("#settingStartWeight").value = s.startWeight ?? "";
    $("#settingTargetWeight").value = s.targetWeight ?? "";
    $("#settingTargetDate").value = s.targetDate ?? "";
    $("#settingDailyCal").value = s.dailyCalGoal ?? "";
    $("#weeklyBudgetHint").textContent = `1週間の予算: ${((s.dailyCalGoal || 0) * 7).toLocaleString()} kcal`;
  }

  // -----------------------------
  // チャート
  // -----------------------------
  let chartRange = 7;
  let weightChart, calChart, avgWeightChart, avgCalChart, volumeChart, exWeightChart;
  let chartExerciseId = null;

  function buildSeries(days) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const result = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = addDays(today, -i);
      const key = formatDate(d);
      const rec = state.records[key] || {};
      const kcal = dayCalories(key);
      result.push({
        date: key,
        label: formatChartLabel(d),
        weight: rec.weight ?? null,
        kcal: kcal > 0 ? kcal : null,
      });
    }
    return result;
  }

  function formatChartLabel(d) {
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }

  function buildWeeklyAvgSeries(days) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const result = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = addDays(today, -i);
      const key = formatDate(d);
      let weightSum = 0;
      let weightCount = 0;
      let kcalSum = 0;
      for (let w = 0; w < 7; w++) {
        const wd = formatDate(addDays(d, -6 + w));
        const rec = state.records[wd];
        const weight = rec?.weight;
        if (weight != null && weight !== "") {
          weightSum += Number(weight);
          weightCount++;
        }
        kcalSum += dayCalories(wd);
      }
      result.push({
        date: key,
        label: formatChartLabel(d),
        avgWeight: weightCount > 0 ? +(weightSum / weightCount).toFixed(1) : null,
        avgKcal: Math.round(kcalSum / 7),
      });
    }
    return result;
  }

  function buildVolumeSeries(days) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const byDate = {};
    for (const w of state.workouts) {
      byDate[w.date] = workoutVolume(w);
    }
    const result = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = addDays(today, -i);
      const key = formatDate(d);
      const vol = byDate[key];
      result.push({
        date: key,
        label: formatChartLabel(d),
        volume: vol > 0 ? Math.round(vol) : null,
      });
    }
    return result;
  }

  function buildExerciseWeightSeries(days, exerciseId) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const byDate = {};
    if (exerciseId) {
      for (const w of state.workouts) {
        const entry = (w.entries || []).find((e) => e.exerciseId === exerciseId);
        if (!entry) continue;
        const mw = entryMaxWeight(entry);
        if (mw != null) byDate[w.date] = mw;
      }
    }
    const result = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = addDays(today, -i);
      const key = formatDate(d);
      result.push({
        date: key,
        label: formatChartLabel(d),
        maxWeight: byDate[key] ?? null,
      });
    }
    return result;
  }

  function fillChartExerciseSelect() {
    const sel = $("#chartExerciseSelect");
    if (!sel) return;
    const prev = chartExerciseId || sel.value;
    if (!state.exercises.length) {
      sel.innerHTML = `<option value="">種目がありません</option>`;
      chartExerciseId = null;
      return;
    }
    sel.innerHTML = state.exercises
      .map(
        (e) =>
          `<option value="${e.id}">${escapeHtml(e.name)}（${MUSCLE_LABELS[e.muscle] || "その他"}）</option>`
      )
      .join("");
    if (prev && state.exercises.some((e) => e.id === prev)) {
      sel.value = prev;
      chartExerciseId = prev;
    } else {
      chartExerciseId = state.exercises[0].id;
      sel.value = chartExerciseId;
    }
  }

  function toggleWeeklyCharts() {
    const show = chartRange >= WEEKLY_AVG_MIN_RANGE;
    $("#avgWeightChartCard").hidden = !show;
    $("#avgCalChartCard").hidden = !show;
    $("#weeklyChartHint").hidden = show;
  }

  function getChartColors() {
    const cs = getComputedStyle(document.documentElement);
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    return {
      text: cs.getPropertyValue("--text-sub").trim() || "#6b7280",
      grid: isDark ? "rgba(255,255,255,0.06)" : "rgba(17,24,39,0.06)",
      primary: "#6366f1",
      accent: "#ec4899",
      success: "#10b981",
      warn: "#f59e0b",
      bgFill: isDark ? "rgba(129,140,248,0.18)" : "rgba(99,102,241,0.15)",
      accentFill: isDark ? "rgba(244,114,182,0.18)" : "rgba(236,72,153,0.15)",
      successFill: isDark ? "rgba(16,185,129,0.18)" : "rgba(16,185,129,0.15)",
      warnFill: isDark ? "rgba(245,158,11,0.18)" : "rgba(245,158,11,0.15)",
    };
  }

  function commonOptions(colors) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "rgba(17,24,39,0.95)",
          padding: 10,
          cornerRadius: 8,
          titleFont: { weight: 700, size: 12 },
          bodyFont: { size: 12 },
        },
      },
      scales: {
        x: {
          grid: { color: colors.grid, drawBorder: false },
          ticks: { color: colors.text, font: { size: 11 } },
        },
        y: {
          grid: { color: colors.grid, drawBorder: false },
          ticks: { color: colors.text, font: { size: 11 } },
        },
      },
    };
  }

  function makeDataset(label, color, fillColor) {
    return {
      label,
      data: [],
      borderColor: color,
      backgroundColor: fillColor,
      borderWidth: 2.5,
      tension: 0.35,
      fill: true,
      pointRadius: 0,
      pointHoverRadius: 0,
      spanGaps: true,
    };
  }

  function ensureCharts() {
    const colors = getChartColors();
    const opt = commonOptions(colors);

    if (!weightChart) {
      weightChart = new Chart($("#weightChart"), {
        type: "line",
        data: { labels: [], datasets: [makeDataset("体重(kg)", colors.primary, colors.bgFill)] },
        options: opt,
      });
    }
    if (!calChart) {
      calChart = new Chart($("#calChart"), {
        type: "line",
        data: { labels: [], datasets: [makeDataset("摂取(kcal)", colors.accent, colors.accentFill)] },
        options: opt,
      });
    }
    if (!avgWeightChart) {
      avgWeightChart = new Chart($("#avgWeightChart"), {
        type: "line",
        data: { labels: [], datasets: [makeDataset("週平均体重(kg)", colors.success, colors.successFill)] },
        options: opt,
      });
    }
    if (!avgCalChart) {
      avgCalChart = new Chart($("#avgCalChart"), {
        type: "line",
        data: { labels: [], datasets: [makeDataset("週平均摂取(kcal)", colors.warn, colors.warnFill)] },
        options: opt,
      });
    }
    if (!volumeChart && $("#volumeChart")) {
      volumeChart = new Chart($("#volumeChart"), {
        type: "line",
        data: { labels: [], datasets: [makeDataset("総ボリューム(kg)", colors.success, colors.successFill)] },
        options: opt,
      });
    }
    if (!exWeightChart && $("#exWeightChart")) {
      exWeightChart = new Chart($("#exWeightChart"), {
        type: "line",
        data: { labels: [], datasets: [makeDataset("種目重量(kg)", colors.warn, colors.warnFill)] },
        options: opt,
      });
    }
  }

  function applyChartTheme(chart, colors, datasetIndex = 0) {
    const ds = chart.data.datasets[datasetIndex];
    chart.options.scales.x.ticks.color = colors.text;
    chart.options.scales.y.ticks.color = colors.text;
    chart.options.scales.x.grid.color = colors.grid;
    chart.options.scales.y.grid.color = colors.grid;
    chart.update();
  }

  function updateLineChart(chart, labels, data, colors, borderColor, fillColor) {
    chart.data.labels = labels;
    const ds = chart.data.datasets[0];
    ds.data = data;
    ds.borderColor = borderColor;
    ds.backgroundColor = fillColor;
    ds.pointBackgroundColor = borderColor;
    applyChartTheme(chart, colors);
  }

  function trendBadge(values) {
    const valid = values.filter((v) => v != null);
    if (valid.length < 2) return { text: "データ不足", cls: "flat" };
    const diff = valid[valid.length - 1] - valid[0];
    if (Math.abs(diff) < 0.05) return { text: "横ばい", cls: "flat" };
    const sign = diff > 0 ? "+" : "";
    return { text: `${sign}${diff.toFixed(1)}`, cls: diff > 0 ? "up" : "down" };
  }

  function updateCharts() {
    if (typeof Chart === "undefined") return;
    ensureCharts();
    const colors = getChartColors();
    const warnFill = colors.warnFill || (document.documentElement.getAttribute("data-theme") === "dark"
      ? "rgba(245,158,11,0.18)"
      : "rgba(245,158,11,0.15)");

    const series = buildSeries(chartRange);
    const labels = series.map((s) => s.label);

    updateLineChart(weightChart, labels, series.map((s) => s.weight), colors, colors.primary, colors.bgFill);
    updateLineChart(calChart, labels, series.map((s) => s.kcal), colors, colors.accent, colors.accentFill);

    setTrend("#weightTrend", trendBadge(series.map((s) => s.weight)), "kg");
    setTrend("#calTrend", trendBadge(series.map((s) => s.kcal)), "kcal");

    toggleWeeklyCharts();
    if (chartRange >= WEEKLY_AVG_MIN_RANGE) {
      const avgSeries = buildWeeklyAvgSeries(chartRange);
      const avgLabels = avgSeries.map((s) => s.label);
      updateLineChart(
        avgWeightChart,
        avgLabels,
        avgSeries.map((s) => s.avgWeight),
        colors,
        colors.success,
        colors.successFill
      );
      updateLineChart(
        avgCalChart,
        avgLabels,
        avgSeries.map((s) => s.avgKcal),
        colors,
        colors.warn,
        warnFill
      );
      setTrend("#avgWeightTrend", trendBadge(avgSeries.map((s) => s.avgWeight)), "kg");
      setTrend("#avgCalTrend", trendBadge(avgSeries.map((s) => s.avgKcal)), "kcal");
    }

    const volSeries = buildVolumeSeries(chartRange);
    if (volumeChart) {
      updateLineChart(
        volumeChart,
        volSeries.map((s) => s.label),
        volSeries.map((s) => s.volume),
        colors,
        colors.success,
        colors.successFill
      );
      setTrend("#volumeTrend", trendBadge(volSeries.map((s) => s.volume)), "kg");
    }

    if (!chartExerciseId && state.exercises.length) {
      chartExerciseId = state.exercises[0].id;
    }
    const exSeries = buildExerciseWeightSeries(chartRange, chartExerciseId);
    if (exWeightChart) {
      updateLineChart(
        exWeightChart,
        exSeries.map((s) => s.label),
        exSeries.map((s) => s.maxWeight),
        colors,
        colors.warn,
        warnFill
      );
      setTrend("#exWeightTrend", trendBadge(exSeries.map((s) => s.maxWeight)), "kg");
    }
  }

  function setTrend(sel, t, unit) {
    const el = $(sel);
    el.className = "trend " + t.cls;
    el.textContent = t.text === "横ばい" || t.text === "データ不足" ? t.text : `${t.text} ${unit}`;
  }

  // -----------------------------
  // 全体再描画
  // -----------------------------
  function renderAll() {
    renderHome();
    renderRecordView();
    renderTrainView();
    if ($(".view-graph").classList.contains("active")) updateCharts();
  }

  // -----------------------------
  // 初期化
  // -----------------------------
  function migrateLegacyStorage() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    let dirty = false;
    if (raw.includes('"meals"') || raw.includes('"bodyFat"')) {
      state.records = normalizeRecords(state.records);
      dirty = true;
    }
    if (!Array.isArray(state.exercises)) {
      state.exercises = structuredClone(SEED_EXERCISES);
      dirty = true;
    } else if (!state.exercises.length) {
      state.exercises = structuredClone(SEED_EXERCISES);
      dirty = true;
    }
    if (!Array.isArray(state.workouts)) {
      state.workouts = [];
      dirty = true;
    }
    // 旧データに exercises/workouts キーが無い場合は永続化
    if (!raw.includes('"exercises"') || !raw.includes('"workouts"')) {
      dirty = true;
    }
    if (dirty) saveData();
  }

  function init() {
    migrateLegacyStorage();
    initTheme();
    attachRipples();
    fillSettingsForm();
    initRecordView();
    initTrainView();
    initSettingsView();
    fillChartExerciseSelect();

    // ナビゲーション
    $$(".nav-btn").forEach((b) => b.addEventListener("click", () => switchView(b.dataset.target)));

    // クイックボタン
    $$(".quick-btn").forEach((b) => {
      b.addEventListener("click", () => {
        if (b.dataset.quick === "train") {
          switchView("train");
          return;
        }
        switchView("record");
        if (b.dataset.quick === "weight") {
          setTimeout(() => $("#inputWeight").focus(), 200);
        } else {
          setTimeout(() => $("#inputDailyCal").focus(), 200);
        }
      });
    });

    // テーマ
    $("#themeToggle").addEventListener("click", () => {
      const cur = document.documentElement.getAttribute("data-theme");
      applyTheme(cur === "dark" ? "light" : "dark");
    });

    // セグメント
    $$("#rangeSegment .seg-btn").forEach((b) => {
      b.addEventListener("click", () => {
        $$("#rangeSegment .seg-btn").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        chartRange = parseInt(b.dataset.range, 10);
        updateCharts();
      });
    });

    const chartExSel = $("#chartExerciseSelect");
    if (chartExSel) {
      chartExSel.addEventListener("change", () => {
        chartExerciseId = chartExSel.value || null;
        updateCharts();
      });
    }

    renderAll();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
