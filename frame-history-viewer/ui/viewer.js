/// <reference types="@tx5dr/plugin-api/bridge" />

/**
 * Frame History Viewer — iframe 前端页面
 *
 * 在 RadioControl 工具栏按钮点击时弹出的浮层中运行。
 * 通过 Bridge SDK (window.tx5dr) 与服务端通信：
 *   - invoke(action, data) → onLoad 中的 registerPageHandler
 *   - 服务端读取 JSONL 帧日志文件后返回数据
 *
 * 主要功能：
 *   1. 日期选择：从 frames-logs 目录列出所有可用日期
 *   2. 波段过滤：从已加载记录中提取去重波段列表
 *   3. 消息搜索：按关键字过滤帧消息
 *   4. 手风琴式展开：按时隙折叠/展开查看帧详情
 */

/**
 * 发射帧的信噪比标记值。
 * 服务端约定：snr = -999 表示该帧是本台发射的，非接收解码帧。
 * 参考 SlotPackPersistence.ts 中的实现。
 */
const TX_SNR_MARKER = -999;

let allRecords = [];          // 当前已加载的全部帧记录（未过滤）
let currentDate = '';         // 当前选中的日期
let currentBand = '';         // 当前选中的波段过滤条件
let currentFilter = '';       // 当前搜索关键字
let strings = {};             // 当前语言的 i18n 翻译字典
let allBandsLabel = 'All bands';
let cachedTotalSlots = 0;     // 当前日期的总时隙数（用于 summary 栏显示）
let cachedTotalFrames = 0;    // 当前日期的总帧数

const $ = (sel, ctx) => (ctx || document).querySelector(sel);
const $$ = (sel, ctx) => Array.from((ctx || document).querySelectorAll(sel));

/**
 * i18n 翻译辅助函数。
 * 支持 {0} {1} 占位符替换，与服务端 locales JSON 格式对应。
 */
function tr(key, ...args) {
  const s = strings[key] ?? key;
  if (args.length === 0) return s;
  return s.replace(/\{(\d+)\}/g, (_, idx) => {
    const i = parseInt(idx, 10);
    return i < args.length ? String(args[i]) : '';
  });
}

/** 防抖包装：避免搜索时频繁渲染 */
function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/**
 * 通过 Bridge SDK 向服务端发送请求。
 * 等待 tx5dr.ready 确保 SDK 初始化完成后才发起调用。
 */
async function invoke(action, data) {
  if (!window.tx5dr) throw new Error('Bridge SDK not available');
  await window.tx5dr.ready;
  return window.tx5dr.invoke(action, data);
}

/**
 * 动态加载插件翻译。
 * 读取当前语言设置，从服务端获取该语言的翻译字典，
 * 然后一次性更新所有带 data-i18n / data-i18n-placeholder / data-i18n-title 属性的元素。
 */
async function loadStrings() {
  try {
    const locale = window.tx5dr?.locale || 'en';
    const result = await invoke('getLocaleStrings', { locale });
    strings = result || {};
    allBandsLabel = strings.uiAllBands || 'All bands';
  } catch {
    strings = {};
  }
  applyStaticStrings();
}

/** 将翻译字典应用到 HTML 模板中的 data-i18n 标记元素上 */
function applyStaticStrings() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    el.textContent = tr(key);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    el.placeholder = tr(key);
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    el.title = tr(key);
  });
  const titleAttr = document.querySelector('title')?.getAttribute('data-i18n');
  if (titleAttr) document.title = tr(titleAttr);
}

/**
 * 格式化毫秒时间戳为 UTC 时间字符串（HH:MM:SS）。
 * 帧日志中的时间戳均为 UTC，与 FT8 协议时间基准一致。
 */
function formatTime(ms) {
  if (ms == null) return '-';
  const d = new Date(ms);
  return d.getUTCHours().toString().padStart(2, '0') + ':' +
         d.getUTCMinutes().toString().padStart(2, '0') + ':' +
         d.getUTCSeconds().toString().padStart(2, '0');
}

/** 根据 SNR 值返回对应的 CSS class，用于颜色标记 */
function snrClass(snr) {
  if (snr === TX_SNR_MARKER) return '';
  if (snr >= -5) return 'snr-good';
  if (snr >= -15) return 'snr-ok';
  return 'snr-bad';
}

/** 格式化 SNR 显示值：发射帧显示 "TX"，解码帧显示实际数值 */
function formatSNR(snr) {
  if (snr === TX_SNR_MARKER) return 'TX';
  return String(snr);
}

/** 安全的 HTML 转义，防止 XSS */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

/** 搜索关键字高亮，同时防止 XSS */
function highlightMessage(msg, filter) {
  const escaped = escapeHtml(msg);
  if (!filter) return escaped;
  const escapedFilter = filter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp('(' + escapedFilter + ')', 'gi');
  return escaped.replace(regex, '<span class="highlight">$1</span>');
}

/** 通过 Bridge SDK 获取可用日期列表 */
async function loadDates() {
  try {
    const result = await invoke('listDates');
    return result.dates || [];
  } catch (err) {
    showError(tr('uiError') + ': ' + err.message);
    return [];
  }
}

/** 通过 Bridge SDK 加载指定日期的帧记录 */
async function loadRecords(date) {
  try {
    const result = await invoke('loadRecords', { date });
    return result.records || [];
  } catch (err) {
    showError(tr('uiError') + ': ' + err.message);
    return [];
  }
}

/** 显示错误横幅，隐藏其他 UI 状态 */
function showError(msg) {
  const el = $('#errorIndicator');
  el.textContent = msg;
  el.hidden = false;
  $('#loadingIndicator').hidden = true;
  $('#emptyIndicator').hidden = true;
  $('#slotList').innerHTML = '';
  $('#summaryBar').textContent = '';
}

/** 切换加载中指示器的显隐 */
function showLoading(show) {
  $('#loadingIndicator').hidden = !show;
  $('#errorIndicator').hidden = true;
  $('#emptyIndicator').hidden = true;
  if (show) {
    $('#slotList').innerHTML = '';
    $('#summaryBar').textContent = '';
  }
}

/** 更新顶部的摘要统计栏：显示总时隙数/总帧数，若经过过滤则同时显示筛选后数据 */
function updateSummary(records, totalSlots, totalFrames) {
  const el = $('#summaryBar');
  if (totalSlots === 0) {
    el.textContent = tr('uiNoRecords');
    return;
  }
  const shownSlots = records.length;
  const shownFrames = records.reduce((s, r) => s + (r.slotPack?.frames?.length || 0), 0);
  if (shownSlots === totalSlots && shownFrames === totalFrames) {
    el.textContent = tr('uiSummary', totalSlots, totalFrames);
  } else {
    el.textContent = tr('uiSummaryFiltered', shownSlots, totalSlots, shownFrames, totalFrames);
  }
}

/** 从 frequencyContext 中提取可读的波段标签，如 "40m 7.074 MHz" */
function bandLabel(fctx) {
  if (!fctx) return '';
  const parts = [];
  if (fctx.band) parts.push(fctx.band);
  if (fctx.frequency) parts.push((fctx.frequency / 1_000_000).toFixed(3) + ' MHz');
  return parts.length ? parts.join(' ') : '';
}

/**
 * 格式化时隙时间范围。
 * startMs / endMs 均为 UTC 毫秒时间戳。
 * 仅有 startMs 时只显示起始时间，有 endMs 时显示 "HH:MM:SS – HH:MM:SS"。
 */
function formatTimeRange(startMs, endMs) {
  if (!startMs) return '?';
  return endMs ? formatTime(startMs) + ' \u2013 ' + formatTime(endMs) : formatTime(startMs);
}

/**
 * 渲染单个时隙卡片（手风琴式）。
 *
 * header 区域：显示时隙时间范围、波段标签、帧数、操作类型（新建/更新）、模式。
 * body   区域：展开后以表格形式展示该时隙内所有帧的消息详情。
 * 当 filter 非空时默认展开（expanded = true）以便快速查看搜索结果。
 * 点击 header 切换展开/折叠。
 */
function renderSlot(record, filter, expanded) {
  const slotPack = record.slotPack || {};
  const frames = slotPack.frames || [];
  const startMs = slotPack.startMs;
  const endMs = slotPack.endMs;
  const timeLabel = formatTimeRange(startMs, endMs);
  const opLabel = record.operation === 'created' ? '+' : '';
  const modeLabel = record.mode || '';
  const fctx = slotPack.frequencyContext || {};
  const band = bandLabel(fctx);

  const card = document.createElement('div');
  card.className = 'slot-card';

  const header = document.createElement('div');
  header.className = 'slot-header' + (expanded ? ' open' : '');
  header.innerHTML =
    '<span class="chevron">\u25B6</span>' +
    '<span class="slot-label">' + escapeHtml(timeLabel) + '</span>' +
    '<span class="slot-meta">' +
    (band ? '<span class="meta-band">' + escapeHtml(band) + '</span> ' : '') +
    tr('uiFramesCount', frames.length) + (opLabel || modeLabel ? ' |' : '') + (opLabel ? ' ' + escapeHtml(opLabel) : '') + (modeLabel ? ' ' + escapeHtml(modeLabel) : '') +
    '</span>';

  const body = document.createElement('div');
  body.className = 'slot-body' + (expanded ? ' open' : '');

  if (frames.length === 0) {
    body.innerHTML = '<div class="slot-empty">' + escapeHtml(tr('uiNoFrames')) + '</div>';
  } else {
    const table = document.createElement('table');
    table.className = 'frames-table';
    table.innerHTML =
      '<thead><tr>' +
      '<th class="col-time">' + escapeHtml(tr('uiTime')) + '</th>' +
      '<th class="col-snr">' + escapeHtml(tr('uiSNR')) + '</th>' +
      '<th class="col-freq">' + escapeHtml(tr('uiFreq')) + '</th>' +
      '<th class="col-dt">' + escapeHtml(tr('uiDT')) + '</th>' +
      '<th class="col-message">' + escapeHtml(tr('uiMessage')) + '</th>' +
      '</tr></thead><tbody></tbody>';
    const tbody = table.querySelector('tbody');

    for (const frame of frames) {
      // 帧内时间偏移：frame.dt 是相对于 startMs 的秒数偏移
      const frameTime = startMs && frame.dt != null
        ? formatTime(startMs + frame.dt * 1000)
        : (frame.dt != null ? frame.dt.toFixed(1) + 's' : '-');
      const msg = frame.message || '';
      const row = document.createElement('tr');
      row.innerHTML =
        '<td class="col-time">' + escapeHtml(frameTime) + '</td>' +
        '<td class="col-snr ' + snrClass(frame.snr) + '">' + formatSNR(frame.snr) + '</td>' +
        '<td class="col-freq">' + (frame.freq != null ? frame.freq.toFixed(0) : '-') + '</td>' +
        '<td class="col-dt">' + (frame.dt != null ? frame.dt.toFixed(1) : '-') + '</td>' +
        '<td class="col-message">' + highlightMessage(msg, filter) + '</td>';
      tbody.appendChild(row);
    }

    body.appendChild(table);
  }

  header.addEventListener('click', () => {
    const isOpen = body.classList.toggle('open');
    header.classList.toggle('open', isOpen);
  });

  card.appendChild(header);
  card.appendChild(body);
  return card;
}

const debouncedFilter = debounce(applyFilter, 200);

/** 从已加载记录中提取去重并排序的波段列表，填充波段下拉框 */
function populateBandSelect(records) {
  const select = $('#bandSelect');
  select.innerHTML = '';
  select.add(new Option(allBandsLabel, ''));
  const bands = new Set();
  for (const r of records) {
    const band = r.slotPack?.frequencyContext?.band;
    if (band) bands.add(band);
  }
  // 波段名优先按数字排序（如 40m 在 20m 前），非数字名按字典序
  const sorted = Array.from(bands).sort((a, b) => {
    const na = parseInt(a, 10);
    const nb = parseInt(b, 10);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.localeCompare(b);
  });
  for (const b of sorted) {
    select.add(new Option(b, b));
  }
}

/**
 * 按波段 + 消息文本双重过滤。
 * 波段过滤保留整条记录；消息搜索过滤时只保留匹配的帧，若某个时隙的所有帧都不匹配则移除该时隙。
 */
function applyFilter() {
  let records = allRecords;

  if (currentBand) {
    records = records.filter(r => (r.slotPack?.frequencyContext?.band) === currentBand);
  }

  const filter = currentFilter.toLowerCase().trim();
  if (!filter) {
    renderRecords(records, '', cachedTotalSlots, cachedTotalFrames);
    return;
  }

  const filtered = [];
  for (const rec of records) {
    const frames = (rec.slotPack?.frames || []).filter(f =>
      (f.message || '').toLowerCase().includes(filter)
    );
    if (frames.length === 0) continue;
    // 浅拷贝记录但替换已过滤的 frames 数组，保持 slotPack 其他字段不变
    filtered.push({ ...rec, slotPack: { ...rec.slotPack, frames } });
  }
  renderRecords(filtered, currentFilter, cachedTotalSlots, cachedTotalFrames);
}

/** 渲染所有记录到 slotList 容器，有搜索关键字时默认展开所有卡片 */
function renderRecords(records, filter, totalSlots, totalFrames) {
  const container = $('#slotList');
  container.innerHTML = '';
  updateSummary(records, totalSlots || records.length, totalFrames || records.reduce((s, r) => s + (r.slotPack?.frames?.length || 0), 0));

  if (records.length === 0) {
    $('#emptyIndicator').hidden = false;
    return;
  }
  $('#emptyIndicator').hidden = true;

  const expanded = !!filter;
  for (const record of records) {
    container.appendChild(renderSlot(record, filter, expanded));
  }
}

/**
 * 加载指定日期的记录并渲染。
 * 过滤掉无帧的空时隙记录，重置过滤条件，刷新波段下拉框。
 */
async function loadAndRender(date) {
  currentDate = date;
  showLoading(true);
  const raw = await loadRecords(date);
  allRecords = raw.filter(r => (r.slotPack?.frames?.length || 0) > 0);
  showLoading(false);
  currentBand = '';
  currentFilter = '';
  $('#searchInput').value = '';
  populateBandSelect(allRecords);
  $('#bandSelect').value = '';
  cachedTotalSlots = allRecords.length;
  cachedTotalFrames = allRecords.reduce((s, r) => s + (r.slotPack?.frames?.length || 0), 0);
  renderRecords(allRecords, '', cachedTotalSlots, cachedTotalFrames);
}

/**
 * 初始化日期下拉选择器。
 * 从服务端获取可用日期列表，默认选中最新日期并自动加载。
 */
async function populateDateSelect() {
  const select = $('#dateSelect');
  const dates = await loadDates();

  select.innerHTML = '';
  if (dates.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = tr('uiNoData');
    opt.disabled = true;
    select.appendChild(opt);
    return;
  }

  for (const d of dates) {
    const opt = document.createElement('option');
    opt.value = d;
    opt.textContent = d;
    select.appendChild(opt);
  }

  select.value = dates[dates.length - 1];
  select.addEventListener('change', async () => {
    if (select.value) await loadAndRender(select.value);
  });

  await loadAndRender(select.value);
}

/**
 * 页面初始化入口。
 *
 * 启动顺序：
 *   1. 加载翻译 → 2. 初始化日期选择并加载最新数据 → 3. 注册交互事件
 *
 * 同时监听 onLocaleChange 事件，用户在 UI 中切换语言时自动重新加载翻译。
 */
async function init() {
  await loadStrings();
  $('#loadingIndicator').textContent = tr('uiLoading');
  $('#emptyIndicator').textContent = tr('uiNoData');
  await populateDateSelect();

  $('#refreshBtn').addEventListener('click', () => {
    if (currentDate) loadAndRender(currentDate);
  });

  $('#searchInput').addEventListener('input', () => {
    currentFilter = $('#searchInput').value;
    debouncedFilter();
  });

  $('#bandSelect').addEventListener('change', () => {
    currentBand = $('#bandSelect').value;
    applyFilter();
  });

  window.tx5dr?.onLocaleChange?.(() => {
    loadStrings();
  });
}

document.addEventListener('DOMContentLoaded', init);
