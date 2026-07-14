/**
 * Frame History Viewer — 服务端插件入口
 *
 * 本插件是一个 utility + global 实例的工具插件，在 RadioControl 工具栏添加一个
 * iframe 按钮入口（"帧历史查看器"），通过 Bridge SDK 通信，从 JSONL 帧日志文件中
 * 读取历史解码数据供前端浏览。
 *
 * 数据来源：<dataDir>/frames-logs/frames-YYYY-MM-DD.jsonl
 * 通信方式：iframe → tx5dr.invoke() → ctx.ui.registerPageHandler()
 */

import type { PluginContext, PluginDefinition, SlotPack } from '@tx5dr/plugin-api';
import { readdir, stat } from 'fs/promises';
import { createReadStream, existsSync } from 'fs';
import { createInterface } from 'readline';
import { join } from 'path';
import { homedir } from 'os';
import zhLocale from './locales/zh.json' with { type: 'json' };
import enLocale from './locales/en.json' with { type: 'json' };

const PLUGIN_NAME = 'frame-history-viewer';
const PAGE_ID = 'viewer';
const PANEL_GROUP_ID = 'viewer-entry';

function buildPanelDescriptor(openInModal: boolean) {
  return [{
    id: 'history-viewer-button',
    title: 'historyViewerTitle',
    component: 'iframe' as const,
    pageId: PAGE_ID,
    slot: 'radio-control-toolbar' as const,
    icon: 'clock-rotate-left',
    openMode: (openInModal ? 'modal' : 'popover') as 'modal' | 'popover',
    uiSize: 'lg' as const,
    params: { openMode: openInModal ? 'modal' : 'popover' },
  }];
}

/**
 * 与服务端 SlotPackPersistence.ts 中定义的 SlotPackStorageRecord 等效。
 * 此处重新定义是为了在独立插件项目中不依赖 @tx5dr/contracts，直接按 JSONL
 * 的存储格式反序列化。
 *
 * slotPack.startMs / slotPack.endMs 均为毫秒级 UTC 时间戳；
 * operation 标记该记录是"新建"还是"更新"（后者表示同一时隙的增量更新）。
 */
interface SlotPackStorageRecord {
  storedAt: number;
  operation: 'updated' | 'created';
  slotPack: SlotPack;
  mode?: string;
  version: string;
}

/**
 * 获取 TX-5DR 数据根目录。
 * 优先级：环境变量 → 容器路径 → Linux 系统路径 → XDG 标准路径。
 * 此处的查找逻辑需要与服务端 tx5drPaths.getDataDir() 保持一致。
 */
function getDataDir(): string {
  const env = process.env.TX5DR_DATA_DIR;
  if (env) return env;

  const candidates = [
    '/app/data',
    '/var/lib/tx5dr',
    join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'TX-5DR'),
  ];
  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  return candidates[candidates.length - 1];
}

/** frames-logs 子目录路径 */
function getFramesLogDir(): string {
  return join(getDataDir(), 'frames-logs');
}

/**
 * 扫描 frames-logs 目录，列出所有 JSONL 日志文件对应的日期。
 * 文件名格式：frames-YYYY-MM-DD.jsonl
 * 返回按字典序排序的日期字符串数组，最新日期在最后。
 */
async function listDates(): Promise<string[]> {
  const dir = getFramesLogDir();
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const dates: string[] = [];
  for (const name of entries.sort()) {
    const match = name.match(/^frames-(\d{4}-\d{2}-\d{2})\.jsonl$/);
    if (match) dates.push(match[1]);
  }
  return dates;
}

/**
 * 读取指定日期的 JSONL 日志文件，按行解析 SlotPackStorageRecord。
 *
 * 使用流式读取（createReadStream + readline）避免大文件一次性加载到内存。
 * 遇到格式损坏的行自动跳过，不影响其他有效行的读取。
 *
 * @param dateStr - 日期字符串 "YYYY-MM-DD"
 * @param limit   - 可选最大行数，用于前端初次加载限制传输量
 * @returns 记录数组 + hasMore 标记（当 limit 卡住时提示前端还有更多）
 */
async function loadRecords(dateStr: string, limit?: number): Promise<{ records: SlotPackStorageRecord[]; hasMore: boolean }> {
  const filePath = join(getFramesLogDir(), `frames-${dateStr}.jsonl`);
  try {
    const s = await stat(filePath);
    if (!s.isFile()) return { records: [], hasMore: false };
  } catch {
    return { records: [], hasMore: false };
  }
  const records: SlotPackStorageRecord[] = [];
  const stream = createReadStream(filePath, 'utf-8');
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (!line) continue;
      try {
        records.push(JSON.parse(line) as SlotPackStorageRecord);
        if (limit && records.length >= limit) break;
      } catch {
        // 跳过格式损坏的行（写文件时部分写入或异常中断可能导致）
      }
    }
  } finally {
    rl.close();
  }
  return { records, hasMore: !!limit && records.length >= limit };
}

const plugin: PluginDefinition = {
  name: PLUGIN_NAME,
  version: '1.0.0',
  type: 'utility',
  instanceScope: 'global',         // 全局单例：不需要按操作员分别实例化
  description: 'pluginDescription',

  // 面板改为动态注册（由设置 openInModal 控制 openMode），
  // 不在静态 panels 中声明，避免出现双按钮
  panels: [],

  settings: {
    openInModal: {
      type: 'boolean',
      default: false,
      label: 'openInModal',
      description: 'openInModalDescription',
      scope: 'global',
    },
  },

  ui: {
    dir: 'ui',
    pages: [{
      id: PAGE_ID,
      title: 'historyViewerTitle',
      entry: 'viewer.html',
      accessScope: 'admin',            // 仅管理员可访问
      resourceBinding: 'none',         // 不绑定特定操作员/呼号
    }],
  },

  onLoad(ctx: PluginContext) {
    ctx.log.debug('Plugin loaded');

    // 根据当前配置动态创建工具栏面板
    const openInModal = ctx.config.openInModal === true;
    ctx.ui.setPanelContributions(PANEL_GROUP_ID, buildPanelDescriptor(openInModal));

    ctx.ui.registerPageHandler({
      async onMessage(_pageId: string, action: string, data: unknown) {
        switch (action) {
          case 'listDates':
            return { dates: await listDates() };
          case 'loadRecords': {
            const { date, limit } = data as { date: string; limit?: number };
            const { records, hasMore } = await loadRecords(date, limit);
            return { date, records, total: records.length, hasMore };
          }
          case 'getLocaleStrings': {
            const { locale } = data as { locale: string };
            return locale === 'zh' ? zhLocale : enLocale;
          }
          default:
            throw new Error(`Unknown action: ${action}`);
        }
      },
    });
  },

  onUnload(ctx: PluginContext) {
    ctx.ui.clearPanelContributions(PANEL_GROUP_ID);
    ctx.log.debug('Plugin unloaded');
  },

  hooks: {
    onConfigChange(changes: Record<string, unknown>, ctx: PluginContext) {
      if ('openInModal' in changes) {
        const openInModal = changes.openInModal === true;
        ctx.ui.setPanelContributions(PANEL_GROUP_ID, buildPanelDescriptor(openInModal));
      }
    },
  },
};

export default plugin;
