/// <reference types="@tx5dr/plugin-api/bridge" />
import './styles.css';
import { t } from '../shared/i18n';
import { createRenderConfig } from '../shared/rendering';
import type { PageConfigResponse, RenderConfig } from '../shared/types';

const PLUGIN_HEIGHT_STORAGE_PREFIX = 'tx5dr:web-iframe-embed:height:';
const PLUGIN_ASPECT_RATIO_STORAGE_PREFIX = 'tx5dr:web-iframe-embed:aspect-ratio:';
const EMBED_KEYBOARD_MESSAGE_TYPE = 'tx5dr:web-iframe-embed:keyboard';
const MIN_HEIGHT = 140;

type KeyboardEventType = 'keydown' | 'keyup';

interface KeyboardForwardPayload {
  type: KeyboardEventType;
  code: string;
  key: string;
  repeat: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  location: number;
}

let activeEmbedCleanup: (() => void) | null = null;

function applyTheme(theme: 'dark' | 'light'): void {
  document.documentElement.dataset.tx5drTheme = theme;
  document.documentElement.style.colorScheme = theme;
  document.body.dataset.tx5drTheme = theme;
}

function getDefaultHeight(): number {
  const raw = Number.parseInt(document.body.dataset.defaultHeight ?? '', 10);
  return Number.isFinite(raw) ? raw : 360;
}

function getPageId(): string {
  return document.body.dataset.pageId ?? 'unknown-page';
}

function getPlacement(): string {
  return document.body.dataset.placement ?? 'operator';
}

function shouldUseManualResize(): boolean {
  const placement = getPlacement();
  return placement !== 'main-right' && placement !== 'voice-right-top';
}

function getHeightStorageKey(): string {
  return `${PLUGIN_HEIGHT_STORAGE_PREFIX}${getPageId()}`;
}

function getAspectRatioStorageKey(): string {
  return `${PLUGIN_ASPECT_RATIO_STORAGE_PREFIX}${getPageId()}`;
}

function clampHeight(height: number): number {
  if (!Number.isFinite(height)) {
    return getDefaultHeight();
  }
  return Math.max(MIN_HEIGHT, Math.round(height));
}

function loadStoredHeight(): number {
  try {
    const raw = window.localStorage.getItem(getHeightStorageKey());
    if (!raw) {
      return getDefaultHeight();
    }
    return clampHeight(Number.parseInt(raw, 10));
  } catch {
    return getDefaultHeight();
  }
}

function saveStoredHeight(height: number): void {
  try {
    window.localStorage.setItem(getHeightStorageKey(), String(clampHeight(height)));
  } catch {
    // Ignore storage failures; resizing should still work for the current session.
  }
}

function loadStoredAspectRatio(): number | null {
  try {
    const raw = window.localStorage.getItem(getAspectRatioStorageKey());
    if (!raw) {
      return null;
    }
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function saveStoredAspectRatio(aspectRatio: number): void {
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
    return;
  }

  try {
    window.localStorage.setItem(getAspectRatioStorageKey(), String(aspectRatio));
  } catch {
    // Ignore storage failures; resizing should still work for the current session.
  }
}

function createSurface(): {
  shell: HTMLDivElement;
  surface: HTMLDivElement;
  resizeHandle: HTMLDivElement | null;
} {
  const shell = document.createElement('div');
  shell.className = 'fill-shell';

  const surface = document.createElement('div');
  surface.className = 'fill-surface';

  let resizeHandle: HTMLDivElement | null = null;
  if (shouldUseManualResize()) {
    resizeHandle = document.createElement('div');
    resizeHandle.className = 'resize-handle';
    resizeHandle.title = 'Resize';
    shell.append(surface, resizeHandle);
  } else {
    shell.classList.add('fill-shell--full');
    shell.append(surface);
  }

  return { shell, surface, resizeHandle };
}

function renderError(container: HTMLElement, message: string, detail?: string): void {
  container.replaceChildren();

  const node = document.createElement('div');
  node.className = 'plugin-error';
  node.textContent = detail ? `${message}\n${detail}` : message;
  container.appendChild(node);
}

function cleanupActiveEmbed(): void {
  activeEmbedCleanup?.();
  activeEmbedCleanup = null;
}

function getFrameWindow(frame: HTMLIFrameElement): Window | null {
  try {
    return frame.contentWindow;
  } catch {
    return null;
  }
}

function normalizeKeyboardEventType(value: unknown): KeyboardEventType | null {
  return value === 'keydown' || value === 'keyup' ? value : null;
}

function payloadFromKeyboardEvent(event: KeyboardEvent): KeyboardForwardPayload {
  return {
    type: normalizeKeyboardEventType(event.type) ?? 'keydown',
    code: event.code,
    key: event.key,
    repeat: event.repeat,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
    location: event.location,
  };
}

function payloadFromPostMessage(data: unknown): KeyboardForwardPayload | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return null;
  }

  const record = data as Record<string, unknown>;
  if (record.type !== EMBED_KEYBOARD_MESSAGE_TYPE) {
    return null;
  }

  const eventType = normalizeKeyboardEventType(record.eventType);
  if (!eventType || typeof record.code !== 'string') {
    return null;
  }

  return {
    type: eventType,
    code: record.code,
    key: typeof record.key === 'string' ? record.key : '',
    repeat: Boolean(record.repeat),
    altKey: Boolean(record.altKey),
    ctrlKey: Boolean(record.ctrlKey),
    metaKey: Boolean(record.metaKey),
    shiftKey: Boolean(record.shiftKey),
    location: typeof record.location === 'number' && Number.isFinite(record.location)
      ? record.location
      : 0,
  };
}

function dispatchKeyboardToPluginHost(payload: KeyboardForwardPayload): boolean {
  const event = new KeyboardEvent(payload.type, {
    key: payload.key,
    code: payload.code,
    location: payload.location,
    repeat: payload.repeat,
    altKey: payload.altKey,
    ctrlKey: payload.ctrlKey,
    metaKey: payload.metaKey,
    shiftKey: payload.shiftKey,
    bubbles: true,
    cancelable: true,
    composed: true,
  });

  return !window.dispatchEvent(event);
}

function installNestedIframeKeyboardBridge(frame: HTMLIFrameElement): () => void {
  let directCleanup: (() => void) | null = null;

  const detachDirectBridge = () => {
    directCleanup?.();
    directCleanup = null;
  };

  const attachDirectBridge = () => {
    detachDirectBridge();
    const frameWindow = getFrameWindow(frame);
    if (!frameWindow) {
      return;
    }

    const forwardDirectEvent = (event: KeyboardEvent) => {
      const consumed = dispatchKeyboardToPluginHost(payloadFromKeyboardEvent(event));
      if (consumed) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
      }
    };
    const options: AddEventListenerOptions = { capture: true };

    try {
      frameWindow.addEventListener('keydown', forwardDirectEvent, options);
      frameWindow.addEventListener('keyup', forwardDirectEvent, options);
    } catch {
      return;
    }

    directCleanup = () => {
      try {
        frameWindow.removeEventListener('keydown', forwardDirectEvent, options);
        frameWindow.removeEventListener('keyup', forwardDirectEvent, options);
      } catch {
        // The nested frame may have navigated or switched origin before cleanup.
      }
    };
  };

  const handleFrameLoad = () => {
    attachDirectBridge();
  };

  const handleKeyboardMessage = (event: MessageEvent) => {
    if (event.source !== getFrameWindow(frame)) {
      return;
    }

    const payload = payloadFromPostMessage(event.data);
    if (!payload) {
      return;
    }

    dispatchKeyboardToPluginHost(payload);
  };

  frame.addEventListener('load', handleFrameLoad);
  window.addEventListener('message', handleKeyboardMessage);
  attachDirectBridge();

  return () => {
    detachDirectBridge();
    frame.removeEventListener('load', handleFrameLoad);
    window.removeEventListener('message', handleKeyboardMessage);
  };
}

function normalizeText(input: string | null | undefined): string {
  return (input ?? '').replace(/\s+/g, ' ').trim();
}

function extractBrowserErrorDetail(text: string): string | null {
  const codeMatch = text.match(/\b(ERR_[A-Z0-9_]+)\b/);
  if (codeMatch?.[1]) {
    return codeMatch[1];
  }

  const knownFragments = [
    'DNS_PROBE_FINISHED_NXDOMAIN',
    'DNS_PROBE_POSSIBLE',
    'NAME_NOT_RESOLVED',
    'server IP address could not be found',
    'This site can’t be reached',
    'This page isn’t working',
    'This site is inaccessible',
    '无法访问此网站',
    '找不到服务器 IP 地址',
    '无法连接到该网页',
  ];

  const hit = knownFragments.find((fragment) => text.includes(fragment));
  return hit ?? null;
}

function inspectFrameFailure(
  frame: HTMLIFrameElement,
  src: string,
): { failed: boolean; detail?: string } {
  try {
    const href = frame.contentWindow?.location.href;
    if (!href) {
      return { failed: true, detail: src };
    }
    if (href === 'about:blank' && src !== 'about:blank') {
      return { failed: true, detail: src };
    }
    if (href.startsWith('chrome-error://') || href.startsWith('edge-error://')) {
      const doc = frame.contentDocument;
      const combinedText = normalizeText([
        doc?.title,
        doc?.documentElement?.className,
        doc?.body?.textContent,
      ].join(' '));
      return {
        failed: true,
        detail: extractBrowserErrorDetail(combinedText) ?? src,
      };
    }

    const doc = frame.contentDocument;
    if (!doc || doc.readyState !== 'complete') {
      return { failed: false };
    }

    const title = normalizeText(doc.title);
    const bodyText = normalizeText(doc.body?.textContent);
    const htmlClassName = normalizeText(doc.documentElement?.className);
    const combinedText = normalizeText([title, htmlClassName, bodyText].join(' '));

    if (htmlClassName.includes('neterror') || htmlClassName.includes('error-page')) {
      return {
        failed: true,
        detail: extractBrowserErrorDetail(combinedText) ?? src,
      };
    }

    const browserErrorDetail = extractBrowserErrorDetail(combinedText);
    if (browserErrorDetail) {
      return {
        failed: true,
        detail: browserErrorDetail,
      };
    }

    const hasBodyChildren = Boolean(doc.body?.children.length);
    if (!hasBodyChildren && bodyText.length === 0) {
      return { failed: true, detail: src };
    }

    return { failed: false };
  } catch {
    // Cross-origin success pages are expected here; if inspection is blocked,
    // treat the frame as healthy and let the browser render it normally.
    return { failed: false };
  }
}

interface ResizeController {
  setRememberAspectRatio: (enabled: boolean) => void;
  cleanup: () => void;
}

function installResizeHandle(
  shell: HTMLDivElement,
  handle: HTMLDivElement,
): ResizeController {
  let currentHeight = loadStoredHeight();
  let dragStartY = 0;
  let dragStartHeight = 0;
  let activePointerId: number | null = null;
  let rememberAspectRatio = false;
  let currentAspectRatio = loadStoredAspectRatio();
  let lastObservedWidth = 0;

  const getShellWidth = () => {
    const rectWidth = shell.getBoundingClientRect().width;
    return Number.isFinite(rectWidth) && rectWidth > 0 ? rectWidth : shell.clientWidth;
  };

  const applyHeight = (nextHeight: number, persist = false) => {
    currentHeight = clampHeight(nextHeight);
    shell.style.height = `${currentHeight}px`;
    window.tx5dr.resize(currentHeight);
    if (persist) {
      saveStoredHeight(currentHeight);
    }
  };

  const saveCurrentAspectRatio = () => {
    const width = getShellWidth();
    if (width <= 0 || currentHeight <= 0) {
      return;
    }
    currentAspectRatio = width / currentHeight;
    saveStoredAspectRatio(currentAspectRatio);
  };

  const ensureAspectRatio = () => {
    currentAspectRatio = loadStoredAspectRatio();
    if (currentAspectRatio !== null) {
      return;
    }
    saveCurrentAspectRatio();
  };

  const applyAspectRatioHeight = (width = getShellWidth()) => {
    if (!currentAspectRatio || width <= 0) {
      return;
    }
    applyHeight(width / currentAspectRatio);
  };

  const finishDrag = () => {
    if (activePointerId === null) {
      return;
    }
    activePointerId = null;
    if (rememberAspectRatio) {
      saveCurrentAspectRatio();
    } else {
      saveStoredHeight(currentHeight);
    }
  };

  handle.addEventListener('pointerdown', (event) => {
    activePointerId = event.pointerId;
    dragStartY = event.clientY;
    dragStartHeight = currentHeight;
    handle.setPointerCapture(event.pointerId);
    event.preventDefault();
  });

  handle.addEventListener('pointermove', (event) => {
    if (activePointerId !== event.pointerId) {
      return;
    }
    const deltaY = event.clientY - dragStartY;
    applyHeight(dragStartHeight + deltaY);
    event.preventDefault();
  });

  handle.addEventListener('pointerup', (event) => {
    if (activePointerId !== event.pointerId) {
      return;
    }
    handle.releasePointerCapture(event.pointerId);
    finishDrag();
  });

  handle.addEventListener('pointercancel', () => {
    finishDrag();
  });

  const resizeObserver = new ResizeObserver(() => {
    if (!rememberAspectRatio) {
      return;
    }

    const nextWidth = getShellWidth();
    if (nextWidth <= 0 || Math.abs(nextWidth - lastObservedWidth) < 1) {
      return;
    }

    lastObservedWidth = nextWidth;
    ensureAspectRatio();
    applyAspectRatioHeight(nextWidth);
  });
  resizeObserver.observe(shell);

  applyHeight(currentHeight, false);

  return {
    setRememberAspectRatio(enabled: boolean) {
      if (!enabled) {
        if (rememberAspectRatio) {
          saveStoredHeight(currentHeight);
        }
        rememberAspectRatio = false;
        return;
      }

      rememberAspectRatio = true;
      lastObservedWidth = getShellWidth();
      ensureAspectRatio();
      applyAspectRatioHeight(lastObservedWidth);
    },
    cleanup() {
      resizeObserver.disconnect();
    },
  };
}

function getRenderKey(config: RenderConfig): string {
  switch (config.mode) {
    case 'iframe':
      return `iframe:${config.src}`;
    case 'video':
      return `video:${config.streamType}:${config.src}`;
    case 'empty':
      return 'empty';
    case 'invalid':
      return `invalid:${config.src}`;
  }
}

async function applyRenderConfig(
  container: HTMLElement,
  renderConfig: RenderConfig,
): Promise<void> {
  cleanupActiveEmbed();

  if (renderConfig.mode === 'video') {
    await renderVideo(container, renderConfig);
    return;
  }

  if (renderConfig.mode === 'iframe') {
    renderIframe(container, renderConfig.src);
    return;
  }

  if (renderConfig.mode === 'invalid') {
    renderError(container, t('invalidDescription'), renderConfig.src);
    return;
  }

  container.replaceChildren();
}

async function renderVideo(
  container: HTMLElement,
  config: Extract<RenderConfig, { mode: 'video' }>,
): Promise<void> {
  container.replaceChildren();

  const video = document.createElement('video');
  video.className = 'video-player';
  video.controls = config.controls;
  video.autoplay = config.autoplay;
  video.muted = config.muted;
  video.playsInline = config.playsInline;
  video.preload = 'metadata';
  container.appendChild(video);

  video.addEventListener('error', () => {
    renderError(container, config.streamType === 'hls' ? t('hlsLoadFailed') : t('videoLoadFailed'), config.src);
  }, { once: true });

  if (config.streamType === 'hls') {
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = config.src;
    } else {
      const HlsModule = await import('hls.js');
      const Hls = HlsModule.default;
      if (!Hls.isSupported()) {
        renderError(container, t('hlsLoadFailed'), config.src);
        return;
      }

      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
      });
      hls.loadSource(config.src);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          hls.destroy();
          renderError(container, t('hlsLoadFailed'), data.details || config.src);
        }
      });
    }
  } else {
    video.src = config.src;
  }

  try {
    await video.play();
  } catch {
    // Autoplay can still be blocked by the browser; keep the player visible.
  }
}

function renderIframe(container: HTMLElement, src: string): void {
  container.replaceChildren();

  const frame = document.createElement('iframe');
  frame.className = 'embed-frame embed-frame--loading';
  frame.src = src;
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  frame.allow = [
    'autoplay',
    'fullscreen',
    'picture-in-picture',
    'clipboard-read',
    'clipboard-write',
    'storage-access-api',
  ].join('; ');
  frame.loading = 'eager';
  container.appendChild(frame);
  activeEmbedCleanup = installNestedIframeKeyboardBridge(frame);

  const fail = (detail?: string) => {
    cleanupActiveEmbed();
    renderError(container, t('iframeLoadFailed'), detail ?? src);
  };

  const inspectSoon = (...delays: number[]) => {
    delays.forEach((delay) => {
      window.setTimeout(() => {
        const result = inspectFrameFailure(frame, src);
        if (result.failed) {
          fail(result.detail);
        }
      }, delay);
    });
  };

  const timeoutId = window.setTimeout(() => {
    if (frame.classList.contains('embed-frame--loading')) {
      fail(src);
      return;
    }
    const result = inspectFrameFailure(frame, src);
    if (result.failed) {
      fail(result.detail);
    }
  }, 8000);

  frame.addEventListener('load', () => {
    window.clearTimeout(timeoutId);
    frame.classList.remove('embed-frame--loading');
    inspectSoon(80, 320, 1000);
  }, { once: true });

  frame.addEventListener('error', () => {
    window.clearTimeout(timeoutId);
    fail(src);
  }, { once: true });
}

async function main(): Promise<void> {
  applyTheme(window.tx5dr.theme);
  window.tx5dr.onThemeChange((theme) => {
    applyTheme(theme);
  });

  const root = document.getElementById('app');
  if (!root) {
    return;
  }

  const layout = createSurface();
  root.replaceChildren(layout.shell);
  let resizeController: ResizeController | null = null;
  if (layout.resizeHandle) {
    resizeController = installResizeHandle(layout.shell, layout.resizeHandle);
  }
  let lastRenderKey = '';
  const renderResponse = async (response: PageConfigResponse) => {
    resizeController?.setRememberAspectRatio(response.rememberAspectRatio === true);

    const renderConfig = createRenderConfig(response.url);
    const nextRenderKey = getRenderKey(renderConfig);
    if (nextRenderKey === lastRenderKey) {
      return;
    }
    lastRenderKey = nextRenderKey;
    await applyRenderConfig(layout.surface, renderConfig);
  };

  const refresh = async () => {
    let response: PageConfigResponse;
    try {
      response = await window.tx5dr.invoke<PageConfigResponse>('getConfig', {
        tabId: window.tx5dr.params.tabId,
      });
    } catch {
      return;
    }
    await renderResponse(response);
  };

  void refresh();

  // Settings can be saved while this page stays mounted; refresh silently
  // when focus returns and during the first few seconds after boot.
  const retryTimers = [250, 1000, 2500].map((delay) => window.setTimeout(() => {
    void refresh();
  }, delay));

  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      void refresh();
    }
  };
  const handleConfigUpdated = (payload?: PageConfigResponse) => {
    if (payload && typeof payload.url === 'string') {
      void renderResponse(payload);
      return;
    }
    void refresh();
  };

  window.addEventListener('focus', refresh);
  window.addEventListener('pageshow', refresh);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.tx5dr.onPush('configUpdated', handleConfigUpdated);

  window.addEventListener('beforeunload', () => {
    cleanupActiveEmbed();
    resizeController?.cleanup();
    retryTimers.forEach((timerId) => window.clearTimeout(timerId));
    window.removeEventListener('focus', refresh);
    window.removeEventListener('pageshow', refresh);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.tx5dr.offPush('configUpdated', handleConfigUpdated);
  }, { once: true });
}

void main();
