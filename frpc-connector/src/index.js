import { spawn } from 'node:child_process';
import { writeFile, stat, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FRPC = path.join(__dirname, 'frpc.exe');
const TOML = path.join(__dirname, 'frpc.toml');
const BAT = path.join(__dirname, 'run-frpc.bat');
const API = 'http://websdr.bd8ftc.de/?callsign=';

function log(ctx, msg) {
  ctx.log.info(String(msg));
}

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function downloadConfig(ctx) {
  const call = String(ctx.config.callsign || '').trim().toUpperCase();

  if (!call) throw new Error('未设置 callsign');
  if (!ctx.fetch) throw new Error('缺少 network 权限');

  const url = API + encodeURIComponent(call);

  log(ctx, `下载配置: ${url}`);

  const res = await ctx.fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const text = await res.text();

  if (!text.trim()) throw new Error('配置为空');

  if (/Callsign not found/i.test(text)) {
    throw new Error('呼号未注册');
  }

  await writeFile(TOML, text, 'utf8');

  const s = await stat(TOML);
  if (s.size === 0) throw new Error('写入失败');

  log(ctx, `配置下载成功 (${s.size} bytes)`);
}

function stopFrpc(ctx) {
  spawn('taskkill.exe', ['/f', '/im', 'frpc.exe'], {
    windowsHide: true,
    stdio: 'ignore',
  }).unref();

  log(ctx, '已停止 FRPC');
}

async function writeBat(ctx) {
  const interval = Math.max(1, Number(ctx.config.restartInterval || 10)) * 60;

  const content = [
    '@echo off',
    'chcp 65001 >nul',
    'title TX-5DR Web Tunnel Windows',
    `cd /d "${__dirname}"`,
    'echo TX-5DR Web Tunnel Windows',
    'echo Warning: frpc may be blocked by Windows Security or antivirus.',
    'echo If it runs successfully, visit websdr.bd8ftc.de',
    'echo.',
    ':loop',
    'echo ===== FRPC START %date% %time% =====',
    'frpc.exe -c frpc.toml',
    'echo.',
    'echo ===== FRPC EXIT %date% %time% ERRORLEVEL=%errorlevel% =====',
    `echo Restart after ${interval} seconds...`,
    `timeout /t ${interval} >nul`,
    'goto loop',
  ].join('\r\n');

  await writeFile(BAT, content, 'utf8');

  log(ctx, '已生成 run-frpc.bat（UTF-8 / ASCII 内容）');
}

async function startFrpc(ctx) {
  if (!(await exists(FRPC))) {
    throw new Error('找不到 frpc.exe');
  }

  await downloadConfig(ctx);
  await writeBat(ctx);

  stopFrpc(ctx);

  log(ctx, '启动 FRPC（单窗口循环模式）');

  const cmd = 'start cmd.exe /k call run-frpc.bat';

  spawn('cmd.exe', ['/d', '/c', cmd], {
    cwd: __dirname,
    windowsHide: false,
    shell: false,
    detached: true,
    stdio: 'ignore',
  }).unref();

  await ctx.updateConfig({ enabled: true });

  log(ctx, '启动成功（不会重复弹窗）');
}

export default {
  name: '网页内网穿透-Windows版',
  version: '1.0.0',
  type: 'utility',
  instanceScope: 'global',
  description: '网页内网穿透 Windows 版 FRPC 启动插件',
  permissions: ['network'],

  settings: {
    notice: {
      type: 'info',
      default: '',
      label: '提示：frpc 极易被杀毒软件误杀，请关闭 Windows 安全中心和杀毒软件。成功运行后可以访问 websdr.bd8ftc.de。',
      scope: 'global',
    },
    callsign: {
      type: 'string',
      default: '',
      label: '呼号',
      scope: 'global',
    },
    autoStart: {
      type: 'boolean',
      default: true,
      label: '自启动',
      scope: 'global',
    },
    restartInterval: {
      type: 'number',
      default: 10,
      label: '重启间隔(分钟)',
      min: 1,
      max: 1440,
      scope: 'global',
    },
    enabled: {
      type: 'boolean',
      default: false,
      label: '当前启用状态',
      hidden: true,
      scope: 'global',
    },
  },

  quickActions: [
    { id: 'start', label: '启动' },
    { id: 'stop', label: '停止' },
  ],

  async onLoad(ctx) {
    log(ctx, '插件已加载');
    log(ctx, '提示：关闭杀毒软件，否则 frpc 可能被误杀');

    if (ctx.config.autoStart) {
      try {
        await startFrpc(ctx);
      } catch (e) {
        ctx.log.error('自启动失败', e);
      }
    }
  },

  async onUnload(ctx) {
    stopFrpc(ctx);
  },

  hooks: {
    async onUserAction(id, payload, ctx) {
      if (id === 'start') {
        try {
          await startFrpc(ctx);
        } catch (e) {
          ctx.log.error('启动失败', e);
        }
      }

      if (id === 'stop') {
        stopFrpc(ctx);
        await ctx.updateConfig({ enabled: false });
      }
    },

    async onConfigChange(changes, ctx) {
      log(ctx, `配置更新：${JSON.stringify(changes)}`);
    },
  },
};