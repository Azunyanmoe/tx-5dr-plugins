# web-iframe-embed

Embed external web pages or stream/video URLs in TX-5DR operator panels and the
automation popover.

## Features

- Per-operator URL settings for two panel placements
- Auto-detects HLS (`.m3u8`) and common direct video links
- Uses iframe mode for regular pages and video mode for media URLs
- For same-origin embedded iframes, forwards keyboard events to the TX-5DR host
  so host-level shortcuts such as Voice PTT still work while the embedded page is
  focused
- Localized in English and Chinese

## Forwarding shortcuts from cross-origin pages

Browsers do not allow this plugin to listen to keyboard events inside arbitrary
cross-origin iframes. If you control the embedded page, add a small opt-in bridge
to that page so PTT candidate keys can be forwarded to TX-5DR:

```html
<script>
(() => {
  const MESSAGE_TYPE = 'tx5dr:web-iframe-embed:keyboard';
  const PTT_CODES = new Set([
    'Backquote',
    'Space',
    'Home',
    'F1',
    'F2',
    'F3',
    'F4',
    'F5',
    'F6',
    'F7',
    'F8',
    'F9',
    'F10',
    'F11',
    'F12',
  ]);

  const forward = (event) => {
    if (!PTT_CODES.has(event.code)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    window.parent.postMessage({
      type: MESSAGE_TYPE,
      eventType: event.type,
      code: event.code,
      key: event.key,
      repeat: event.repeat,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      location: event.location,
    }, '*');
  };

  window.addEventListener('keydown', forward, { capture: true });
  window.addEventListener('keyup', forward, { capture: true });
})();
</script>
```

The plugin only accepts these messages from the currently embedded iframe. The
TX-5DR host still decides whether a forwarded key is an active shortcut.

## Build

```bash
npm install
npm run build
```
