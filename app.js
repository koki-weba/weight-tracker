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
  };

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

  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return structuredClone(DEFAULT_DATA);
      const parsed = JSON.parse(raw);
      return {
        settings: { ...DEFAULT_DATA.settings, ...(parsed.settings || {}) },
        records: normalizeRecords(parsed.records),
      };
    } catch (e) {
      console.warn("data load error", e);
      return structuredClone(DEFAULT_DATA);
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
          state = {
            settings: { ...DEFAULT_DATA.settings, ...data.settings },
            records: normalizeRecords(data.records),
          };
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
      saveData();
      fillSettingsForm();
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
  let weightChart, calChart, avgWeightChart, avgCalChart;

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
    if ($(".view-graph").classList.contains("active")) updateCharts();
  }

  // -----------------------------
  // 初期化
  // -----------------------------
  function migrateLegacyStorage() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw || (!raw.includes('"meals"') && !raw.includes('"bodyFat"'))) return;
    state.records = normalizeRecords(state.records);
    saveData();
  }

  function init() {
    migrateLegacyStorage();
    initTheme();
    attachRipples();
    fillSettingsForm();
    initRecordView();
    initSettingsView();

    // ナビゲーション
    $$(".nav-btn").forEach((b) => b.addEventListener("click", () => switchView(b.dataset.target)));

    // クイックボタン
    $$(".quick-btn").forEach((b) => {
      b.addEventListener("click", () => {
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

    renderAll();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
